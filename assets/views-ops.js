/* ==========================================================
   视图：集群管理
   ========================================================== */

/* ==========================================================
   运维中心 · 集群纳管
   ========================================================== */
function normalizeClusters() {
  DB.clusters.forEach((c, i) => {
    if (!c.id) c.id = `cl-${i + 1}`;
    if (!c.provider) c.provider = c.type.includes('边缘') ? '自建 K3s' : /staging|dev/.test(c.name) ? '阿里云 ACK' : '阿里云 ACK';
    if (!c.apiServer) c.apiServer = `https://${c.name}.k8s.corp.io:6443`;
    if (!c.namespaces) c.namespaces = c.type.includes('边缘') ? 6 : 14;
    if (!c.createdAt) c.createdAt = `2025-${pad2(3 + (i * 2) % 9)}-${pad2(5 + (i * 3) % 20)}`;
    if (!c.cni) c.cni = c.type.includes('边缘') ? 'flannel' : 'cilium 1.16';
    if (!c.podCap) c.podCap = c.type.includes('边缘') ? c.nodes * 32 : c.nodes * 48;
    if (!c.note) c.note = '';
  });
}
function clusterNodes(c) {
  const r = mulberry32(wHash(c.name + 'node'));
  const total = Math.min(c.nodes || 0, 60);
  const cp = c.type.includes('边缘') ? 1 : 3;
  const list = [];
  for (let i = 0; i < total; i++) {
    const role = i < cp ? 'control-plane' : 'worker';
    const pods = role === 'control-plane' ? 6 + Math.floor(r() * 8) : 12 + Math.floor(r() * 22);
    list.push({
      name: `${c.name}-node-${pad2(i + 1)}`,
      role,
      ver: String(c.ver).split(' ·')[0],
      status: c.status === '离线' || c.status === '接入中' ? c.status : (c.status === '维护中' && i === total - 1 ? '维护中' : '就绪'),
      cpu: c.cpu ? Math.max(2, Math.min(96, c.cpu + Math.round((r() - 0.5) * 34))) : 0,
      mem: c.mem ? Math.max(4, Math.min(96, c.mem + Math.round((r() - 0.5) * 24))) : 0,
      pods: c.status === '离线' || c.status === '接入中' ? 0 : pods
    });
  }
  return list;
}
function clusterMetrics(c) {
  const r = mulberry32(wHash(c.name + 'metric'));
  const cpuBase = c.cpu || 0, memBase = c.mem || 0;
  const rd = a => a.map(v => Math.round(v));
  return {
    cpu: rd(anchor(walk(r, 60, cpuBase, 6, Math.max(1, cpuBase - 22), Math.min(99, cpuBase + 20), true), cpuBase)),
    mem: rd(anchor(walk(r, 60, memBase, 4, Math.max(2, memBase - 12), Math.min(99, memBase + 12)), memBase))
  };
}
function clusterEvents(c) {
  if (c.status === '接入中') {
    return [{ t: '刚刚', type: 'Normal', reason: 'AgentInstalling', msg: '已下发平台 Agent 清单，等待目标集群回报 CSR 与节点信息' }];
  }
  if (c.status === '离线') {
    return [
      { t: '3 小时前', type: 'Warning', reason: 'ClusterUnreachable', msg: 'API Server 连接超时，边缘集群可能断网；已启用离线自治' },
      { t: '3 小时前', type: 'Warning', reason: 'MetricsMissing', msg: '指标采集中断，容量数据停留在断连前' }
    ];
  }
  const list = [
    { t: '今天 07:40', type: 'Normal', reason: 'NodeJoined', msg: `节点 ${c.name}-node-0${c.nodes} 通过引导加入集群，角色 worker` },
    { t: '今天 09:12', type: 'Normal', reason: 'CertRotated', msg: 'kubelet 客户端证书自动轮换完成，有效期 90 天' }
  ];
  if (c.status === '维护中') list.unshift({ t: '1 小时前', type: 'Warning', reason: 'ClusterMaintenance', msg: '集群进入维护模式：停止调度新实例，存量实例保留' });
  if (c.cpu > 70) list.unshift({ t: '25 分钟前', type: 'Warning', reason: 'HighCPU', msg: `集群 CPU 分配率 ${c.cpu}%，接近扩容阈值（80%）` });
  return list;
}
function clusterBy(name) { return DB.clusters.find(c => c.name === name); }

function viewClusters() {
  setCrumb('集群管理');
  const list = DB.clusters;
  const nodes = list.reduce((s, c) => s + (c.nodes || 0), 0);
  const pods = list.reduce((s, c) => s + (c.pods || 0), 0);
  const bad = list.filter(c => c.status === '离线' || c.status === '接入中').length;
  return `
  <div class="page-head">
    <div><div class="ttl">集群管理</div><div class="sub">云端 Kubernetes 集群与边缘 K3s 集群统一纳管。</div></div>
    <div class="acts">
      <button class="btn" ${act('toast', '已刷新集群状态')}>${icon('refresh', '', 14)}刷新</button>
      <button class="btn primary" ${act('connectCluster')}>${icon('plus', '', 14)}接入集群</button>
    </div>
  </div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">集群</div><div class="val">${list.length}</div><div class="foot">云端 ${list.filter(c => !c.type.includes('边缘')).length} · 边缘 ${list.filter(c => c.type.includes('边缘')).length}</div></div>
    <div class="stat"><div class="lab">节点总数</div><div class="val">${nodes}</div><div class="foot">跨 ${new Set(list.map(c => c.region)).size} 个区域</div></div>
    <div class="stat"><div class="lab">运行 Pod</div><div class="val">${pods}</div><div class="foot">调度位置含边缘</div></div>
    <div class="stat"><div class="lab">需关注</div><div class="val" style="color:${bad ? 'var(--warning)' : 'inherit'}">${bad}</div><div class="foot">${bad ? list.filter(c => c.status === '离线' || c.status === '接入中').map(c => esc(c.name)).join(' · ') : '全部集群可用'}</div></div>
  </div>
  <div class="card">
    <table class="table">
      <thead><tr><th>集群</th><th>类型</th><th>区域</th><th>版本</th><th class="right">节点</th><th>CPU</th><th>内存</th><th class="right">Pod</th><th>状态</th></tr></thead>
      <tbody>${list.map(c => `
        <tr class="clickable" ${act('goto', `#/ops/clusters/${encodeURIComponent(c.name)}`)}>
          <td class="name mono" style="font-size:11.5px">${esc(c.name)}<div class="sub">${esc(c.provider)}</div></td>
          <td><span class="chip ${c.type.includes('边缘') ? 'teal' : ''}">${esc(c.type)}</span></td>
          <td>${esc(c.region)}</td>
          <td class="mono" style="font-size:11px">${esc(c.ver)}</td>
          <td class="num">${c.nodes}</td>
          <td><div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:56px"><div class="${c.cpu > 80 ? 'bad' : c.cpu > 65 ? 'warn' : 'ok'}" style="width:${c.cpu}%"></div></div><span class="num">${c.cpu}%</span></div></td>
          <td><div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:56px"><div class="${c.mem > 85 ? 'bad' : c.mem > 70 ? 'warn' : 'ok'}" style="width:${c.mem}%"></div></div><span class="num">${c.mem}%</span></div></td>
          <td class="num">${c.pods}</td>
          <td>${badge(c.status)}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function viewCluster(name) {
  const c = clusterBy(name);
  setCrumb('集群管理');
  if (!c) {
    return `<div class="card"><div class="empty" style="padding:60px 20px">
      <h3>找不到集群 ${esc(name)}</h3>
      <p>它可能已被移除，或者链接里的集群名不匹配。</p>
      <button class="btn primary" ${act('goto', '#/ops/clusters')}>返回集群列表</button>
    </div></div>`;
  }
  const nodes = clusterNodes(c);
  const ready = nodes.filter(n => n.status === '就绪').length;
  const evs = clusterEvents(c);
  const live = c.status === '健康' || c.status === '维护中';
  const m = clusterMetrics(c);
  const workloads = DB.apps.flatMap(a => a.components.flatMap(comp => comp.workloads
    .filter(w => w.cluster === c.name)
    .map(w => ({ app: a.name, appId: a.id, comp: comp.name, name: w.name, kind: w.kind, replicas: w.replicas || 0 }))));
  return `
  <div class="page-head">
    <div>
      <div style="display:flex;align-items:center;gap:9px">
        <span class="link tiny" ${act('goto', '#/ops/clusters')}>集群管理</span>
        <span class="muted">/</span>
        <span class="ttl" style="font-size:16px">${esc(c.name)}</span>
        ${badge(c.status)}
      </div>
      <div class="sub">${esc(c.type)} · ${esc(c.region)} · <span class="mono">${esc(c.ver)}</span> · 纳管于 ${esc(c.createdAt)}</div>
    </div>
    <div class="acts">
      ${c.status === '接入中' ? `<button class="btn primary" ${act('clusterVerify', `${esc(c.name)}`)}>${icon('refresh', '', 14)}完成接入校验</button>` : `
        <button class="btn" ${act('clusterMaintain', `${esc(c.name)}`)}>${c.status === '维护中' ? '结束维护' : '设为维护'}</button>`}
      <button class="btn danger" ${act('clusterRemove', `${esc(c.name)}`)}>移除集群</button>
    </div>
  </div>

  ${c.status === '接入中' ? `<div class="approve-banner">
    <div class="ic">${icon('cloud', '', 16)}</div>
    <div class="tx">
      <b>正在接入：Agent 清单已下发</b>
      <p>目标集群执行安装命令后回报 CSR；校验通过即可接管调度。当前节点与容量数据尚未采集。</p>
    </div>
    <button class="btn sm primary" ${act('clusterVerify', `${esc(c.name)}`)}>完成校验</button>
  </div>` : ''}
  ${c.status === '维护中' ? `<div class="approve-banner">
    <div class="ic">${icon('shield', '', 16)}</div>
    <div class="tx"><b>集群处于维护模式</b><p>调度器不再向该集群分配新实例，存量实例继续运行；发布流水线会跳过该集群。</p></div>
  </div>` : ''}

  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">节点</div><div class="val">${c.nodes}<small>台</small></div><div class="foot">就绪 <b>${ready}</b> · 容量上限 ${c.podCap} Pod</div></div>
    <div class="stat"><div class="lab">运行 Pod</div><div class="val">${c.pods}<small>个</small></div><div class="foot">分配率 ${c.podCap ? Math.round(c.pods / c.podCap * 100) : 0}%</div></div>
    <div class="stat"><div class="lab">CPU 分配率</div><div class="val">${c.cpu}<small>%</small></div>
      <div class="foot"><div style="display:flex;align-items:center;gap:8px;width:100%"><div class="progress thin" style="flex:1"><div class="${c.cpu > 80 ? 'bad' : c.cpu > 65 ? 'warn' : 'ok'}" style="width:${c.cpu}%"></div></div><span class="tiny muted" style="white-space:nowrap">阈值 80%</span></div></div></div>
    <div class="stat"><div class="lab">内存分配率</div><div class="val">${c.mem}<small>%</small></div>
      <div class="foot"><div style="display:flex;align-items:center;gap:8px;width:100%"><div class="progress thin" style="flex:1"><div class="${c.mem > 85 ? 'bad' : c.mem > 70 ? 'warn' : 'ok'}" style="width:${c.mem}%"></div></div><span class="tiny muted" style="white-space:nowrap">阈值 85%</span></div></div></div>
  </div>

  ${live ? `<div class="grid g2" style="margin-bottom:14px">
    ${chartCard('CPU 分配率', '集群内所有节点 · 近 1 小时', m.cpu, { unit: '%', color: '#2563eb', labels: axisLabels('1h'), fmt: v => Math.round(v) })}
    ${chartCard('内存分配率', '含缓存与系统预留 · 近 1 小时', m.mem, { unit: '%', color: '#0d9488', labels: axisLabels('1h'), fmt: v => Math.round(v) })}
  </div>` : `<div class="card" style="margin-bottom:14px"><div class="empty" style="padding:30px 16px">
    <h3>${c.status === '接入中' ? '接入尚未完成，暂无容量曲线' : '集群离线，指标采集中断'}</h3>
    <p>${c.status === '接入中' ? '完成接入校验后开始采集 CPU、内存与 Pod 分配率。' : '边缘集群断网时进入离线自治，恢复连接后自动补齐指标。'}</p>
  </div></div>`}

  <div class="grid g21" style="align-items:start">
    <div class="card">
      <div class="card-head"><div class="t">节点</div><div class="r tiny muted">${ready} / ${nodes.length} 就绪</div></div>
      <table class="table">
        <thead><tr><th style="width:30%">节点</th><th style="width:19%">角色</th><th style="width:12%">状态</th><th style="width:12%">版本</th><th class="right" style="width:9%">CPU</th><th class="right" style="width:9%">内存</th><th class="right">Pod</th></tr></thead>
        <tbody>${nodes.map(n => `<tr>
          <td class="name mono" style="font-size:11.5px">${esc(n.name)}</td>
          <td>${n.role === 'control-plane' ? '<span class="chip blue">control-plane</span>' : '<span class="chip">worker</span>'}</td>
          <td>${badge(n.status === '就绪' ? '在线' : n.status)}</td>
          <td class="mono" style="font-size:10.5px">${esc(n.ver)}</td>
          <td class="num">${n.cpu}%</td>
          <td class="num">${n.mem}%</td>
          <td class="num">${n.pods}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card">
        <div class="card-head"><div class="t">集群信息</div></div>
        <div class="card-body">
          <dl class="kv">
            <dt>API Server</dt><dd class="mono" style="font-size:11px;word-break:break-all">${esc(c.apiServer)}</dd>
            <dt>接入方式</dt><dd>${esc(c.provider)}</dd>
            <dt>容器网络</dt><dd class="mono" style="font-size:11.5px">${esc(c.cni)}</dd>
            <dt>命名空间</dt><dd>${c.namespaces} 个</dd>
            <dt>承载工作负载</dt><dd>${workloads.length} 个 · ${workloads.reduce((s, w) => s + w.replicas, 0)} 实例</dd>
          </dl>
          ${c.note ? `<div class="tiny muted" style="margin-top:10px;line-height:1.6">${esc(c.note)}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t">承载的应用</div><div class="r tiny muted">${new Set(workloads.map(w => w.app)).size} 个应用 · ${workloads.length} 个工作负载</div></div>
        ${workloads.length ? `<table class="table">
          <thead><tr><th>工作负载</th><th class="right">副本</th></tr></thead>
          <tbody>${workloads.slice().sort((a, b) => b.replicas - a.replicas).slice(0, 7).map(w => `<tr class="clickable" ${act('goto', `${wlUrl(w.appId, w.comp, w.name)}`)}>
            <td class="name mono" style="font-size:11px">${esc(w.name)}<div class="sub">${esc(w.app)} / ${esc(w.comp)}</div></td>
            <td class="num">${w.replicas}</td>
          </tr>`).join('')}</tbody>
        </table>
        ${workloads.length > 7 ? `<div class="cfg-foot">另有 ${workloads.length - 7} 个工作负载调度在本集群，可在「工作负载」页按调度位置筛选。</div>` : ''}` : `<div class="empty" style="padding:22px 16px"><p style="margin:0" class="tiny">该集群还没有调度业务工作负载。</p></div>`}
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">集群事件</div><div class="r tiny muted">最近 24 小时</div></div>
    <div class="card-body">
      <div class="ev-list">
        ${evs.map(e => `<div class="ev">
          <i style="border-color:${e.type === 'Warning' ? 'var(--warning)' : 'var(--primary-line)'}"></i>
          <div><div class="ev-t">${esc(e.t)} · ${esc(e.reason)}</div><div class="ev-x">${esc(e.msg)}</div></div>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

function connectCluster() {
  const provs = [['阿里云 ACK', '阿里云 ACK'], ['腾讯云 TKE', '腾讯云 TKE'], ['自建 K8s', '自建 K8s'], ['自建 K3s（边缘）', '自建 K3s（边缘）']];
  formModal({
    title: '接入集群',
    desc: '平台通过 Agent 接管目标集群的调度与发布；原有工作负载不受影响。',
    okText: '生成接入清单',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('集群名称', fInput('name', '', 'prod-guangzhou-01'), '小写字母、数字与连字符，需全局唯一', true)}
        ${fField('接入方式', fSelect('provider', provs, provs[0][0], ' onchange="connectKindChange()"'))}
      </div>
      <div class="form-row">
        ${fField('区域', fInput('region', '', '华南 · 广州'), '用于调度与容灾拓扑', true)}
        ${fField('Kubernetes 版本', fSelect('ver', ['v1.29.4', 'v1.28.9', 'v1.28.6 · K3s', 'v1.27.11'], 'v1.29.4'))}
      </div>
      <div class="form-row">
        ${fField('API Server', fInput('apiServer', '', 'https://10.0.0.12:6443'), 'Agent 回调与平台代理访问地址', true)}
        ${fField('节点数', fInput('nodes', '3', '3', 'number'), '接入后以实际节点为准')}
      </div>
      ${fField('备注', fInput('note', '', '可选，例如机房或网络区域'))}
      <div class="hint">接入后平台会校验 API Server 连通性、节点就绪与 RBAC 权限，校验通过才开始调度。</div>`,
    onSubmit: st => {
      const name = String(st.name || '').trim();
      if (!NAME_RE.test(name)) return '集群名称只能是小写字母、数字与连字符';
      if (DB.clusters.some(c => c.name === name)) return `集群 ${name} 已存在`;
      if (!st.region) return '请填写区域，例如「华南 · 广州」';
      if (!/^https?:\/\//.test(st.apiServer)) return 'API Server 需以 http:// 或 https:// 开头';
      const nodes = clampInt(st.nodes, 1, 200, 3);
      const edge = String(st.provider).includes('K3s') || String(st.ver).includes('K3s');
      const cl = {
        id: `cl-${Date.now().toString(36)}`,
        name,
        type: edge ? '边缘集群' : '云端 K8s',
        region: st.region,
        ver: st.ver,
        nodes,
        cpu: 0, mem: 0, pods: 0,
        status: '接入中',
        provider: st.provider,
        apiServer: st.apiServer,
        namespaces: 0,
        cni: edge ? 'flannel' : 'cilium 1.16',
        podCap: nodes * (edge ? 32 : 48),
        createdAt: nowStamp().slice(0, 10),
        note: st.note || '',
        token: `cl-tk-${wHash(name).toString(36)}`
      };
      DB.clusters.push(cl);
      saveSnapshot();
      if (location.hash.startsWith('#/ops')) route();
      toast(`集群 ${name} 已登记，等待接入校验`, 'ok');
      setTimeout(() => clusterInstallModal(name), 60);
    }
  });
}
function connectKindChange() {
  const mask = document.querySelector('.modal-mask:last-child');
  if (!mask) return;
  const d = readForm(mask);
  const ver = mask.querySelector('[data-k=ver]');
  if (ver && String(d.provider).includes('K3s') && !String(ver.value).includes('K3s')) ver.value = 'v1.28.6 · K3s';
}
function clusterInstallCommand(c) {
  return `kubectl apply -f "https://console.cloudpaas.io/install/agent.yaml?cluster=${c.name}&token=${c.token || 'cl-tk-pending'}"`;
}
function clusterInstallModal(name) {
  const c = clusterBy(name);
  if (!c) return;
  openModal({
    title: `接入清单 · ${c.name}`,
    desc: '在目标集群具备 cluster-admin 权限的上下文中执行；Agent 以 DaemonSet 形式部署。',
    okText: '复制命令',
    body: `<div class="cmd-box"><code>${esc(clusterInstallCommand(c))}</code></div>
      <div class="tiny muted" style="margin-top:12px;line-height:1.8">
        1. 平台校验 API Server 连通性与 CSR 审批权限；<br>
        2. 节点就绪后自动打上 <span class="mono">platform.io/managed=true</span> 标签；<br>
        3. 校验完成后回到集群详情点「完成接入校验」即可开始调度。
      </div>`,
    onOk: () => copyText(clusterInstallCommand(c))
  });
}
function clusterVerify(name) {
  const c = clusterBy(name);
  if (!c) return;
  const r = mulberry32(wHash(c.name + 'verify'));
  c.status = '健康';
  c.cpu = 22 + Math.floor(r() * 34);
  c.mem = 34 + Math.floor(r() * 30);
  c.pods = Math.round((c.nodes || 3) * (12 + Math.floor(r() * 16)));
  c.namespaces = c.type.includes('边缘') ? 6 : 14;
  saveSnapshot();
  route();
  toast(`集群 ${name} 接入完成，已开始采集容量指标`, 'ok');
}
function clusterMaintain(name) {
  const c = clusterBy(name);
  if (!c) return;
  if (c.status === '接入中') return toast('集群仍在接入中，完成后才能切换维护模式', 'warn');
  if (c.status === '离线') return toast('集群离线，无法切换维护模式', 'warn');
  c.status = c.status === '维护中' ? '健康' : '维护中';
  saveSnapshot();
  route();
  toast(c.status === '维护中' ? '已进入维护模式：停止调度新实例' : '已结束维护，恢复调度', c.status === '维护中' ? 'warn' : 'ok');
}
function clusterRemove(name) {
  const c = clusterBy(name);
  if (!c) return;
  const wl = DB.apps.flatMap(a => a.components.flatMap(comp => comp.workloads.filter(w => w.cluster === name))).length;
  openModal({
    title: '移除集群',
    desc: `${c.name} · ${c.region}`,
    danger: true,
    okText: '确认移除',
    body: `<div class="danger-box">
        平台会卸载 Agent 并停止同步，目标集群内的业务工作负载<b>不会被删除</b>。
        ${wl ? `当前有 <b>${wl}</b> 个工作负载调度到该集群，移除后需要在其他集群重新编排。` : ''}
      </div>`,
    onOk: () => {
      DB.clusters = DB.clusters.filter(x => x.name !== name);
      saveSnapshot();
      goto('#/ops/clusters');
      toast('集群已移除', 'warn');
    }
  });
}

function viewAlerts() {
  setCrumb('告警中心');
  return `
  <div class="page-head">
    <div><div class="ttl">告警中心</div><div class="sub">按严重程度聚合，支持静默、认领与升级通知。</div></div>
    <div class="acts">
      <button class="btn" disabled title="告警规则配置尚未开放">告警规则</button>
      <button class="btn" disabled title="通知渠道配置尚未开放">通知渠道</button>
    </div>
  </div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="lab">严重</div><div class="val" style="color:var(--danger)">${alertCount('严重')}</div><div class="foot">未关闭的严重告警</div></div>
    <div class="stat"><div class="lab">警告</div><div class="val" style="color:var(--warning)">${alertCount('警告')}</div><div class="foot">${alertCount('警告', '处理中')} 处理中</div></div>
    <div class="stat"><div class="lab">已关闭</div><div class="val">${alertCount(null, '已关闭')}</div><div class="foot">本次会话累计处理</div></div>
    <div class="stat"><div class="lab">待认领</div><div class="val" style="color:${alertCount(null, '未处理') ? 'var(--warning)' : 'inherit'}">${alertCount(null, '未处理')}</div><div class="foot">尚未指派负责人</div></div>
  </div>
  <div class="card">
    <div class="toolbar">
      ${[['all', '全部'], ['未处理', '未处理'], ['处理中', '处理中'], ['已关闭', '已关闭'], ['已忽略', '已忽略']].map(([k, n]) =>
        `<button class="filter-pill ${(S.alertSt || 'all') === k ? 'on' : ''}" ${act('alertFilter', `${k}`)}>${n}</button>`).join('')}
      <div class="grow"><span class="tiny muted" style="align-self:center">最近 24 小时</span></div>
    </div>
    <table class="table">
      <thead><tr><th>级别</th><th>告警内容</th><th>关联应用</th><th>资源</th><th>时间</th><th>状态</th><th class="right">操作</th></tr></thead>
      <tbody>${alertRows()}</tbody>
    </table>
  </div>`;
}

/* 告警处置：未处理 → 处理中 → 已关闭，忽略为旁路终态 */
function alertCount(level, status) {
  return DB.alerts.filter(a => {
    if (level && a.level !== level) return false;
    if (status) return a.status === status;
    return a.status !== '已关闭' && a.status !== '已忽略';
  }).length;
}
function alertFilter(k) { S.alertSt = k; route(); }
function alertRows() {
  const st = S.alertSt || 'all';
  const idx = DB.alerts.map((_, i) => i).filter(i => st === 'all' || DB.alerts[i].status === st);
  if (!idx.length) {
    return `<tr><td colspan="7"><div class="empty" style="padding:26px 16px"><p style="margin:0">当前筛选下没有告警。</p></div></td></tr>`;
  }
  return idx.map(i => {
    const a = DB.alerts[i];
    const acts = a.status === '未处理'
      ? `<button class="btn sm ghost" ${act('alertAct', (i), 'claim')}>认领</button>
         <button class="btn sm" ${act('alertAct', (i), 'ignore')}>忽略</button>`
      : a.status === '处理中'
        ? `<button class="btn sm primary" ${act('alertAct', (i), 'close')}>关闭</button>`
        : `<span class="tiny muted">${esc(a.closedAt || a.ignoredAt || '已归档')}</span>`;
    return `<tr>
      <td>${badge(a.level)}</td>
      <td class="name">${esc(a.title)}</td>
      <td>${esc(a.app)}</td>
      <td class="mono" style="font-size:11px">${esc(a.res)}</td>
      <td class="tiny muted">${esc(a.time)}</td>
      <td>${badge(a.status)}${a.owner ? `<div class="sub">${esc(a.owner)}</div>` : ''}</td>
      <td class="right">${acts}</td>
    </tr>`;
  }).join('');
}
function alertAct(i, act) {
  const a = DB.alerts[i];
  if (!a) return;
  if (act === 'claim') {
    a.status = '处理中'; a.owner = DB.user.name; a.claimedAt = clockNow();
    toast(`已认领，负责人 ${DB.user.name}`, 'ok');
  } else if (act === 'close') {
    a.status = '已关闭'; a.closedAt = clockNow();
    toast('告警已关闭', 'ok');
  } else if (act === 'ignore') {
    a.status = '已忽略'; a.ignoredAt = clockNow();
    toast('已忽略，不再提醒', 'warn');
  }
  saveSnapshot();
  route();
}

/* ---------- 模块管理（核心） ---------- */
