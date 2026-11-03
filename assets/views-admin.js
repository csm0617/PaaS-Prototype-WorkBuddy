/* ==========================================================
   视图：模块管理、角色权限、设计说明
   ========================================================== */

/* ==========================================================
   平台管理 · 模块配置 / 文档
   ========================================================== */
function moduleConfig(key) {
  const mesh = key === 'mesh';
  DB.moduleCfg = DB.moduleCfg || {};
  const cfg = (DB.moduleCfg[key] = DB.moduleCfg[key] || (mesh ? {
    control: 'istiod.istio-system:15012', inject: '自动注入', mtls: '严格模式', rotate: '90', sample: '12.5'
  } : {
    control: 'edge-controller.cloudpaas:9443', offline: '72', sync: '30', window: '02:00 - 05:00', preload: '1'
  }));
  const body = mesh ? `
    ${fField('控制面地址', fInput('control', cfg.control), 'istiod 的 gRPC 地址，Sidecar 通过它拉取配置')}
    <div class="form-row">
      ${fField('Sidecar 注入', fSelect('inject', ['自动注入', '手动注入', '不注入'], cfg.inject), '按命名空间标签决定是否注入')}
      ${fField('mTLS 模式', fSelect('mtls', ['严格模式', '宽松模式', '关闭'], cfg.mtls))}
    </div>
    <div class="form-row">
      ${fField('证书轮换周期 (天)', fInput('rotate', cfg.rotate, '90', 'number'))}
      ${fField('链路采样率 (%)', fInput('sample', cfg.sample, '12.5', 'number'), '过高会显著增加 Collector 写入')}
    </div>` : `
    ${fField('控制面地址', fInput('control', cfg.control), '边缘控制器地址，节点通过它同步期望状态')}
    <div class="form-row">
      ${fField('离线自治时长 (小时)', fInput('offline', cfg.offline, '72', 'number'), '断网后本地继续运行的最长时间')}
      ${fField('增量同步间隔 (秒)', fInput('sync', cfg.sync, '30', 'number'))}
    </div>
    <div class="form-row">
      ${fField('默认分发窗口', fInput('window', cfg.window, '02:00 - 05:00'), '门店营业时段之外')}
      ${fField('镜像预热', fSelect('preload', [['1', '开启'], ['0', '关闭']], cfg.preload || '1'), '低峰期提前拉取，避免首启等待')}
    </div>`;
  formModal({
    title: `模块配置 · ${mesh ? 'Service Mesh' : '云边端协同'}`,
    desc: '配置保存后下发到控制面，已建立的连接会在 30 秒内按新配置重建。',
    okText: '保存并下发',
    wide: true,
    body,
    onSubmit: st => {
      if (!String(st.control || '').trim()) return '请填写控制面地址';
      if (mesh) {
        Object.assign(cfg, {
          control: st.control, inject: st.inject, mtls: st.mtls,
          rotate: String(clampInt(st.rotate, 7, 365, 90)),
          sample: String(Math.max(0, Math.min(100, parseFloat(st.sample) || 0)))
        });
      } else {
        Object.assign(cfg, {
          control: st.control,
          offline: String(clampInt(st.offline, 1, 720, 72)),
          sync: String(clampInt(st.sync, 5, 600, 30)),
          window: st.window || '02:00 - 05:00',
          preload: st.preload === '1' ? '1' : '0'
        });
      }
      saveSnapshot();
      route();
      toast('模块配置已下发', 'ok');
    }
  });
}
function moduleDocs(key) {
  const mesh = key === 'mesh';
  const sec = (t) => `<div class="sd-sec">${t}</div>`;
  const cmd = (t) => `<div class="cmd-box" style="margin:6px 0 10px"><code>${esc(t)}</code></div>`;
  const p = (t) => `<div class="tiny" style="color:var(--text-2);line-height:1.75">${t}</div>`;
  openModal({
    title: `${mesh ? 'Service Mesh' : '云边端协同'} · 模块文档`,
    desc: '随平台内核 v4.2.0 提供，接口保持向后兼容。',
    okText: '知道了',
    cancelText: '关闭',
    body: mesh ? `
      ${sec('架构')}
      ${p('控制面 istiod 负责配置分发与证书签发，数据面为每个 Pod 注入 Envoy Sidecar。业务容器与 Sidecar 之间走回环，出站流量由 iptables 透明劫持。')}
      ${sec('常用命令')}
      ${cmd('istioctl proxy-status                 # 查看 Sidecar 与控制面的同步状态')}
      ${cmd('istioctl analyze -n retail-prod     # 校验虚拟服务与目标规则')}
      ${sec('关键概念')}
      ${p('<b>虚拟服务</b>决定请求怎么走（匹配条件 + 路由动作）；<b>目标规则</b>决定失败怎么办（重试、超时、熔断、异常点驱逐）。两者的 host 必须与 Kubernetes Service 名一致。')}
      ${sec('排障建议')}
      ${p('灰度不生效时先看 <span class="mono">proxy-status</span> 是否 SYNCED；再看请求头是否真的带了匹配条件。熔断触发可在「服务拓扑」页签观察实例被摘除的时间点。')}
    ` : `
      ${sec('架构')}
      ${p('云端控制器维护期望状态，边缘节点上的 Agent 拉取清单并在本地 K3s 落地。断网时按最后一次期望状态运行，联网后做增量对账。')}
      ${sec('接入流程')}
      ${p('① 在「边缘节点」登记设备并生成令牌；② 门店侧执行接入命令安装 Agent；③ 节点上报容量后即可接收分发任务。')}
      ${cmd('curl -sSL https://console.cloudpaas.io/edge/join | sh -s -- --token <token> --node <name>')}
      ${sec('分发策略')}
      ${p('支持按区域、节点标签选择目标，先灰度 2 个节点再全量；失败自动回滚上一版本。分发窗口默认 02:00 - 05:00，避开营业高峰。')}
      ${sec('排障建议')}
      ${p('分发卡在「灰度中」通常是目标节点离线或镜像拉取失败；可在分发详情查看逐节点进度与失败原因。')}
    `
  });
}

/* ==========================================================
   平台管理 · 角色权限
   ========================================================== */
function newRole() {
  const scopes = [['全部资源', '全部资源'], ['按应用', '按应用'], ['仅本人创建', '仅本人创建']];
  const perms = [['查看', '查看'], ['发布', '发布与回滚'], ['扩缩容', '扩缩容'], ['配置', '修改配置与密钥'], ['成员', '成员管理'], ['模块', '模块开关']];
  formModal({
    title: '新建角色',
    desc: '角色按「数据范围 + 操作权限」组合；模块开关仅平台管理员可授予。',
    okText: '创建角色',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('角色名称', fInput('name', '', '应用运维'), '例如：应用负责人、值班运维', true)}
        ${fField('数据范围', fSelect('scope', scopes, '按应用'), '决定能看到哪些应用与环境')}
      </div>
      <div class="form-sec">操作权限</div>
      <div class="form-row">
        ${perms.slice(0, 3).map(([k, n]) => fCheck('p_' + k, n, k === '查看')).join('')}
      </div>
      <div class="form-row">
        ${perms.slice(3).map(([k, n]) => fCheck('p_' + k, n, false)).join('')}
      </div>`,
    onSubmit: st => {
      const name = String(st.name || '').trim();
      if (!name) return '请填写角色名称';
      if (DB.roles.some(r => r.name === name)) return `角色 ${name} 已存在`;
      const picked = perms.filter(([k]) => st['p_' + k]).map(([, n]) => n);
      if (!picked.length) return '请至少选择一项操作权限';
      if (picked.includes('查看') === false) return '「查看」是其它权限的前提，请一并勾选';
      DB.roles.push({ name, users: 0, scope: st.scope, perm: picked.join(' / '), builtin: false });
      saveSnapshot();
      route();
      toast(`角色 ${name} 已创建，可在成员管理里分配`, 'ok');
    }
  });
}



/* ---------- 环境 / 权限 ---------- */
function viewRbac() {
  setCrumb('角色权限');
  return `
  <div class="page-head">
    <div><div class="ttl">角色权限</div><div class="sub">RBAC 按应用维度收敛权限，模块开关仅平台管理员可操作。</div></div>
    <div class="acts"><button class="btn primary" ${act('newRole')}>${icon('plus', '', 14)}新建角色</button></div>
  </div>
  <div class="card">
    <table class="table">
      <thead><tr><th>角色</th><th>成员</th><th>数据范围</th><th>权限</th><th>模块开关</th><th class="right">类型</th></tr></thead>
      <tbody>${DB.roles.map(r => `
        <tr>
          <td class="name">${r.name}</td>
          <td class="num">${r.users}</td>
          <td class="tiny">${r.scope}</td>
          <td class="tiny">${r.perm}</td>
          <td>${r.perm.includes('模块开关') ? '<span class="badge ok">可操作</span>' : '<span class="badge muted">不可见</span>'}</td>
          <td class="right">${r.builtin ? '<span class="badge outline">内置</span>' : '<span class="badge muted">自定义</span>'}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ---------- 设计说明 ---------- */
function viewDesign() {
  setCrumb('设计说明');
  return `
  <div class="page-head">
    <div><div class="ttl">设计说明</div><div class="sub">原型的设计思路、分层架构与关键交互约定。</div></div>
  </div>

  <div class="grid g2" style="margin-bottom:16px">
    <div class="card">
      <div class="card-head"><div class="t">一、分层架构</div></div>
      <div class="card-body">
        <div style="display:flex;flex-direction:column;gap:7px">
          ${[
            ['接入层', '控制台 / OpenAPI / CLI', '#f4efff', '#ddd0fb'],
            ['业务模型层', '应用 → 组件 → 工作负载', '#eef4ff', '#cddcff'],
            ['平台内核', '发布编排 · 环境 · 运维 · 告警 · RBAC（始终启用）', '#e9f8ef', '#c9e9d6'],
            ['可插拔模块', 'Service Mesh ｜ 云边端协同（独立开关）', '#fef4e6', '#f6e2be'],
            ['基础设施', '云端 K8s ｜ 边缘 K3s ｜ 端设备', '#f4f6fb', '#dfe5f1']
          ].map(([t, d, bg, bd]) => `
            <div style="background:${bg};border:1px solid ${bd};border-radius:8px;padding:9px 12px">
              <div style="font-size:12px;font-weight:650">${t}</div>
              <div class="tiny" style="color:var(--text-2);margin-top:1px">${d}</div>
            </div>`).join('')}
        </div>
        <div class="tiny muted" style="margin-top:11px;line-height:1.7">模块层与内核层之间只通过标准接口通信（CRD / 事件总线），不存在反向依赖，因此可以整体摘除。</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="t">二、业务模型</div></div>
      <div class="card-body">
        <div style="display:flex;flex-direction:column;gap:10px">
          ${[
            ['应用 Application', '业务交付单元', '承载业务语义、负责人、等级（P0/P1/P2）、环境集合；一次发布批复整个应用。'],
            ['组件 Component', '可独立构建的部署单元', '对应一个镜像与版本，是流水线的绑定对象；一个组件可派生多种形态的工作负载。'],
            ['工作负载 Workload', '调度的最小单位', 'Deployment / StatefulSet / CronJob / EdgeApp / DeviceAgent，带副本、资源、调度位置。']
          ].map(([t, s, d], i) => `
            <div style="display:flex;gap:11px">
              <div style="width:22px;height:22px;border-radius:6px;background:var(--primary-soft);color:var(--primary);display:grid;place-items:center;font-size:11px;font-weight:700;flex:0 0 22px">${i + 1}</div>
              <div>
                <div style="font-size:12.5px;font-weight:650">${t} <span class="tiny muted" style="font-weight:400">· ${s}</span></div>
                <div class="tiny" style="color:var(--text-2);margin-top:1px;line-height:1.65">${d}</div>
              </div>
            </div>`).join('')}
        </div>
        <div style="margin-top:13px;padding:10px 12px;background:var(--surface-2);border-radius:8px;font-size:11.5px;color:var(--text-2);line-height:1.8">
          约束：工作负载必须归属且仅归属一个组件；组件必须归属一个应用。<br>
          好处：发布以应用为单位、构建以组件为单位、调度以工作负载为单位，三层职责不重叠。
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-head"><div class="t">三、解耦设计：模块开关如何做到「关闭不影响基础功能」</div></div>
    <div class="card-body">
      <table class="table" style="border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <thead><tr><th>层面</th><th>开启时</th><th>关闭时</th></tr></thead>
        <tbody>
          <tr><td class="name">导航</td><td>侧边栏出现模块分组</td><td>分组整体隐藏，不占位置</td></tr>
          <tr><td class="name">应用详情</td><td>出现「流量治理」页签与 Sidecar 注入列</td><td>页签隐藏，表格列自动收缩，无需空占位</td></tr>
          <tr><td class="name">工作负载</td><td>调度位置可为云端 / 边缘 / 端侧</td><td>全部落在云端，边缘列值退化为「云端」</td></tr>
          <tr><td class="name">发布链路</td><td>灰度按 Mesh 权重分流</td><td>退回 K8s 原生滚动更新，流水线无需改动</td></tr>
          <tr><td class="name">数据</td><td>模块数据独立存储</td><td>保留不删除，重新启用即恢复</td></tr>
        </tbody>
      </table>
      <div class="tiny muted" style="margin-top:11px">打开「模块管理」关闭任一模块，可实时观察以上变化——页签、列、菜单会同步收敛。</div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><div class="t">四、可体验的交互点</div></div>
    <div class="card-body">
      <div class="grid g2" style="gap:10px">
        ${[
          ['创建闭环', '应用列表 → 新建应用，三步向导一次创建应用 / 组件 / 工作负载', '/apps'],
          ['扩缩容与删除', '应用详情右上「扩缩容」与「···」，真实改写演示数据', '/apps/retail-platform'],
          ['模块开关', '平台管理 → 模块管理，关闭 Service Mesh 后观察应用详情页签变化', '/admin/modules'],
          ['三层资源树', '应用详情 → 组件与工作负载，左侧树可逐层下钻', '/apps/retail-platform'],
          ['全局组件视图', '应用管理 → 组件，跨应用汇总组件、实例水位与异常', '/components'],
          ['组件拓扑', '应用详情 → 组件拓扑，按依赖分层，点节点可下钻', '/apps/retail-platform'],
          ['访问入口', '应用详情 → 访问入口，查看域名与网关路径两种形态', '/apps/retail-platform'],
          ['全局入口视图', '应用管理 → 访问入口，跨应用汇总所有对外地址', '/access'],
          ['流水线阶段', '选择一条运行中的流水线查看阶段流程与实时日志', '/cicd/pl-order'],
          ['审批与灰度', '流水线停在人工审批，可通过 → 推进灰度到 100%', '/cicd/pl-order'],
          ['发布记录与回滚', '应用 → 发布记录，发起发布、审批、回滚到上一版', '/apps/retail-platform/releases'],
          ['跨端调度视图', '工作负载页按「边缘 / 端侧」筛选', '/workloads'],
          ['工作负载运行时', '工作负载 → 详情，看指标曲线、实时日志、YAML 与终端', '/workloads/retail-platform/order-service/order-service-api'],
          ['服务拓扑', 'Service Mesh → 服务拓扑，查看调用关系与异常链路', '/mesh/topology'],
          ['链路追踪', 'Service Mesh → 链路追踪，点开慢链路看瀑布图与耗时分布', '/mesh/tracing'],
          ['流量规则编排', 'Service Mesh → 流量规则，新建/编辑灰度、重试、熔断与镜像规则', '/mesh/traffic'],
          ['边缘节点纳管', '云边端协同 → 边缘节点，登记节点、看容量曲线与逐节点工作负载', '/edge/nodes'],
          ['应用分发', '云边端协同 → 应用分发，新建分发任务并逐节点查看进度', '/edge/distribute'],
          ['集群接入', '运维中心 → 集群管理 → 接入集群，校验后接管调度', '/ops/clusters'],
          ['配置与存储', '工作负载 → 配置与存储，变量与持久卷可增删，YAML 同步生成', '/workloads/retail-platform/order-service/order-service-api'],
          ['存储视图', '运维中心 → 存储，按存储类汇总 PVC 与申请容量', '/storage']
        ].map(([t, d, r]) => `
          <div style="display:flex;gap:9px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer" ${act('go', `${r}`)}>
            <span style="color:var(--primary);margin-top:1px">${icon('chev', '', 13)}</span>
            <div><div style="font-size:12.3px;font-weight:620">${t}</div><div class="tiny muted" style="margin-top:1px">${d}</div></div>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">五、原型数据</div><div class="r tiny muted">localStorage</div></div>
    <div class="card-body" style="display:flex;align-items:center;gap:16px">
      <div class="tiny" style="color:var(--text-2);line-height:1.75;flex:1">
        新建的应用、组件与工作负载，以及删除、扩缩容的结果都会写入
        <span class="mono">paas.prototype.db.v1</span>，刷新后依然保留，因此可以完整演示一次「创建 → 变更 → 回收」的闭环。
        模块开关单独存放在 <span class="mono">paas.prototype.modules.v1</span>。
      </div>
      <button class="btn danger" ${act('resetSnapshot')}>${icon('refresh', '', 14)}重置演示数据</button>
    </div>
  </div>`;
}

