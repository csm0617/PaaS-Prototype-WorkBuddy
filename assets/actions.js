/* ==========================================================
   交互动作：新建应用/组件/工作负载、删除、扩缩容
   ========================================================== */

/* ==========================================================
   创建闭环：应用 → 组件 → 工作负载
   所有写操作都会 saveSnapshot()，刷新后仍保留
   ========================================================== */

const COMP_ROLES = ['核心服务', '入口网关', '边缘采集', '异步任务', '渠道适配', '流接入', '协议解析', '推理引擎', '规则计算', '对账任务'];
const BUILD_MODES = ['Dockerfile 构建', 'Buildpack 自动识别', '引用已有镜像'];
const RUNTIME_PENDING = '待首次构建确定';
const CPU_OPTS = ['0.2 / 1c', '0.5 / 2c', '1 / 2c', '2 / 4c', '4 / 8c'];
const MEM_OPTS = ['512Mi / 1Gi', '1Gi / 2Gi', '2 / 4Gi', '4 / 8Gi', '8 / 16Gi'];
const PROTOCOLS = ['HTTP', 'gRPC', 'MQTT', 'MQ'];
/* 把 "1.8 / 8c" 这类实际值对齐到规格下拉里的规范选项（优先同上限、再比当前值） */
function fitSpec(v, opts, fallback) {
  if (!v) return fallback;
  if (opts.includes(v)) return v;
  const target = parseRes(v, opts === MEM_OPTS ? 'mem' : 'cpu');
  let best = fallback, bestDiff = Infinity;
  opts.forEach(o => {
    const cand = parseRes(o, opts === MEM_OPTS ? 'mem' : 'cpu');
    const diff = Math.abs(cand.cap - target.cap) * 100 + Math.abs(cand.cur - target.cur);
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  });
  return best;
}

/* 组件对外协议：按角色给出合理默认，可在组件配置里改 */
function protoOf(role) {
  const r = String(role || '');
  if (r.includes('边缘') || r.includes('协议解析')) return 'MQTT';
  if (r.includes('异步') || r.includes('对账')) return 'MQ';
  if (r.includes('推理')) return 'gRPC';
  return 'HTTP';
}
/* 运行时是构建产物属性，创建时不让人手填；首次构建成功后从构建环境回填 */
function runtimeText(comp) {
  if (!comp || !comp.runtime || comp.runtime === RUNTIME_PENDING) {
    return `<span class="muted" title="运行时由首次构建自动识别">待首次构建</span>`;
  }
  return esc(comp.runtime);
}
function applyRuntimeFromBuild(p) {
  const app = DB.apps.find(a => a.id === p.appId);
  const comp = app && findComp(app, p.comp);
  if (comp && (!comp.runtime || comp.runtime === RUNTIME_PENDING)) comp.runtime = p.buildEnv || '容器镜像';
}
const WL_KINDS = [['Deployment', 'Deployment · 无状态服务'], ['StatefulSet', 'StatefulSet · 有状态'], ['CronJob', 'CronJob · 定时任务'], ['EdgeApp', 'EdgeApp · 边缘应用']];
const wlSpots = () => S.modules.edge
  ? [['云端', '云端集群'], ['边缘', '边缘节点'], ['端侧', '端设备']]
  : [['云端', '云端集群']];
const appDomains = () => [...new Set(['零售业务域', '交易域', '基础域', '支付域', '智能边缘', ...DB.apps.map(a => a.domain)])];

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function clusterOf(where) {
  if (where === '边缘') return 'edge-sh-store';
  if (where === '端侧') return 'edge-device-pool';
  return (curEnv() && curEnv().cluster) || 'prod-shanghai-01';
}

/* 由向导/表单数据构造工作负载 */
function buildWorkload(src, comp) {
  const kind = src.wlKind || 'Deployment';
  const where = src.wlWhere || '云端';
  const reps = clampInt(src.wlReplicas, 0, 50, 2);
  return {
    id: src.wlId || `wl-${slugify(src.wlName) || 'w'}`,
    name: src.wlName,
    kind,
    replicas: kind === 'CronJob' ? 0 : reps,
    readyN: kind === 'CronJob' ? 0 : reps,
    ready: kind === 'CronJob' ? '—' : `${reps}/${reps}`,
    image: src.wlImage || comp.version || 'v1.0.0',
    cpu: src.wlCpu || '1 / 2c',
    mem: src.wlMem || '2 / 4Gi',
    status: kind === 'CronJob' ? '已完成' : reps > 0 ? '运行中' : '已停止',
    where,
    cluster: clusterOf(where),
    mesh: S.modules.mesh && where === '云端' ? '已注入' : '—',
    restarts: 0,
    age: '刚刚'
  };
}

/* 把负载挂到组件下，并维护主负载引用 */
function addWorkloadToComponent(comp, wl) {
  comp.workloads.push(wl);
  if (!comp.primaryWorkloadId) { comp.primaryWorkloadId = wl.id; wl.role = 'primary'; }
  else wl.role = wl.where === '边缘' ? 'edge' : 'secondary';
  if (typeof normalizeWorkloadRuntime === 'function') normalizeWorkloadRuntime();
  return wl;
}

/* ---------- 新建应用：三步向导 ---------- */
function newApp() {
  wizard({
    title: '新建应用',
    desc: '应用是业务交付单元。创建后可继续下钻添加组件与工作负载。',
    okText: '创建应用',
    state: {
      domain: DB.apps[0] ? DB.apps[0].domain : '零售业务域',
      owner: DB.user.name,
      level: 'P1',
      env: '生产环境',
      desc: '',
      createComp: true,
      compName: '', compRole: '核心服务', compImage: '',
      compBuild: 'Dockerfile 构建', compVersion: 'v1.0.0',
      createWl: true,
      wlName: '', wlKind: 'Deployment', wlReplicas: '2', wlWhere: '云端',
      wlCpu: '1 / 2c', wlMem: '2 / 4Gi', wlImage: ''
    },
    steps: [
      {
        name: '基本信息',
        render: s => `
          ${fField('应用名称', fInput('name', s.name, '例如：会员营销中心'), '应用名称在平台内唯一，建议使用业务名词', true)}
          <div class="form-row">
            ${fField('业务域', fSelect('domain', appDomains(), s.domain))}
            ${fField('负责人', fInput('owner', s.owner, '张明'))}
          </div>
          <div class="form-row">
            ${fField('优先级', fSelect('level', ['P0', 'P1', 'P2'], s.level), 'P0 变更需额外审批')}
            ${fField('部署环境', fReadonly(s.env), '单环境部署：应用直接发布到生产集群')}
          </div>
          ${fField('应用说明', `<textarea class="input" data-k="desc" rows="2" placeholder="一句话说明这个应用承载的业务" style="height:auto;padding:8px 10px;resize:vertical">${esc(s.desc || '')}</textarea>`)}`,
        validate: s => {
          if (!s.name) return '请填写应用名称';
          if (s.name.length > 24) return '应用名称不超过 24 个字符';
          if (DB.apps.some(a => a.name === s.name)) return `已存在同名应用「${s.name}」，请换一个名称`;
          return null;
        }
      },
      {
        name: '首个组件',
        render: s => `
          ${fCheck('createComp', '同时创建首个组件', s.createComp, '组件是构建与发布的边界，通常对应一个镜像', 'compFields')}
          <div id="compFields" class="float-fields">
            ${fField('组件名称', fInput('compName', s.compName, '例如：member-service'), '小写字母、数字与短横线', true)}
            <div class="form-row">
              ${fField('角色', fSelect('compRole', COMP_ROLES, s.compRole))}
              ${fField('构建方式', fSelect('compBuild', BUILD_MODES, s.compBuild), '运行时由首次构建自动识别')}
            </div>
            <div class="form-row">
              ${fField('镜像仓库', fInput('compImage', s.compImage, '默认 hub.corp.io/demo/<组件名>'))}
              ${fField('初始版本', fInput('compVersion', s.compVersion))}
            </div>
            ${fCheck('createWl', '同时创建首个工作负载', s.createWl, '工作负载是调度的最小单位，也可以稍后再加', 'wlFields')}
            <div id="wlFields" class="float-fields">
              <div class="form-row">
                ${fField('工作负载名称', fInput('wlName', s.wlName, '例如：member-service-api'), '', true)}
                ${fField('类型', fSelect('wlKind', WL_KINDS, s.wlKind))}
              </div>
              <div class="form-row">
                ${fField('副本数', fInput('wlReplicas', s.wlReplicas, '2', 'number'), 'CronJob 无需副本')}
                ${fField('调度位置', fSelect('wlWhere', wlSpots(), s.wlWhere))}
              </div>
              <div class="form-row">
                ${fField('CPU 规格', fSelect('wlCpu', ['0.2 / 1c', '0.5 / 2c', '1 / 2c', '2 / 4c', '4 / 8c'], s.wlCpu))}
                ${fField('内存规格', fSelect('wlMem', ['512Mi / 1Gi', '1Gi / 2Gi', '2 / 4Gi', '4 / 8Gi', '8 / 16Gi'], s.wlMem))}
              </div>
            </div>
          </div>`,
        validate: s => {
          if (!s.createComp) return null;
          if (!s.compName) return '请填写组件名称，或取消「同时创建首个组件」';
          if (!NAME_RE.test(s.compName)) return '组件名称只能包含小写字母、数字与短横线，并以字母或数字开头';
          if (s.createWl) {
            if (!s.wlName) return '请填写工作负载名称，或取消「同时创建首个工作负载」';
            if (!NAME_RE.test(s.wlName)) return '工作负载名称只能包含小写字母、数字与短横线';
            if (s.wlName === s.compName) return '工作负载名称不能与组件同名';
          }
          return null;
        }
      },
      {
        name: '确认创建',
        render: s => {
          const wl = s.createComp && s.createWl;
          return `
          <div class="kv" style="grid-template-columns:88px 1fr;row-gap:11px">
            <dt>应用</dt><dd><b>${esc(s.name)}</b> <span class="chip" style="margin-left:4px">${esc(s.level)}</span></dd>
            <dt>业务域</dt><dd>${esc(s.domain)} · 负责人 ${esc(s.owner || DB.user.name)}</dd>
            <dt>环境</dt><dd>${esc(s.env)}</dd>
            <dt>说明</dt><dd style="color:var(--text-2)">${esc(s.desc || '未填写')}</dd>
            <dt>组件</dt><dd>${s.createComp ? `<span class="mono">${esc(s.compName)}</span> · ${esc(s.compRole)} · ${esc(s.compBuild)} · ${esc(s.compVersion)}` : '<span class="muted">暂不创建</span>'}</dd>
            <dt>工作负载</dt><dd>${wl ? `<span class="mono">${esc(s.wlName)}</span> · ${esc(s.wlKind)} · ${s.wlKind === 'CronJob' ? '定时触发' : `${clampInt(s.wlReplicas, 0, 50, 2)} 副本`} · ${esc(s.wlWhere)}` : '<span class="muted">暂不创建</span>'}</dd>
          </div>
          <div class="warn-box" style="margin-top:14px">
            应用、组件、工作负载将同时创建，只写入本地演示数据，不会影响任何真实集群。
          </div>`;
        }
      }
    ],
    onSubmit: s => {
      const id = nextAppId(s.name);
      const comps = [];
      let firstComp = null;
      if (s.createComp) {
        const comp = makeComponent({
          name: s.compName, role: s.compRole, buildMode: s.compBuild,
          image: s.compImage, version: s.compVersion, owner: s.owner
        }, { id, owner: s.owner });
        if (s.createWl) addWorkloadToComponent(comp, buildWorkload(s, comp));
        comps.push(comp);
        firstComp = comp.name;
      }
      DB.apps.unshift({
        id,
        name: s.name,
        domain: s.domain,
        owner: s.owner || DB.user.name,
        level: s.level,
        status: '运行中',
        health: comps.length ? 100 : 0,
        desc: s.desc || '新建应用，尚未填写说明。',
        updated: nowStamp(),
        envs: [s.env],
        components: comps,
        pipelines: [],
        events: [{ t: '刚刚', k: 'ok', tx: `应用 <b>${esc(s.name)}</b> 创建完成` }]
      });
      DB.deps[id] = [];
      DB.access[id] = [];
      saveSnapshot();
      S.appComp = firstComp;
      S.appWl = null;
      S.appTab = 'components';
      goto(`#/apps/${id}/components`);
      toast(`应用 <b>${esc(s.name)}</b> 已创建`, 'ok');
      return null;
    }
  });
}

/* ---------- 新建组件 ---------- */
/* 组件工厂：创建路径统一补齐身份/构建/契约/默认规格 */
function makeComponent(src, app) {
  const role = src.role || '核心服务';
  const appId = app ? app.id : 'demo';
  return {
    id: src.id || `cmp-${slugify(src.name) || 'c'}`,
    name: src.name,
    role,
    runtime: RUNTIME_PENDING,
    buildMode: src.buildMode || 'Dockerfile 构建',
    image: src.image || `hub.corp.io/demo/${src.name}`,
    version: src.version || 'v1.0.0',
    serviceName: src.name,
    port: 8080,
    healthPath: '/healthz',
    readyPath: '/readyz',
    protocol: protoOf(role),
    owner: src.owner || (app ? app.owner : DB.user.name),
    repo: src.repo || `ssh://git.corp.io/${String(appId).split('-')[0]}/${src.name}`,
    branch: 'main',
    createdAt: nowStamp(),
    defaults: { replicas: 2, cpu: '1 / 2c', mem: '2 / 4Gi' },
    workloads: []
  };
}

function componentConfig(appId, compName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  if (!comp) return;
  formModal({
    title: `组件配置 · ${comp.name}`,
    desc: '身份、代码与构建、服务契约、默认规格。新建工作负载时按默认规格预填。',
    okText: '保存配置',
    wide: true,
    body: `
      <div class="form-sec">身份</div>
      ${fField('组件名称', fInput('name', comp.name, '例如：member-service'), '改名不会影响依赖、配置作用域与访问入口', true)}
      <div class="form-row">
        ${fField('角色', fSelect('role', COMP_ROLES, comp.role), '影响默认协议与组件列表的筛选')}
        ${fField('负责人', fInput('owner', comp.owner || app.owner))}
      </div>
      <div class="form-sec">代码与构建</div>
      <div class="form-row">
        ${fField('代码仓库', fInput('repo', comp.repo), '新建流水线时默认带出')}
        ${fField('分支', fInput('branch', comp.branch || 'main'))}
      </div>
      <div class="form-row">
        ${fField('构建方式', fSelect('buildMode', BUILD_MODES, comp.buildMode || 'Dockerfile 构建'))}
        ${fField('镜像版本', fReadonly(comp.version), '由发布流程写入，不在此处修改')}
      </div>
      <div class="form-sec">服务契约</div>
      <div class="form-row">
        ${fField('协议', fSelect('protocol', PROTOCOLS, comp.protocol || 'HTTP'))}
        ${fField('端口', fInput('port', comp.port, '8080', 'number'))}
      </div>
      <div class="form-row">
        ${fField('存活探针', fInput('healthPath', comp.healthPath, '/healthz'), '容器内 HTTP 路径')}
        ${fField('就绪探针', fInput('readyPath', comp.readyPath, '/readyz'))}
      </div>
      <div class="form-sec">默认规格</div>
      <div class="form-row cols3">
        ${fField('副本数', fInput('replicas', String(comp.defaults.replicas), '2', 'number'))}
        ${fField('CPU', fSelect('cpu', CPU_OPTS, comp.defaults.cpu))}
        ${fField('内存', fSelect('mem', MEM_OPTS, comp.defaults.mem))}
      </div>`,
    onSubmit: st => {
      const blocked = releaseLockReason(app, '修改组件配置', comp.name);
      if (blocked) return blocked;
      const port = clampInt(st.port, 1, 65535, comp.port || 8080);
      if (!/^[1-9]\d{1,4}$/.test(String(st.port))) return '端口需为 1-65535 之间的整数';
      for (const [k, label] of [['healthPath', '存活探针'], ['readyPath', '就绪探针']]) {
        if (!String(st[k] || '').startsWith('/')) return `${label}路径需以 / 开头`;
      }
      if (!st.repo) return '请填写代码仓库地址';
      const nextName = String(st.name || '').trim();
      if (!nextName) return '请填写组件名称';
      if (nextName !== comp.name) {
        if (!NAME_RE.test(nextName)) return '组件名称只能包含小写字母、数字与短横线，并以字母或数字开头';
        if (app.components.some(c => c !== comp && c.name === nextName)) return `应用内已存在组件「${nextName}」`;
      }
      const changed = [];
      if (nextName !== comp.name) {
        const oldName = comp.name;
        comp.name = nextName;
        comp.labels = Object.assign({}, comp.labels, { 'app.kubernetes.io/name': nextName });
        changed.push('名称');
        /* 实体引用都按 id 存，这里只需同步充当展示缓存的字段 */
        (DB.pipelines || []).forEach(p => {
          if (p.compId === comp.id || (p.appId === app.id && p.comp === oldName)) { p.comp = nextName; p.compId = comp.id; }
        });
        (DB.releases || []).forEach(r => {
          if (r.compId === comp.id || (r.appId === app.id && r.comp === oldName)) { r.comp = nextName; r.compId = comp.id; }
        });
        (DB.access[app.id] || []).forEach(x => {
          if (x.comp === oldName) { x.comp = nextName; return; }
          const b = String(x.backend || '');
          if (!x.comp && b.startsWith(oldName + ':')) x.backend = nextName + b.slice(oldName.length);
        });
        (DB.deps[app.id] || []).forEach(d => {
          if (d[0] === oldName) d[0] = nextName;
          if (d[1] === oldName) d[1] = nextName;
        });
        if (DB.edge && Array.isArray(DB.edge.dist)) DB.edge.dist.forEach(d => { if (d.app === app.name && d.comp === oldName) d.comp = nextName; });
        if (S.appComp === oldName) S.appComp = nextName;
        if (S.appWl && !findWl(comp, S.appWl)) S.appWl = null;
      }
      const apply = (k, v, label) => { if (comp[k] !== v) { comp[k] = v; changed.push(label); } };
      apply('role', st.role, '角色');
      apply('owner', st.owner, '负责人');
      apply('repo', st.repo, '代码仓库');
      apply('branch', st.branch || 'main', '分支');
      apply('buildMode', st.buildMode, '构建方式');
      const oldPort = comp.port;
      apply('protocol', st.protocol, '协议');
      apply('port', port, '端口');
      if (port !== oldPort) (DB.access[app.id] || []).forEach(x => { if (x.comp === comp.name && x.port === oldPort) x.port = port; });
      apply('healthPath', st.healthPath, '存活探针');
      apply('readyPath', st.readyPath, '就绪探针');
      const reps = clampInt(st.replicas, 0, 50, comp.defaults.replicas);
      const nextDefaults = { replicas: reps, cpu: st.cpu, mem: st.mem };
      if (JSON.stringify(nextDefaults) !== JSON.stringify(comp.defaults)) { comp.defaults = nextDefaults; changed.push('默认规格'); }
      if (!changed.length) return '配置没有变化';
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: '', tx: `组件 <b>${esc(comp.name)}</b> 配置更新：${esc(changed.join('、'))}` });
      saveSnapshot();
      route();
      toast(`已更新 ${esc(comp.name)}：${changed.join('、')}`, 'ok');
    }
  });
}

function newComponent(appId) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  formModal({
    title: '新建组件',
    desc: `归属于应用「${app.name}」。组件是构建与发布的边界，下辖若干工作负载。`,
    okText: '创建组件',
    body: `
      ${fField('组件名称', fInput('name', '', '例如：member-service'), '小写字母、数字与短横线', true)}
      <div class="form-row">
        ${fField('角色', fSelect('role', COMP_ROLES, '核心服务'))}
        ${fField('构建方式', fSelect('buildMode', BUILD_MODES, 'Dockerfile 构建'), '运行时由构建自动识别，创建时无需手填')}
      </div>
      <div class="form-row">
        ${fField('镜像仓库', fInput('image', '', '默认 hub.corp.io/demo/<组件名>'), '推送目标；引用已有镜像时填完整地址')}
        ${fField('初始版本', fInput('version', 'v1.0.0'))}
      </div>

      ${fCheck('withWl', '同时创建默认工作负载', true, `Deployment · 2 副本 · ${clusterOf('云端')}`)}`,
    onSubmit: st => {
      if (!st.name) return '请填写组件名称';
      if (!NAME_RE.test(st.name)) return '组件名称只能包含小写字母、数字与短横线，并以字母或数字开头';
      if (app.components.some(c => c.name === st.name)) return `应用内已存在组件「${st.name}」`;
      const comp = makeComponent({
        name: st.name, role: st.role, buildMode: st.buildMode,
        image: st.image, version: st.version
      }, app);
      if (st.withWl) {
        addWorkloadToComponent(comp, buildWorkload({
          wlName: `${st.name}-api`, wlKind: 'Deployment', wlReplicas: '2',
          wlWhere: '云端', wlCpu: '1 / 2c', wlMem: '2 / 4Gi'
        }, comp));
      }
      app.components.push(comp);
      app.updated = nowStamp();
      if (app.health === 0) app.health = 100;   // 历史字段，仅为兼容旧快照
      app.events.unshift({ t: clockNow(), k: 'ok', tx: `组件 <b>${esc(comp.name)}</b> 已创建` });
      saveSnapshot();
      S.appComp = comp.name;
      S.appWl = null;
      S.appTab = 'components';
      goto(`#/apps/${app.id}/components`);
      toast(`组件 <b>${esc(comp.name)}</b> 已创建，含 ${comp.workloads.length} 个工作负载`, 'ok');
      return null;
    }
  });
}

/* ---------- 新建工作负载 ---------- */
function newWorkloadGlobal() {
  if (!DB.apps.length) return toast('请先创建应用', 'warn');
  formModal({
    title: '新建工作负载 · 选择应用',
    desc: '工作负载必须归属某个组件；先选择应用，再选择目标组件。',
    okText: '下一步',
    body: fField('所属应用', fSelect('appId', DB.apps.map(a => [a.id, a.name]), DB.apps[0].id)),
    onSubmit: st => {
      const app = DB.apps.find(a => a.id === st.appId);
      if (!app) return '请选择应用';
      if (!app.components.length) return '该应用还没有组件，请先创建组件';
      formModal({
        title: `新建工作负载 · ${app.name}`,
        desc: '选择组件后填写负载信息。',
        okText: '下一步',
        body: fField('所属组件', fSelect('comp', app.components.map(c => [c.name, `${c.name} · ${c.role}`]), app.components[0].name)),
        onSubmit: s2 => {
          const comp = findComp(app, s2.comp);
          if (!comp) return '请选择组件';
          newWorkload(app.id, comp.name);
        }
      });
    }
  });
}

function newWorkload(appId, compName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  if (!comp) return;
  formModal({
    title: '新建工作负载',
    desc: `归属于组件「${comp.name}」。工作负载是调度的最小单位，决定副本、资源与调度位置。`,
    okText: '创建工作负载',
    body: `
      ${fField('工作负载名称', fInput('name', '', `例如：${comp.name}-api`), '小写字母、数字与短横线', true)}
      <div class="form-row">
        ${fField('类型', fSelect('kind', WL_KINDS, 'Deployment'))}
        ${fField('副本数', fInput('replicas', String(comp.defaults.replicas), '2', 'number'), '默认取组件规格')}
      </div>
      <div class="form-row">
        ${fField('调度位置', fSelect('where', wlSpots(), '云端'))}
        ${fField('镜像版本', fInput('image', comp.version))}
      </div>
      <div class="form-row">
        ${fField('CPU 规格', fSelect('cpu', CPU_OPTS, comp.defaults.cpu))}
        ${fField('内存规格', fSelect('mem', MEM_OPTS, comp.defaults.mem))}
      </div>
      ${S.modules.mesh ? '<div class="tiny muted">云端工作负载将自动注入 Sidecar（Service Mesh 已启用）。</div>' : ''}`,
    onSubmit: st => {
      const blocked = releaseLockReason(app, '新建工作负载', comp.name);
      if (blocked) return blocked;
      if (!st.name) return '请填写工作负载名称';
      if (!NAME_RE.test(st.name)) return '工作负载名称只能包含小写字母、数字与短横线，并以字母或数字开头';
      if (comp.workloads.some(w => w.name === st.name)) return `组件内已存在工作负载「${st.name}」`;
      const wl = buildWorkload({
        wlName: st.name, wlKind: st.kind, wlReplicas: st.replicas,
        wlWhere: st.where, wlCpu: st.cpu, wlMem: st.mem, wlImage: st.image
      }, comp);
      addWorkloadToComponent(comp, wl);
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'ok', tx: `工作负载 <b>${esc(wl.name)}</b> 已创建（${esc(wl.kind)} · ${wReady(wl)}）` });
      saveSnapshot();
      S.appComp = comp.name;
      S.appWl = wl.name;
      S.appTab = 'components';
      goto(`#/apps/${app.id}/components`);
      toast(`工作负载 <b>${esc(wl.name)}</b> 已创建`, 'ok');
      return null;
    }
  });
}

/* ---------- 编辑工作负载 ---------- */
function editWorkload(appId, compName, wlName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  const wl = comp && findWl(comp, wlName);
  if (!wl) return;
  const isCron = wl.kind === 'CronJob';
  formModal({
    title: `编辑工作负载 · ${wl.name}`,
    desc: '调整名称、副本与资源规格；镜像版本由发布流程写入，避免绕过版本记录。',
    okText: '保存修改',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('工作负载名称', fInput('name', wl.name, '', true), '小写字母、数字与短横线，组件内唯一')}
        ${fField('类型', fReadonly(wl.kind), 'Deployment / StatefulSet / CronJob / EdgeApp')}
      </div>
      <div class="form-row">
        ${fField('镜像', fReadonly(wl.image), '由发布流程更新，请使用右上「发布」')}
        ${fField('副本数', fInput('replicas', String(wl.replicas), isCron ? '0' : '2', 'number'), isCron ? '定时任务不维护常驻副本' : '0 表示停止')}
      </div>
      <div class="form-row">
        ${fField('CPU', fSelect('cpu', CPU_OPTS, wl.cpu))}
        ${fField('内存', fSelect('mem', MEM_OPTS, wl.mem))}
      </div>`,
    onSubmit: st => {
      const blocked = releaseLockReason(app, '修改工作负载', compName);
      if (blocked) return blocked;
      const name = String(st.name || '').trim();
      if (!name) return '请填写工作负载名称';
      if (!NAME_RE.test(name)) return '工作负载名称只能包含小写字母、数字与短横线，并以字母或数字开头';
      if (name !== wl.name && comp.workloads.some(w => w.name === name)) return `组件内已存在工作负载「${name}」`;
      const oldName = wl.name;
      wl.name = name;
      if (isCron) { wl.replicas = 0; wl.readyN = 0; wl.ready = '—'; wl.status = '已完成'; }
      else setReplicas(wl, clampInt(st.replicas, 0, 50, wl.replicas));
      wl.cpu = st.cpu;
      wl.mem = st.mem;
      if (S.appWl === oldName) S.appWl = name;
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: '', tx: `工作负载 <b>${esc(oldName)}</b>${oldName !== name ? ` 改名为 <b>${esc(name)}</b>` : ' 配置已更新'}` });
      saveSnapshot();
      if (oldName !== name && location.hash.startsWith('#/workloads/')) goto(wlUrl(app.id, comp.name, name));
      else route();
      toast('工作负载已保存', 'ok');
    }
  });
}

/* ---------- 删除 ---------- */
function deleteWorkload(appId, compName, wlName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  const wl = comp && findWl(comp, wlName);
  if (!wl) return;
  formModal({
    title: '删除工作负载？',
    desc: `${compName} / ${wlName}`,
    danger: true,
    okText: '删除',
    body: `<div class="danger-box">删除后该负载的副本会被回收，相关告警与监控曲线一并移除。此操作不可撤销。</div>`,
    onSubmit: () => {
      const blocked = releaseLockReason(app, '删除工作负载', compName);
      if (blocked) return blocked;
      const wasPrimary = comp.primaryWorkloadId === wl.id;
      comp.workloads = comp.workloads.filter(w => w.name !== wlName);
      if (wasPrimary) {
        comp.primaryWorkloadId = comp.workloads[0] ? comp.workloads[0].id : '';
        if (comp.workloads[0]) comp.workloads[0].role = 'primary';
      }
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'warn', tx: `工作负载 <b>${esc(wlName)}</b> 已删除` });
      saveSnapshot();
      S.appWl = null;
      goto(`#/apps/${app.id}/components`);
      toast(`工作负载 <b>${esc(wlName)}</b> 已删除`, 'warn');
      return null;
    }
  });
}

function deleteComponent(appId, compName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  if (!comp) return;
  const wlCount = comp.workloads.length;
  const boundPipes = DB.pipelines.filter(p => p.appId === appId && p.comp === compName);
  const accessRefs = (DB.access[appId] || []).filter(x => x.comp === compName);
  formModal({
    title: '删除组件？',
    desc: `${app.name} / ${compName}`,
    danger: true,
    okText: '删除组件',
    body: `<div class="danger-box">
        该组件下辖 <b>${wlCount}</b> 个工作负载${boundPipes.length ? `、<b>${boundPipes.length}</b> 条流水线` : ''}，以及它的发布记录与组件作用域配置，将一并删除。
      </div>
      ${accessRefs.length ? `<div class="danger-box" style="margin-top:10px">
        仍有 <b>${accessRefs.length}</b> 条访问入口指向该组件：
        <div class="mono" style="font-size:11px;margin-top:5px">${accessRefs.slice(0, 4).map(x => esc(x.url)).join('、')}${accessRefs.length > 4 ? ' 等' : ''}</div>
        <div style="margin-top:6px">建议先在「访问入口」改绑后端；如确认下线，可勾选一并删除。</div>
      </div>
      ${fCheck('force', '同时删除这些访问入口', false)}` : ''}
      ${app.components.length === 1 ? '<div class="warn-box" style="margin-top:10px">这是应用内最后一个组件，删除后应用将没有任何可部署单元。</div>' : ''}`,
    onSubmit: st => {
      const blocked = releaseLockReason(app, '删除组件', compName);
      if (blocked) return blocked;
      if (accessRefs.length && !st.force) return `仍有 ${accessRefs.length} 条访问入口指向该组件，请先解绑或勾选同时删除`;
      if (accessRefs.length) DB.access[appId] = (DB.access[appId] || []).filter(x => x.comp !== compName);
      app.components = app.components.filter(c => c.name !== compName);
      DB.pipelines = DB.pipelines.filter(p => !(p.appId === appId && p.comp === compName));
      app.pipelines = app.pipelines.filter(pid => DB.pipelines.some(p => p.id === pid));
      DB.releases = DB.releases.filter(r => !(r.appId === appId && r.comp === compName));
      if (DB.edge) DB.edge.dist = (DB.edge.dist || []).filter(d => !(d.app === app.name && d.comp === compName));
      const gone = findComp(app, compName);
      const goneKeys = new Set([compName, gone && gone.id].filter(Boolean));
      if (DB.config[appId]) DB.config[appId] = DB.config[appId].filter(c => !goneKeys.has(c.scope));
      if (DB.deps[appId]) DB.deps[appId] = DB.deps[appId].filter(([a, b]) => !goneKeys.has(a) && !goneKeys.has(b));
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'warn', tx: `组件 <b>${esc(compName)}</b> 及其 ${wlCount} 个工作负载已删除` });
      saveSnapshot();
      S.appComp = app.components[0] ? app.components[0].name : null;
      S.appWl = null;
      goto(`#/apps/${app.id}/components`);
      toast(`组件 <b>${esc(compName)}</b> 已删除`, 'warn');
      return null;
    }
  });
}

function deleteApp(app) {
  const wlCount = app.components.reduce((s, c) => s + c.workloads.length, 0);
  const running = app.components.flatMap(c => c.workloads)
    .filter(w => w.kind !== 'CronJob' && w.replicas > 0);
  formModal({
    title: '删除应用？',
    desc: `${app.name} · ${app.level}`,
    danger: true,
    okText: '删除应用',
    body: `<div class="danger-box">
        将级联删除 <b>${app.components.length}</b> 个组件、<b>${wlCount}</b> 个工作负载，以及该应用的访问入口与依赖声明。
      </div>
      ${running.length ? `<div class="danger-box" style="margin-top:10px">
        当前仍有 <b>${running.length}</b> 个工作负载在运行：<span class="mono" style="font-size:11px">${running.slice(0, 3).map(w => esc(w.name)).join('、')}${running.length > 3 ? ' 等' : ''}</span>。
        按规则 R-05，应先停用应用；确认要中断线上流量时勾选下面的强制删除。
      </div>
      ${fCheck('force', '我知道这会中断线上流量，强制删除', false)}` : ''}
      ${fField('输入应用名称确认', fInput('confirm', '', app.name), `需完整输入「${app.name}」`)}`,
    onSubmit: st => {
      const blocked = releaseLockReason(app, '删除应用');
      if (blocked) return blocked;
      if (st.confirm !== app.name) return `请输入完整名称「${app.name}」以确认删除`;
      if (running.length && !st.force) return `仍有 ${running.length} 个工作负载在运行，请先停用应用，或勾选强制删除`;
      DB.apps = DB.apps.filter(a => a.id !== app.id);
      delete DB.access[app.id];
      if (DB.accessApplied) delete DB.accessApplied[app.id];
      delete DB.deps[app.id];
      delete DB.config[app.id];
      DB.pipelines = DB.pipelines.filter(p => p.appId !== app.id);
      DB.releases = DB.releases.filter(r => r.appId !== app.id);
      DB.alerts = (DB.alerts || []).filter(a => a.app !== app.name);
      if (DB.edge) DB.edge.dist = (DB.edge.dist || []).filter(d => d.app !== app.name);
      saveSnapshot();
      S.appComp = null;
      S.appWl = null;
      goto('#/apps');
      toast(`应用 <b>${esc(app.name)}</b> 已删除`, 'warn');
      return null;
    }
  });
}

/* ---------- 应用级更多操作 ---------- */
function editApp(app) {
  formModal({
    title: `编辑应用 · ${app.name}`,
    desc: '应用名称会同步到绑定的流水线；业务域用于列表分组与搜索。',
    okText: '保存修改',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('应用名称', fInput('name', app.name, '例如：智慧零售中台'), '应用内唯一，可中文', true)}
        ${fField('业务域', fInput('domain', app.domain, '例如：零售业务域'), '用于列表分组与搜索', true)}
      </div>
      <div class="form-row">
        ${fField('负责人', fInput('owner', app.owner, DB.user.name), '默认继承当前登录用户', true)}
        ${fField('等级', fSelect('level', ['P0', 'P1', 'P2', 'P3'], app.level || 'P2'), '影响发布审批要求')}
      </div>
      ${fField('描述', `<textarea class="input" data-k="desc" rows="3" placeholder="说明业务边界与主要链路">${esc(app.desc || '')}</textarea>`)}`,
    onSubmit: st => {
      const blocked = releaseLockReason(app, '修改应用信息');
      if (blocked) return blocked;
      const name = String(st.name || '').trim();
      if (!name) return '请填写应用名称';
      if (DB.apps.some(a => a.id !== app.id && a.name === name)) return `应用名称「${name}」已存在`;
      if (!String(st.domain || '').trim()) return '请填写业务域';
      if (!String(st.owner || '').trim()) return '请填写负责人';
      const oldName = app.name;
      app.name = name;
      app.domain = String(st.domain).trim();
      app.owner = String(st.owner).trim();
      app.level = st.level;
      app.desc = String(st.desc || '').trim();
      app.updated = nowStamp();
      (DB.pipelines || []).forEach(p => { if (p.appId === app.id) p.app = name; });
      (DB.alerts || []).forEach(a => { if (a.app === oldName) a.app = name; });
      if (DB.edge && Array.isArray(DB.edge.dist)) DB.edge.dist.forEach(d => { if (d.app === oldName) d.app = name; });
      app.events.unshift({ t: clockNow(), k: '', tx: `应用信息已更新${oldName !== name ? `：<b>${esc(oldName)}</b> → <b>${esc(name)}</b>` : ''}` });
      saveSnapshot();
      route();
      toast('应用信息已保存', 'ok');
    }
  });
}

function appMenu(app) {
  const stopped = appStatus(app) === '已停止';
  const mask = formModal({
    title: `管理「${app.name}」`,
    desc: '停用只影响调度与入口，不删除任何配置。',
    okText: '关闭',
    plain: true,
    hideCancel: true,
    body: `<div class="menu-list">
      <div class="mrow" data-act2="edit">
        ${icon('edit', '', 15)}
        <div><b>编辑应用</b><span>名称、业务域、负责人、等级与描述</span></div>
      </div>
      <div class="mrow" data-act2="toggle">
        ${icon(stopped ? 'send' : 'archive', '', 15)}
        <div><b>${stopped ? '启用应用' : '停用应用'}</b><span>${stopped ? '恢复调度与访问入口' : '暂停所有工作负载，入口保持配置'}</span></div>
      </div>
      <div class="mrow danger" data-act2="del">
        ${icon('archive', '', 15)}
        <div><b>删除应用</b><span>级联删除组件、工作负载与访问入口</span></div>
      </div>
    </div>`,
    onSubmit: () => null
  });
  mask.querySelector('[data-act2=edit]').onclick = () => { mask.remove(); editApp(app); };
  mask.querySelector('[data-act2=toggle]').onclick = () => {
    setAppRunning(app, stopped);
    app.updated = nowStamp();
    app.events.unshift({ t: clockNow(), k: stopped ? 'ok' : 'warn', tx: `应用 <b>${esc(app.name)}</b> 已${stopped ? '启用' : '停用'}` });
    saveSnapshot();
    mask.remove();
    route();
    toast(`应用已${stopped ? '启用' : '停用'}`, stopped ? 'ok' : 'warn');
  };
  mask.querySelector('[data-act2=del]').onclick = () => { mask.remove(); deleteApp(app); };
}

/* ---------- 扩缩容 ---------- */
function scaleApp(app) {
  const blocked = releaseLockReason(app, '调整副本');
  if (blocked) return toast(blocked, 'warn');
  const rows = app.components.flatMap(c => c.workloads.filter(w => w.kind !== 'CronJob').map(w => ({ comp: c.name, wl: w })));
  if (!rows.length) return toast('该应用暂无可扩缩容的工作负载', 'warn');
  formModal({
    title: '扩缩容',
    desc: `${app.name} · ${rows.length} 个可调副本的工作负载`,
    okText: '应用变更',
    wide: true,
    body: rows.map(({ comp, wl }, i) => {
      const cur = wl.replicas || 0;
      return `<div class="scale-row">
        <div class="nm"><b>${esc(wl.name)}</b><span>${esc(comp)} · ${esc(wl.kind)} · ${esc(wl.where)}</span></div>
        <span class="cur">当前 ${Number.isFinite(cur) ? cur : 0}</span>
        <input type="number" min="0" max="50" data-k="r${i}" value="${Number.isFinite(cur) ? cur : 0}" />
      </div>`;
    }).join(''),
    onSubmit: st => {
      const changes = [];
      rows.forEach(({ wl }, i) => {
        const before = wl.replicas || 0;
        const n = clampInt(st['r' + i], 0, 50, before);
        if (n === before) return;
        setReplicas(wl, n);
        changes.push(`${wl.name} ${before} → ${n}`);
      });
      if (!changes.length) return '副本数没有变化';
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'ok', tx: `应用扩缩容：${changes.map(esc).join('，')}` });
      saveSnapshot();
      goto(`#/apps/${app.id}/components`);
      toast(`已应用 ${changes.length} 项副本变更`, 'ok');
      return null;
    }
  });
}


