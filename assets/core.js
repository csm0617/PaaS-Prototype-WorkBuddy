/* ==========================================================
   核心：状态、快照、工具、图标、导航、顶栏、弹窗、表单
   ========================================================== */

/* ==========================================================
   CloudPaaS Console — 原型交互
   可插拔内核：Service Mesh / 云边端协同 均为独立模块，关闭后基础功能不受影响
   ========================================================== */

const DB = window.DB;
DB.releases = DB.releases || [];
DB.config = DB.config || {};
DB.moduleCfg = DB.moduleCfg || {};   // 注册表里的每个实体都应有初值，快照才是完整镜像
const LS_KEY = 'paas.prototype.modules.v1';
const LS_ENV = 'paas.prototype.env.v1';
const LS_DB = 'paas.prototype.db.v1';

const S = {
  modules: Object.assign({ mesh: true, edge: true }, JSON.parse(localStorage.getItem(LS_KEY) || '{}')),
  env: localStorage.getItem(LS_ENV) || 'prod',
  appTab: 'components',
  appComp: null,
  appWl: null,
  wlFilter: 'all',
  appQ: '',
  wlQ: '',
  accessQ: '',
  accessType: 'all',
  accessStatus: 'all',
  page: { apps: 1, comps: 1, wls: 1, access: 1 },
  sort: {
    apps: { key: 'updated', dir: 'desc' },
    comps: { key: 'name', dir: 'asc' },
    wls: { key: 'name', dir: 'asc' },
    access: { key: 'app', dir: 'asc' }
  },
  pipelineTab: 'overview',
  traceQ: '',
  traceSvc: 'all',
  traceSt: 'all',
  traceSel: '',
  traceSpan: 0,
  traceRange: '1h',
  wlTab: 'overview',
  wlRange: '1h',
  wlKey: '',
  wlPending: null,
  pipeStage: -1,
  pipeRunKey: '',
  compQ: '',
  compApp: 'all',
  compFilter: 'all',
  cfgQ: '',
  cfgScope: 'all-app',
  cfgType: 'all',
  cfgShown: {},
  ruleQ: '',
  ruleType: 'all',
  ioShown: {},
  alertSt: 'all',
  storeQ: '',
  yamlDiff: false,
  logs: { key: '', lines: [], level: 'all', q: '', container: '', paused: false, pending: 0, follow: true },
  term: [],
  termKey: ''
};

/* ---------------- 演示数据快照 ----------------
   原型里的新建/删除/扩缩容会写入 localStorage，刷新后依然保留；
   需要回到初始演示数据时，可在「设计说明」页重置。

   持久化由 PERSIST 注册表驱动：新增实体只需在表里加一行，
   save / load 自动同步，不必在两处手写字段白名单。
   —— 依赖边（deps）此前就因漏登记而不被保存，刷新即丢。 */
const SCHEMA_V = 2;

const PERSIST = [
  { key: 'apps' },
  { key: 'access' },
  { key: 'accessApplied' },           // 最近一次发布后生效的访问入口快照
  { key: 'pipelines' },
  { key: 'releases' },
  { key: 'config' },
  { key: 'deps' },                    // 组件依赖边：可编辑，必须落盘
  { key: 'alerts' },                  // 告警处置状态
  { key: 'clusters' },
  { key: 'envs' },
  { key: 'roles' },
  { key: 'moduleCfg' },
  { key: 'meshRules', path: ['mesh', 'rules'] },
  { key: 'edgeNodes', path: ['edge', 'nodes'] },
  { key: 'edgeDist', path: ['edge', 'dist'] },
  { key: 'edgeDevices', path: ['edge', 'devices'] }
];
function entryPath(e) { return e.path || [e.key]; }
function snapGet(path) { return path.reduce((o, k) => (o == null ? o : o[k]), DB); }
function snapSet(path, val) {
  let o = DB;
  for (let i = 0; i < path.length - 1; i++) {
    if (!o[path[i]]) o[path[i]] = {};
    o = o[path[i]];
  }
  o[path[path.length - 1]] = val;
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(LS_DB);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || (d.v !== 1 && d.v !== SCHEMA_V)) return;
    PERSIST.forEach(e => {
      const v = d[e.key];
      if (v === undefined || v === null) return;
      const path = entryPath(e);
      const wantArr = Array.isArray(snapGet(path));
      const okShape = wantArr ? Array.isArray(v) : (typeof v === 'object' && !Array.isArray(v));
      if (okShape) snapSet(path, v);
    });
  } catch (e) { /* 快照损坏时退回 data.js 初始数据 */ }
}
function saveSnapshot() {
  try {
    const out = { v: SCHEMA_V };
    PERSIST.forEach(e => { out[e.key] = snapGet(entryPath(e)); });
    localStorage.setItem(LS_DB, JSON.stringify(out));
  } catch (e) { /* 存储不可用时降级为纯内存态 */ }
}
function resetSnapshot() {
  try { localStorage.removeItem(LS_DB); } catch (e) { /* 忽略 */ }
  location.reload();
}
loadSnapshot();

/* 标签：三层实体通用的扩展位。批量操作、策略绑定、成本归集都挂在这里，
   避免每来一个需求就往 schema 上加一个特设字段。 */
const SCHED_CODE = { '云端': 'cloud', '边缘': 'edge', '端侧': 'device' };

/* ---------------- 模型归一化 ----------------
   replicas / readyN 是结构化字段，ready 字符串只作展示；
   历史快照与应用市场数据没有这些字段时在此补齐。 */
function normalizeModel() {
  DB.apps.forEach(a => {
    if (!a.labels) a.labels = { 'platform.io/app': a.id, 'platform.io/level': a.level, 'platform.io/domain': a.domain };
    if (!a.annotations) a.annotations = {};
    a.components.forEach(c => {
      if (!c.serviceName) c.serviceName = c.name;
      if (!c.port) c.port = 8080;
      if (!c.healthPath) c.healthPath = '/healthz';
      if (!c.readyPath) c.readyPath = '/readyz';
      if (!c.owner) c.owner = a.owner || DB.user.name;
      if (!c.repo) c.repo = `ssh://git.corp.io/${a.id.split('-')[0]}/${c.name}`;
      if (!c.branch) c.branch = 'main';
      if (!c.protocol) c.protocol = protoOf(c.role);
      if (!c.buildMode) c.buildMode = 'Dockerfile 构建';
      if (!c.createdAt) c.createdAt = a.updated || nowStamp();
      if (!c.labels) c.labels = { 'app.kubernetes.io/name': c.name, 'platform.io/service': c.serviceName, 'platform.io/role': c.role };
      if (!c.annotations) c.annotations = {};
      c.workloads.forEach(w => {
        const m = String(w.ready || '').match(/(\d+)\s*\/\s*(\d+)/);
        if (typeof w.replicas !== 'number') w.replicas = m ? +m[2] : (w.kind === 'CronJob' ? 0 : 1);
        if (typeof w.readyN !== 'number') w.readyN = m ? Math.min(+m[1], w.replicas) : w.replicas;
        w.ready = w.kind === 'CronJob' ? '—' : `${w.readyN}/${w.replicas}`;
        if (!w.labels) w.labels = {
          'app.kubernetes.io/instance': w.name,
          'platform.io/schedule': SCHED_CODE[w.where] || 'cloud',
          'platform.io/workload-kind': String(w.kind || '').toLowerCase()
        };
        if (!w.annotations) w.annotations = {};
      });
      if (!c.defaults) {
        const w0 = c.workloads[0] || {};
        c.defaults = {
          replicas: typeof w0.replicas === 'number' ? w0.replicas : 2,
          cpu: fitSpec(w0.cpu, CPU_OPTS, '1 / 2c'),
          mem: fitSpec(w0.mem, MEM_OPTS, '2 / 4Gi')
        };
      }
    });
  });
}
function wReady(w) { return w.kind === 'CronJob' ? '—' : `${w.readyN}/${w.replicas}`; }

/* ---------------- 访问入口 ----------------
   目标以「组件 + 端口」存储，旧快照里的 backend 字符串在启动时迁移。 */
function accessTarget(app, e) {
  return (app.components || []).find(c => c.name === e.comp || c.id === e.comp);
}
function accessBackend(e) {
  return e.comp ? `${e.comp}:${e.port || '—'}` : (e.backend || '—');
}
function accessPorts(comp) {
  return [...new Set([Number(comp.port) || 8080, ...(comp.ports || []).map(Number)])];
}
function normalizeAccess() {
  Object.values(DB.access || {}).forEach(list => (list || []).forEach(e => {
    if (!e.comp && e.backend) {
      const s = String(e.backend);
      const i = s.lastIndexOf(':');
      e.comp = i > 0 ? s.slice(0, i) : s;
      e.port = i > 0 ? Number(s.slice(i + 1)) || 0 : 0;
    }
    if (e.port === undefined) e.port = 0;
  }));
}

/* 访问入口的「期望配置」与「已生效配置」：
   DB.access 是期望值，DB.accessApplied 是最近一次发布后生效的快照。 */
function normalizeAccessApplied() {
  DB.accessApplied = DB.accessApplied || {};
  DB.apps.forEach(app => {
    if (!Array.isArray(DB.accessApplied[app.id])) {
      DB.accessApplied[app.id] = JSON.parse(JSON.stringify(DB.access[app.id] || []));
    }
  });
}
function accessSig(e) {
  return JSON.stringify([e.url, e.type, e.comp, e.port, e.scope, e.tls, e.auth, e.status, e.note || '']);
}
function accessPending(appId) {
  const desired = DB.access[appId] || [];
  const applied = (DB.accessApplied && DB.accessApplied[appId]) || [];
  const dm = new Map(desired.map(e => [e.url, e]));
  const am = new Map(applied.map(e => [e.url, e]));
  const urls = new Set();
  let added = 0, removed = 0, changed = 0;
  dm.forEach((e, url) => {
    const old = am.get(url);
    if (!old) { added++; urls.add(url); }
    else if (accessSig(e) !== accessSig(old)) { changed++; urls.add(url); }
  });
  am.forEach((e, url) => { if (!dm.has(url)) { removed++; urls.add(url); } });
  return { count: added + removed + changed, added, removed, changed, urls };
}
function applyAccess(app) {
  DB.accessApplied = DB.accessApplied || {};
  DB.accessApplied[app.id] = JSON.parse(JSON.stringify(DB.access[app.id] || []));
}

/* 组件的「主工作负载」引用：主负载是发布与访问链路默认指向的运行单元 */
function normalizeWorkloadRoles() {
  DB.apps.forEach(app => app.components.forEach(c => {
    if (!c.workloads.length) { c.primaryWorkloadId = ''; return; }
    if (!c.primaryWorkloadId || !c.workloads.some(w => w.id === c.primaryWorkloadId)) {
      c.primaryWorkloadId = c.workloads[0].id;
    }
    c.workloads.forEach(w => {
      if (!w.role) w.role = w.id === c.primaryWorkloadId ? 'primary' : (w.where === '边缘' ? 'edge' : 'secondary');
    });
  }));
}

/* 工作负载自己的运行策略：更新、探针覆盖、生命周期、弹性、调度与标签注解 */
function normalizeWorkloadRuntime() {
  DB.apps.forEach(app => app.components.forEach(comp => comp.workloads.forEach(w => {
    w.runtime = w.runtime || {};
    const r = w.runtime;
    r.update = Object.assign({ strategy: 'RollingUpdate', maxSurge: '25%', maxUnavailable: '0', minReadySeconds: 10 }, r.update || {});
    r.probes = r.probes || {};
    if (typeof r.probes.inherit !== 'boolean') r.probes.inherit = true;
    r.probes.liveness = Object.assign({ path: comp.healthPath || '/healthz', port: comp.port || 8080, initialDelay: 15, period: 10, timeout: 1, failure: 3 }, r.probes.liveness || {});
    r.probes.readiness = Object.assign({ path: comp.readyPath || '/readyz', port: comp.port || 8080, initialDelay: 5, period: 5, timeout: 1, failure: 3 }, r.probes.readiness || {});
    r.probes.startup = Object.assign({ enabled: false, path: comp.healthPath || '/healthz', port: comp.port || 8080, initialDelay: 5, period: 5, timeout: 1, failure: 30 }, r.probes.startup || {});
    r.lifecycle = Object.assign({ grace: 30, preStop: '' }, r.lifecycle || {});
    r.autoscaling = Object.assign({ enabled: false, min: 2, max: 10, targetCPU: 70 }, r.autoscaling || {});
    /* 调度约束：nodeSelector 允许被清空，因此只在缺失时写入默认值 */
    r.schedule = r.schedule || {};
    if (!r.schedule.nodeSelector) {
      r.schedule.nodeSelector = { 'topology.kubernetes.io/region': w.where === '云端' ? 'cn-east-1' : 'edge' };
    }
    if (!Array.isArray(r.schedule.tolerations)) r.schedule.tolerations = [];
    r.schedule.spread = Object.assign({ enabled: false, topologyKey: 'topology.kubernetes.io/zone', maxSkew: 1, whenUnsatisfiable: 'ScheduleAnyway' }, r.schedule.spread || {});
    /* 定时任务专属：按名称给出更贴近真实场景的默认周期 */
    r.cron = Object.assign({
      schedule: /daily/i.test(w.name) ? '0 2 * * *' : '*/5 * * * *',
      concurrencyPolicy: 'Forbid',
      suspend: false,
      startingDeadline: 120,
      successHistory: 3,
      failedHistory: 1
    }, r.cron || {});
    /* 边缘应用专属：目标节点与离线策略 */
    r.edge = Object.assign({
      targetSelector: 'topology.kubernetes.io/region=edge',
      count: w.replicas || 12,
      offlinePolicy: 'replay',
      bufferSeconds: 3600
    }, r.edge || {});
    if (!Array.isArray(r.revisions)) r.revisions = [];
    r.labels = Object.assign({}, w.labels || {}, r.labels || {});
    r.annotations = Object.assign({}, w.annotations || {}, r.annotations || {});
  })));
}

/* 发布期间的写操作保护：同一应用不允许并发发布；
   组件/负载级写操作只锁正在发布的那个组件，应用元信息与访问入口按应用级加锁。 */
const ACTIVE_RELEASE_STATUSES = ['待审批', '发布中'];
function activeReleaseForApp(app, compName) {
  return (DB.releases || []).find(r => r.appId === app.id
    && ACTIVE_RELEASE_STATUSES.includes(r.status)
    && (!compName || r.comp === compName));
}
function releaseLockReason(app, action, compName) {
  const r = activeReleaseForApp(app, compName);
  return r ? `组件 ${r.comp} 存在进行中的发布 ${r.version}（${r.status}），请先完成、回滚或驳回后再${action}` : '';
}

/* 应用健康度与状态由工作负载聚合推导，不手工设置：
   健康度 = Σ 就绪实例 / Σ 期望实例；没有期望实例时返回 null（展示为 —） */
function appHealth(app) {
  let ready = 0, want = 0;
  app.components.forEach(c => c.workloads.forEach(w => {
    if (w.kind === 'CronJob' || !w.replicas) return;
    want += w.replicas;
    ready += Math.min(w.readyN || 0, w.replicas);
  }));
  if (!want) return null;
  return Math.round(ready / want * 1000) / 10;
}
function appStatus(app) {
  const wls = app.components.flatMap(c => c.workloads);
  if (!wls.length) return '待部署';
  const running = wls.filter(w => w.kind !== 'CronJob' && w.replicas > 0);
  if (!running.length) return '已停止';
  const bad = running.some(w => w.status === '异常' || w.status === '失败' || (w.readyN || 0) < w.replicas);
  return bad ? '异常' : '运行中';
}
function healthText(app) {
  const h = appHealth(app);
  const c = h === null ? 'var(--text-3)' : h > 97 ? 'var(--success)' : h > 90 ? 'var(--warning)' : 'var(--danger)';
  return { v: h === null ? '—' : h, color: c };
}
/* 停用/启用：真正把副本置零，而不是只改一个状态字段 */
function setAppRunning(app, on) {
  app.components.forEach(c => c.workloads.forEach(w => {
    if (w.kind === 'CronJob') return;
    if (!on) { w.pausedReplicas = w.replicas; setReplicas(w, 0); }
    else if (w.pausedReplicas) { setReplicas(w, w.pausedReplicas); delete w.pausedReplicas; }
  }));
}
function setReplicas(w, n) {
  w.replicas = n;
  w.readyN = n;
  w.ready = wReady(w);
  w.status = n === 0 ? '已停止' : '运行中';
}

/* ---------------- 实体解析 ----------------
   组件与工作负载都有稳定的 id，name 只是展示名与唯一性约束。
   解析器同时接受 id 和 name：旧快照、旧链接、旧书签都能继续工作。 */
function findComp(app, key) {
  if (!app || !key) return null;
  return app.components.find(c => c.id === key) || app.components.find(c => c.name === key) || null;
}
function findWl(comp, key) {
  if (!comp || !key) return null;
  return comp.workloads.find(w => w.id === key) || comp.workloads.find(w => w.name === key) || null;
}
function compLabel(app, scope) {
  if (scope === 'all') return '全部组件';
  const c = findComp(app, scope);
  return c ? c.name : scope;
}
function scopeMatches(app, scope, key) {
  if (scope === 'all' || key === 'all') return scope === key;
  const c = findComp(app, key);
  return c ? (scope === c.id || scope === c.name) : scope === key;
}

/* 迁移：把「按名字」的引用改为按 id，幂等。
   依赖边、配置作用域一旦按名字存，重命名组件就会静默断链。 */
function migrateRefs() {
  DB.apps.forEach(app => {
    const seen = new Set();
    let seq = 0;
    app.components.forEach(c => {
      if (!c.id) c.id = `cmp-${slugify(c.name) || 'c'}`;
      while (seen.has(c.id)) c.id = `cmp-${slugify(c.name) || 'c'}-${++seq}`;
      seen.add(c.id);
      c.workloads.forEach(w => {
        if (!w.id) w.id = `wl-${slugify(w.name) || 'w'}`;
        while (seen.has(w.id)) w.id = `wl-${slugify(w.name) || 'w'}-${++seq}`;
        seen.add(w.id);
      });
    });
    const idOf = new Map(app.components.map(c => [c.name, c.id]));
    (DB.deps[app.id] || []).forEach(e => {
      if (!Array.isArray(e)) return;
      if (idOf.has(e[0])) e[0] = idOf.get(e[0]);
      if (idOf.has(e[1])) e[1] = idOf.get(e[1]);
    });
    (DB.config[app.id] || []).forEach(c => {
      if (c.scope !== 'all' && idOf.has(c.scope)) c.scope = idOf.get(c.scope);
    });
    (DB.pipelines || []).forEach(p => {
      if (p.appId === app.id && !p.compId && idOf.has(p.comp)) p.compId = idOf.get(p.comp);
    });
    (DB.releases || []).forEach(r => {
      if (r.appId === app.id && !r.compId && idOf.has(r.comp)) r.compId = idOf.get(r.comp);
    });
  });
}

/* ---------------- 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/overview';
  const [path, query = ''] = raw.split('?');
  return { path, seg: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function num(n) { return Number(n).toLocaleString('en-US'); }

/* ---------------- 通用分页 ----------------
   列表页共用：按 key 记住页码，过滤条件变化时由调用方重置到第 1 页。 */
const PAGE_SIZE = { apps: 6, comps: 10, wls: 12, access: 10 };
function paginate(list, key, size) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / (size || PAGE_SIZE[key] || 10)));
  const page = Math.min(Math.max(1, S.page[key] || 1), pages);
  S.page[key] = page;
  const start = (page - 1) * (size || PAGE_SIZE[key] || 10);
  return { rows: list.slice(start, start + (size || PAGE_SIZE[key] || 10)), total, pages, page };
}
function pager(key, meta, unit = '条') {
  if (!meta.total) return '';
  const nums = [];
  const from = Math.max(1, meta.page - 2), to = Math.min(meta.pages, meta.page + 2);
  for (let n = from; n <= to; n++) nums.push(n);
  return `<div class="pager">
    <span class="pager-info">共 ${meta.total} ${unit} · 第 ${meta.page} / ${meta.pages} 页</span>
    <button class="btn sm" ${meta.page > 1 ? act('pageGo', key, meta.page - 1) : 'disabled'}>上一页</button>
    ${nums.map(n => n === meta.page
      ? `<button class="btn sm primary" disabled>${n}</button>`
      : `<button class="btn sm" ${act('pageGo', key, n)}>${n}</button>`).join('')}
    <button class="btn sm" ${meta.page < meta.pages ? act('pageGo', key, meta.page + 1) : 'disabled'}>下一页</button>
  </div>`;
}

/* ---------------- 列表排序 ----------------
   表头与排序下拉共用：点击同一字段在升/降序之间切换。 */
const SORT_GETTERS = {
  apps: {
    name: a => a.name, updated: a => a.updated || '', health: a => appHealth(a) ?? -1,
    comps: a => a.components.length, wl: a => a.components.reduce((s, c) => s + c.workloads.length, 0)
  },
  comps: {
    name: c => c.name, app: c => c.app, role: c => c.role || '', version: c => c.version || '',
    wl: c => c.wl, ready: c => c.want ? c.ready / c.want : -1, bad: c => c.bad
  },
  wls: {
    name: w => w.name, app: w => w.app, comp: w => w.comp, kind: w => w.kind,
    replicas: w => Number(w.replicas) || 0, status: w => w.status, where: w => w.where,
    restarts: w => Number(w.restarts) || 0
  },
  access: {
    app: r => r.app, type: r => r.type, url: r => r.url, comp: r => r.comp || '',
    status: r => r.status, pending: r => r.pending ? 1 : 0
  }
};
function applySort(list, key) {
  const s = S.sort[key] || { key: '', dir: 'asc' };
  const get = (SORT_GETTERS[key] || {})[s.key];
  if (!get) return list;
  const dir = s.dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va ?? '').localeCompare(String(vb ?? ''), 'zh-CN') * dir;
  });
}
function sortTh(label, key, field, cls = '') {
  const s = S.sort[key];
  const on = s.key === field;
  return `<th class="${cls}"><span class="sort-th ${on ? 'on' : ''}" ${act('sortSet', key, field)}>${label}<i>${on ? (s.dir === 'asc' ? '↑' : '↓') : '↕'}</i></span></th>`;
}

/* 标签徽标：超出 max 条的折叠为 +N，完整值放 title */
function labelChips(labels, max = 3) {
  const es = Object.entries(labels || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!es.length) return '';
  const one = ([k, v]) => `<span class="lbl" title="${esc(k)}">${esc(String(k).split('/').pop())}=${esc(v)}</span>`;
  const head = es.slice(0, max).map(one).join('');
  const rest = es.length > max
    ? `<span class="lbl more" title="${esc(es.slice(max).map(([k, v]) => `${k}=${v}`).join('   '))}">+${es.length - max}</span>`
    : '';
  return `<span class="lbl-set">${head}${rest}</span>`;
}

/* 时间戳：2026-10-29 20:41 / 20:41 */
function pad2(n) { return String(n).padStart(2, '0'); }
function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function clockNow() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

/* 路由跳转：目标与当前一致时手动重绘（hashchange 不会触发） */
function goto(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

/* 名称工具 */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function nextAppId(name) {
  const slug = slugify(name);
  if (!slug) {
    let i = DB.apps.length + 1;
    while (DB.apps.some(a => a.id === `app-${i}`)) i++;
    return `app-${i}`;
  }
  let id = slug, i = 2;
  while (DB.apps.some(a => a.id === id)) id = `${slug}-${i++}`;
  return id;
}


const STK = {
  '运行中': 'ok', '健康': 'ok', '在线': 'ok', '成功': 'ok', '完成': 'ok', '已完成': 'ok',
  '生效中': 'ok', '已启用': 'ok', '已就绪': 'ok', '已通知': 'info', '进行中': 'info',
  '告警': 'warn', '降级': 'warn', '维护中': 'warn', '处理中': 'warn',
  '待调度': 'muted', '待执行': 'muted', '已停用': 'muted', '已忽略': 'muted', '跳过': 'muted', '未启用': 'muted',
  '未处理': 'bad', '失败': 'bad', '离线': 'bad', '已停止': 'bad', '严重': 'bad',
  '异常': 'bad', '待部署': 'muted', '已关闭': 'muted',
  '警告': 'warn', '提示': 'muted', 'P0': 'bad', 'P1': 'warn', 'P2': 'muted',
  '正常': 'ok', '慢调用': 'warn', '错误': 'bad', '超时': 'bad',
  '待激活': 'warn', '接入中': 'info', '已封锁': 'muted',
  '已绑定': 'ok', '未绑定': 'warn'
};
function badge(t, k) { return `<span class="badge ${k || STK[t] || 'muted'}">${t === '运行中' || t === '健康' || t === '在线' ? '<i></i>' : ''}${esc(t)}</span>`; }
function pbadge(t) {
  const m = { '运行中': 'info', '成功': 'ok', '失败': 'bad', '已完成': 'ok', '进行中': 'info', '待调度': 'muted', '已就绪': 'info' };
  return `<span class="badge ${m[t] || 'muted'}">${t === '运行中' ? '<i></i>' : ''}${esc(t)}</span>`;
}

/* ---------------- 图标 ---------------- */
const ICONS = {
  grid: '<rect x="2.2" y="2.2" width="5" height="5" rx="1.3"/><rect x="8.8" y="2.2" width="5" height="5" rx="1.3"/><rect x="2.2" y="8.8" width="5" height="5" rx="1.3"/><rect x="8.8" y="8.8" width="5" height="5" rx="1.3"/>',
  box: '<path d="M8 1.9 14 5.1v5.8L8 14.1 2 10.9V5.1z"/><path d="M2 5.1l6 3.2 6-3.2"/><path d="M8 8.3v5.8"/>',
  layers: '<path d="M8 1.9 14 4.9 8 7.9 2 4.9z"/><path d="M2 8l6 3 6-3"/><path d="M2 11.1l6 3 6-3"/>',
  flow: '<circle cx="3.9" cy="4" r="1.7"/><circle cx="12.1" cy="4" r="1.7"/><circle cx="8" cy="12.2" r="1.7"/><path d="M5.6 4h4.8"/><path d="M3.9 5.7v2.6c0 1 .8 1.8 1.8 1.8h1"/><path d="M12.1 5.7v2.6c0 1-.8 1.8-1.8 1.8h-1"/>',
  archive: '<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3.2 6v6.4c0 .9.7 1.6 1.6 1.6h6.4c.9 0 1.6-.7 1.6-1.6V6"/><path d="M6.5 9h3"/>',
  share: '<circle cx="12.4" cy="3.8" r="1.8"/><circle cx="3.6" cy="8" r="1.8"/><circle cx="12.4" cy="12.2" r="1.8"/><path d="M5.2 7.2 10.9 4.6"/><path d="M5.2 8.8l5.7 2.6"/>',
  git: '<circle cx="4.6" cy="3.6" r="1.7"/><circle cx="4.6" cy="12.4" r="1.7"/><circle cx="11.6" cy="6.4" r="1.7"/><path d="M4.6 5.3v5.4"/><path d="M11.6 8.1c0 2.2-1.9 2.6-4.2 3"/>',
  topo: '<circle cx="8" cy="3.4" r="1.7"/><circle cx="3.4" cy="12" r="1.7"/><circle cx="12.6" cy="12" r="1.7"/><path d="M6.8 4.6 4.4 10.5"/><path d="M9.2 4.6l2.4 5.9"/><path d="M5.1 12h5.8"/>',
  cloud: '<path d="M4.6 12.2h7.2c1.4 0 2.5-1.1 2.5-2.5 0-1.3-1-2.4-2.3-2.5C11.8 5.4 10.3 4.2 8.5 4.2c-1.9 0-3.5 1.4-3.7 3.2-1.3.2-2.3 1.3-2.3 2.6 0 1.2 1 2.2 2.1 2.2z"/>',
  send: '<path d="M14 2 7.3 8.7"/><path d="M14 2 9.6 14l-2.3-5.3L2 6.4z"/>',
  cpu: '<rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.4"/><path d="M6.6 1.8v2.6M9.4 1.8v2.6M6.6 11.6v2.6M9.4 11.6v2.6M1.8 6.6h2.6M1.8 9.4h2.6M11.6 6.6h2.6M11.6 9.4h2.6"/>',
  server: '<rect x="2.2" y="2.6" width="11.6" height="4.4" rx="1.2"/><rect x="2.2" y="9" width="11.6" height="4.4" rx="1.2"/><path d="M5 4.8h.01M5 11.2h.01"/>',
  bell: '<path d="M12.2 10.2V7.4a4.2 4.2 0 0 0-8.4 0v2.8L2.6 11.6h10.8z"/><path d="M6.6 13.4a1.6 1.6 0 0 0 2.8 0"/>',
  puzzle: '<path d="M6.2 2.4h3.2v1.5c0 .7.6 1.2 1.2 1.2.7 0 1.2-.5 1.2-1.2V2.4h1.6c.6 0 1 .4 1 1v2.8h-1.5c-.7 0-1.2.6-1.2 1.2s.5 1.2 1.2 1.2h1.5v2.8c0 .6-.4 1-1 1h-2.8v-1.5c0-.7-.6-1.2-1.2-1.2s-1.2.5-1.2 1.2v1.5H4.4c-.6 0-1-.4-1-1V8.6h1.5c.7 0 1.2-.6 1.2-1.2s-.5-1.2-1.2-1.2H3.4V3.4c0-.6.4-1 1-1h1.8z"/>',
  users: '<circle cx="6" cy="5.2" r="2.3"/><path d="M1.9 13.2c0-2.3 1.8-4 4.1-4s4.1 1.7 4.1 4"/><path d="M11 3.2a2.3 2.3 0 0 1 0 4.5"/><path d="M12.2 9.6c1.2.5 2 1.7 2 3.1"/>',
  doc: '<path d="M4 1.9h5.2L13 5.7v8.4c0 .6-.5 1-1 1H4c-.6 0-1-.4-1-1V2.9c0-.6.4-1 1-1z"/><path d="M9 1.9v4h4"/><path d="M5.4 8.6h5M5.4 11h3.4"/>',
  shield: '<path d="M8 1.9 13.4 4v4.2c0 2.9-2.2 5.3-5.4 6-3.2-.7-5.4-3.1-5.4-6V4z"/><path d="M5.9 8 7.4 9.5 10.2 6.7"/>',
  search: '<circle cx="7.2" cy="7.2" r="4.4"/><path d="M10.6 10.6 14 14"/>',
  help: '<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.4 1.9c-.4.1-.6.5-.6.9v.4"/><path d="M8 11.6h.01"/>',
  globe: '<circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4"/><path d="M8 1.8c1.8 1.8 2.8 3.9 2.8 6.2S9.8 12.4 8 14.2c-1.8-1.8-2.8-3.9-2.8-6.2S6.2 3.6 8 1.8z"/>',
  copy: '<rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.4"/><path d="M10.6 5.4V3.6c0-.7-.6-1.2-1.2-1.2H3.6c-.7 0-1.2.6-1.2 1.2v5.8c0 .7.6 1.2 1.2 1.2h1.8"/>',
  topo2: '<rect x="1.8" y="6" width="4.4" height="4" rx="1.2"/><rect x="9.8" y="1.8" width="4.4" height="4" rx="1.2"/><rect x="9.8" y="10.2" width="4.4" height="4" rx="1.2"/><path d="M6.2 8h1.6c.6 0 1-.4 1-1V5.8c0-.5.4-.9.9-.9h.1"/><path d="M6.2 8h1.6c.6 0 1 .4 1 1v1.2c0 .5.4.9.9.9h.1"/>',
  trace: '<circle cx="3.4" cy="3.4" r="1.5"/><path d="M6.1 3.4h7.5"/><circle cx="3.4" cy="8" r="1.5"/><path d="M6.1 8h5.2"/><circle cx="3.4" cy="12.6" r="1.5"/><path d="M6.1 12.6h8.1"/>',
  refresh: '<path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8"/><path d="M13.6 2.4v3.4h-3.4"/>',
  plus: '<path d="M8 3.4v9.2M3.4 8h9.2"/>',
  chev: '<path d="M6 4l4 4-4 4"/>',
  edit: '<path d="M11.1 2.6l2.3 2.3-8 8-2.9.6.6-2.9z"/><path d="M9.7 4l2.3 2.3"/>',
  power: '<path d="M8 2.2v5.4"/><path d="M12.3 4.7a5.6 5.6 0 1 1-8.6 0"/>'
};
function icon(n, cls = 'ico', size = 15) {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
}

/* ---------------- 导航定义 ---------------- */
const NAV = [
  { label: '工作台', items: [{ label: '概览', icon: 'grid', route: '/overview' }] },
  {
    label: '应用管理', items: [
      { label: '应用列表', icon: 'box', route: '/apps' },
      { label: '组件', icon: 'topo2', route: '/components' },
      { label: '工作负载', icon: 'layers', route: '/workloads' },
      { label: '访问入口', icon: 'globe', route: '/access' }
    ]
  },
  {
    label: '持续交付', items: [
      { label: '流水线', icon: 'flow', route: '/cicd' },
      { label: '制品仓库', icon: 'archive', route: '/artifacts' }
    ]
  },
  {
    label: 'Service Mesh', module: 'mesh', mini: '模块', items: [
      { label: '服务治理', icon: 'share', route: '/mesh' },
      { label: '流量规则', icon: 'git', route: '/mesh/traffic' },
      { label: '服务拓扑', icon: 'topo', route: '/mesh/topology' },
      { label: '链路追踪', icon: 'trace', route: '/mesh/tracing' }
    ]
  },
  {
    label: '云边端协同', module: 'edge', mini: '模块', items: [
      { label: '边缘节点', icon: 'cloud', route: '/edge/nodes' },
      { label: '应用分发', icon: 'send', route: '/edge/distribute' },
      { label: '端设备', icon: 'cpu', route: '/edge/devices' }
    ]
  },
  {
    label: '运维中心', items: [
      { label: '集群管理', icon: 'server', route: '/ops/clusters' },
      { label: '存储', icon: 'archive', route: '/storage' },
      { label: '告警中心', icon: 'bell', route: '/ops/alerts' }
    ]
  },
  {
    label: '平台管理', items: [
      { label: '模块管理', icon: 'puzzle', route: '/admin/modules' },
      { label: '角色权限', icon: 'users', route: '/admin/rbac' },
      { label: '设计说明', icon: 'doc', route: '/design' }
    ]
  }
];

/* ---------------- 侧边栏 / 顶栏 ---------------- */
function renderSidebar() {
  const path = parseHash().path;
  let html = `
    <div class="brand">
      <div class="brand-mark">CP</div>
      <div class="brand-name">CloudPaaS<em>Console</em></div>
    </div>
    <nav class="nav">`;

  NAV.forEach(g => {
    const off = g.module && !S.modules[g.module];
    if (off) return;
    html += `<div class="nav-label"><span class="dot"></span>${g.label}${g.mini ? `<span class="mini">${g.mini}</span>` : ''}</div>`;
    g.items.forEach(it => {
      const on = path === it.route || (it.route !== '/mesh' && path.startsWith(it.route + '/')) ||
        (path.startsWith('/apps/') && it.route === '/apps') ||
        (path.startsWith('/cicd/') && it.route === '/cicd');
      html += `<div class="nav-item ${on ? 'active' : ''}" data-route="${it.route}">
        ${icon(it.icon)}<span>${it.label}</span></div>`;
    });
  });

  const meshOff = !S.modules.mesh, edgeOff = !S.modules.edge;
  html += `</nav>
    <div class="sidebar-foot">
      <div class="kernel-card">
        <div class="t">平台内核</div>
        <div class="m">
          <span class="kdot"><i></i>基础平台</span>
          <span class="kdot ${meshOff ? 'off' : ''}"><i></i>Mesh</span>
          <span class="kdot ${edgeOff ? 'off' : ''}"><i></i>云边端</span>
        </div>
      </div>
    </div>`;

  const sb = $('#sidebar');
  sb.innerHTML = html;
  sb.querySelectorAll('.nav-item').forEach(n => {
    n.onclick = () => {
      const r = n.dataset.route;
      /* 侧边栏进入列表页时清空上次的搜索与筛选，跨模块跳转仍保留定位条件 */
      if (r === '/apps') { S.appQ = ''; S.page.apps = 1; }
      if (r === '/components') { S.compQ = ''; S.compApp = 'all'; S.compFilter = 'all'; S.page.comps = 1; }
      if (r === '/workloads') { S.wlQ = ''; S.wlFilter = 'all'; S.page.wls = 1; }
      if (r === '/access') { S.accessQ = ''; S.accessType = 'all'; S.accessStatus = 'all'; S.page.access = 1; }
      location.hash = r;
    };
  });
}

function renderTopbar() {
  /* 单环境部署：不提供环境切换 */
  $('#topbar').innerHTML = `
    <div class="crumb" id="crumb"><a class="crumb-link" ${act('go', '/overview')}>控制台</a><span class="sep">/</span><b>概览</b></div>
    <div class="search gsearch">
      ${icon('search', '', 14)}
      <input id="gsearch" placeholder="搜索应用 / 组件 / 工作负载" autocomplete="off"
        oninput="globalSearch(this.value)" onkeydown="globalSearchKey(event)" />
      <kbd>F</kbd>
      <div class="gs-list" id="gsList"></div>
    </div>
    <button class="icon-btn" title="帮助与快捷键" ${act('help')}>${icon('help', '', 16)}</button>
    <button class="icon-btn" title="告警" ${act('go', '/ops/alerts')}>${icon('bell', '', 16)}<span class="dot-red"></span></button>
    <div class="avatar" title="${DB.user.name} · ${DB.user.role}">${DB.user.avatar}</div>`;
}
/* 面包屑：按当前 hash 推导层级，父级可点，最后一级为当前位置 */
function crumbTrail(label) {
  const seg = parseHash().seg;
  const items = [{ n: '控制台', h: '/overview' }];
  const appName = id => (DB.apps.find(a => a.id === id) || {}).name;
  if (seg[0] === 'apps') {
    items.push({ n: '应用列表', h: '/apps' });
    if (seg[1]) {
      const name = appName(seg[1]);
      if (seg[2]) {
        if (name) items.push({ n: name, h: `/apps/${seg[1]}/components` });
        const tab = { components: '组件与工作负载', topology: '组件拓扑', access: '访问入口', config: '配置与密钥', releases: '发布记录', events: '事件', mesh: '流量治理', overview: '概览' }[seg[2]];
        items.push({ n: tab || label });
      } else items.push({ n: label || name || seg[1] });
    }
  } else if (seg[0] === 'workloads' && seg[1]) {
    items.push({ n: '工作负载', h: '/workloads' });
    items.push({ n: label });
  } else if (seg[0] === 'cicd' && seg[1]) {
    items.push({ n: '流水线', h: '/cicd' });
    const p = DB.pipelines.find(x => x.id === seg[1]);
    if (seg[2]) {
      if (p) items.push({ n: p.name, h: `/cicd/${p.id}` });
      items.push({ n: label });
    } else items.push({ n: label || (p && p.name) || seg[1] });
  } else if (seg[0] === 'edge' && seg[1] === 'nodes' && seg[2]) {
    items.push({ n: '边缘节点', h: '/edge/nodes' });
    items.push({ n: label });
  } else if (seg[0] === 'ops' && seg[1] === 'clusters' && seg[2]) {
    items.push({ n: '集群管理', h: '/ops/clusters' });
    items.push({ n: label });
  } else {
    items.push({ n: label });
  }
  return items;
}
function setCrumb(t) {
  const el = $('#crumb');
  if (!el) return;
  const items = crumbTrail(t);
  el.innerHTML = items.map((it, i) => {
    const node = i === items.length - 1 ? `<b>${esc(it.n)}</b>` : `<a class="crumb-link" ${act('go', it.h)}>${esc(it.n)}</a>`;
    return (i ? '<span class="sep">/</span>' : '') + node;
  }).join('');
}

/* 顶栏全局搜索：应用 / 组件 / 工作负载三层的跨页跳转 */
function globalSearch(q) {
  const box = $('#gsList');
  if (!box) return;
  const v = String(q || '').trim().toLowerCase();
  if (!v) { box.classList.remove('on'); box.innerHTML = ''; return; }
  const hits = [];
  DB.apps.forEach(a => {
    if (a.name.toLowerCase().includes(v)) hits.push({ k: '应用', n: a.name, d: `${a.domain} · ${a.owner}`, h: `#/apps/${a.id}` });
    a.components.forEach(c => {
      if (c.name.toLowerCase().includes(v)) hits.push({ k: '组件', n: c.name, d: `${a.name} · ${c.role || ''} · ${c.version}`, h: `#/apps/${a.id}/components`, comp: c.name });
      c.workloads.forEach(w => {
        if (w.name.toLowerCase().includes(v)) hits.push({ k: '负载', n: w.name, d: `${a.name} / ${c.name} · ${w.kind}`, h: wlUrl(a.id, c.name, w.name) });
      });
    });
  });
  box.innerHTML = hits.length
    ? hits.slice(0, 8).map(x => `<div class="gs-item" data-h="${esc(x.h)}" data-comp="${esc(x.comp || '')}" ${act('globalGo')}>
        <span class="chip">${x.k}</span><b>${esc(x.n)}</b><span class="tiny muted">${esc(x.d)}</span>
      </div>`).join('')
    : '<div class="gs-empty">没有匹配的应用 / 组件 / 工作负载</div>';
  box.classList.add('on');
}
function globalGo(el) {
  if (el.dataset.comp) S.appComp = el.dataset.comp;
  location.hash = el.dataset.h;
  const inp = $('#gsearch'); if (inp) inp.value = '';
  const box = $('#gsList'); if (box) { box.classList.remove('on'); box.innerHTML = ''; }
}
function globalSearchKey(e) {
  const box = $('#gsList');
  if (e.key === 'Escape') { e.target.value = ''; box.classList.remove('on'); box.innerHTML = ''; return; }
  if (e.key === 'Enter') {
    const first = box && box.querySelector('.gs-item');
    if (first) globalGo(first);
  }
}
document.addEventListener('keydown', e => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
    const inp = $('#gsearch');
    if (inp) { e.preventDefault(); inp.focus(); inp.select(); }
  }
});
document.addEventListener('click', e => {
  const box = $('#gsList');
  if (box && box.classList.contains('on') && !e.target.closest('.gsearch')) {
    box.classList.remove('on'); box.innerHTML = '';
  }
});

/* ---------------- Toast / Modal ---------------- */
function toast(msg, kind = '') {
  const w = $('#toastWrap');
  const d = document.createElement('div');
  d.className = 'toast ' + kind;
  d.innerHTML = `<span class="ti">${kind === 'warn' ? '⚠' : kind === 'ok' ? '✓' : '◈'}</span><span>${msg}</span>`;
  w.appendChild(d);
  setTimeout(() => { d.style.transition = '.25s'; d.style.opacity = '0'; d.style.transform = 'translateX(10px)'; setTimeout(() => d.remove(), 260); }, 2600);
}

/* 弹窗键盘：Esc 关闭，Enter 提交（textarea 与按钮除外） */
function bindModalKeys(mask, close, onEnter) {
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Enter' || e.isComposing) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
    e.preventDefault();
    if (onEnter) return onEnter();
    const ok = mask.querySelector('[data-mbtn=ok]');
    if (ok) ok.click();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

function openModal(o) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">
    <div class="mh"><h3>${o.title}</h3>${o.desc ? `<p>${o.desc}</p>` : ''}</div>
    <div class="mb">${o.body || ''}</div>
    <div class="mf">
      <button class="btn" data-mbtn="cancel">${o.cancelText || '取消'}</button>
      <button class="btn ${o.danger ? 'danger' : 'primary'}" data-mbtn="ok">${o.okText || '确定'}</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  let unbind = null;
  const close = () => { if (unbind) unbind(); mask.remove(); };
  unbind = bindModalKeys(mask, close);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('[data-mbtn=cancel]').onclick = close;
  mask.querySelector('[data-mbtn=ok]').onclick = () => { close(); o.onOk && o.onOk(); };
}

/* ---------------- 表单 / 向导 ---------------- */
/* 收集所有带 data-k 的控件为对象 */
function readForm(root) {
  const out = {};
  root.querySelectorAll('[data-k]').forEach(el => {
    out[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  return out;
}

/* 可选区块联动：勾选后才允许填写 */
function bindToggle(root) {
  root.querySelectorAll('[data-toggle]').forEach(cb => {
    const box = root.querySelector('#' + cb.dataset.toggle);
    if (!box) return;
    const sync = () => {
      box.style.opacity = cb.checked ? '1' : '.45';
      box.style.pointerEvents = cb.checked ? '' : 'none';
      box.querySelectorAll('input, select').forEach(el => { el.disabled = !cb.checked; });
    };
    cb.addEventListener('change', sync);
    sync();
  });
}

/* 单步表单弹窗：onSubmit 返回字符串则作为错误提示留在弹窗内 */
function formModal(o) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal ${o.wide ? 'wide' : ''}">
    <div class="mh"><h3>${o.title}</h3>${o.desc ? `<p>${o.desc}</p>` : ''}</div>
    <div class="mb">${o.body || ''}<div class="form-err" hidden style="display:none"></div></div>
    <div class="mf">
      <button class="btn" data-mbtn="cancel"${o.hideCancel ? ' style="display:none"' : ''}>${o.cancelText || '取消'}</button>
      <button class="btn ${o.danger ? 'danger' : o.plain ? '' : 'primary'}" data-mbtn="ok">${o.okText || '确定'}</button>
    </div>
  </div>`;
  document.body.appendChild(mask);

  const err = mask.querySelector('.form-err');
  let unbind = null;
  const close = () => { if (unbind) unbind(); mask.remove(); };
  const showErr = m => { err.textContent = m; err.hidden = false; err.style.display = 'block'; };
  const clearErr = () => { err.hidden = true; err.style.display = 'none'; };
  unbind = bindModalKeys(mask, close);

  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('[data-mbtn=cancel]').onclick = close;
  mask.querySelector('[data-mbtn=ok]').onclick = () => {
    const msg = o.onSubmit ? o.onSubmit(readForm(mask)) : null;
    if (msg) return showErr(msg);
    close();
  };
  mask.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener('input', clearErr);
    el.addEventListener('change', clearErr);
  });
  bindToggle(mask);
  const first = mask.querySelector('input:not([type=checkbox]), select, textarea');
  if (first) setTimeout(() => first.focus(), 40);
  return mask;
}

/* 多步向导：steps = [{ name, render(state), validate(state) }] */
function wizard(o) {
  const state = Object.assign({}, o.state || {});
  const steps = o.steps;
  let idx = 0;

  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal wide">
    <div class="wiz-head"><h3>${o.title}</h3>${o.desc ? `<p>${o.desc}</p>` : ''}</div>
    <div class="wiz-steps"></div>
    <div class="mb"></div>
    <div class="mf">
      <button class="btn" data-mbtn="cancel">取消</button>
      <button class="btn" data-wbtn="prev">上一步</button>
      <button class="btn primary" data-wbtn="next">下一步</button>
    </div>
  </div>`;
  document.body.appendChild(mask);

  const stepsBar = mask.querySelector('.wiz-steps');
  const body = mask.querySelector('.mb');
  const prevBtn = mask.querySelector('[data-wbtn=prev]');
  const nextBtn = mask.querySelector('[data-wbtn=next]');
  const err = document.createElement('div');
  err.className = 'form-err';
  err.hidden = true;
  err.style.display = 'none';

  const showErr = m => { err.textContent = m; err.hidden = false; err.style.display = 'block'; };
  const clearErr = () => { err.hidden = true; err.style.display = 'none'; };

  function paint() {
    stepsBar.innerHTML = steps.map((s, i) => `
      <div class="wiz-step ${i === idx ? 'on' : ''} ${i < idx ? 'done' : ''}">
        <span class="n">${i < idx ? '✓' : i + 1}</span><span>${s.name}</span>
      </div>${i < steps.length - 1 ? '<span class="wiz-ln"></span>' : ''}`).join('');
    prevBtn.style.display = idx === 0 ? 'none' : '';
    nextBtn.textContent = idx === steps.length - 1 ? (o.okText || '创建') : '下一步';

    body.innerHTML = steps[idx].render(state);
    body.appendChild(err);
    clearErr();
    bindToggle(body);
    body.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!state[k];
      else if (state[k] !== undefined && state[k] !== null) el.value = state[k];
      const sync = () => { state[k] = el.type === 'checkbox' ? el.checked : el.value; clearErr(); };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    if (o.afterPaint) o.afterPaint(body, state);
    const first = body.querySelector('input:not([type=checkbox]), select, textarea');
    if (first) setTimeout(() => first.focus(), 40);
  }

  let unbind = null;
  const close = () => { if (unbind) unbind(); mask.remove(); };
  unbind = bindModalKeys(mask, close, () => nextBtn.click());
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('[data-mbtn=cancel]').onclick = close;
  prevBtn.onclick = () => { if (idx > 0) { idx--; paint(); } };
  nextBtn.onclick = () => {
    const step = steps[idx];
    const msg = step.validate ? step.validate(state) : null;
    if (msg) return showErr(msg);
    if (idx < steps.length - 1) { idx++; paint(); return; }
    const out = o.onSubmit ? o.onSubmit(state) : null;
    if (out) return showErr(out);
    close();
  };

  paint();
  return mask;
}

/* 表单片段 */
function fField(label, control, hint = '', req = false) {
  return `<div class="field"><label>${label}${req ? '<span class="req">*</span>' : ''}</label>${control}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}
function fInput(k, value = '', ph = '', type = 'text') {
  return `<input class="input" data-k="${k}" type="${type}" value="${esc(value)}" placeholder="${esc(ph)}" />`;
}
/* 只读字段：值由上游流程写入，表单不接收修改 */
function fReadonly(value, ph = '') {
  return `<input class="input" value="${esc(value)}" placeholder="${esc(ph)}" readonly
    style="background:#f4f6fb;color:var(--text-2);cursor:not-allowed" />`;
}
function fSelect(k, opts, value, attrs = '') {
  return `<select class="input" data-k="${k}"${attrs}>${opts.map(o => {
    const v = Array.isArray(o) ? o[0] : o, n = Array.isArray(o) ? o[1] : o;
    return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(n)}</option>`;
  }).join('')}</select>`;
}
function fArea(k, value = '', ph = '', rows = 3) {
  return `<textarea class="input" data-k="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(value)}</textarea>`;
}
function fCheck(k, title, checked, hint = '', toggleId = '') {
  return `<label class="check">
    <input type="checkbox" data-k="${k}"${checked ? ' checked' : ''}${toggleId ? ` data-toggle="${toggleId}"` : ''} />
    <span><b>${title}</b>${hint ? `<em>${hint}</em>` : ''}</span>
  </label>`;
}


/* ---------------- 模块开关 ---------------- */
function toggleModule(key, on) {
  const meta = {
    mesh: { name: 'Service Mesh', off: '服务治理、流量规则、服务拓扑、链路追踪、Sidecar 注入与 mTLS 将不可用；应用发布仍按原生 Service 负载均衡执行。' },
    edge: { name: '云边端协同', off: '边缘节点纳管、边缘应用分发、端设备管理将不可用；边缘类工作负载会保留在云端调度，断网自治能力关闭。' }
  }[key];
  const apply = () => {
    S.modules[key] = on;
    localStorage.setItem(LS_KEY, JSON.stringify(S.modules));
    renderSidebar();
    route();
    toast(`<b>${meta.name}</b> 已${on ? '启用' : '关闭'}，基础平台功能不受影响`, on ? 'ok' : 'warn');
  };

  if (on) return apply();

  openModal({
    title: `关闭 ${meta.name} 模块？`,
    desc: '该模块为可插拔能力，关闭仅影响模块内的功能，平台基础功能保持可用。',
    danger: false,
    okText: '确认关闭',
    body: `<div style="font-size:12.5px;line-height:1.9;color:var(--text-2)">
      <div style="margin-bottom:10px">关闭后将发生以下变化：</div>
      <div style="background:#fdf3e3;border:1px solid #f6e2be;border-radius:8px;padding:11px 13px;margin-bottom:12px;color:#8a5a0a">
        ${meta.off}
      </div>
      <div style="display:flex;gap:8px;align-items:flex-start">
        <span style="color:var(--success);font-weight:700">✓</span>
        <span><b>不受影响：</b>应用 / 组件 / 工作负载模型、CI/CD 流水线、集群与节点运维、告警、权限体系。</span>
      </div>
      <div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px">
        <span style="color:var(--success);font-weight:700">✓</span>
        <span>配置与历史数据完整保留，随时可重新启用并恢复。</span>
      </div>
    </div>`,
    onOk: apply
  });
}

/* ---------------- 事件委托 ----------------
   模板只输出 data-act / data-args，不再内联 JS；
   参数经 JSON + HTML 转义，名称含引号也不会截断事件。 */
function act(name, ...args) {
  return `data-act="${esc(name)}" data-args="${esc(JSON.stringify(args))}"`;
}
const ACTIONS = {
  go: h => goto(h),
  goto: h => goto(h),
  toast: (msg, kind) => toast(msg, kind),
  statusFilter: (sel, status, el) => listStatus(sel, status, el),
  globalGo: el => globalGo(el),
  clearWl: () => { S.appWl = null; route(); },
  setWlFilter: v => wlFilterSet(v),
  setYamlDiff: v => { S.yamlDiff = String(v) === 'true'; route(); },
  scaleAppById: id => scaleApp(DB.apps.find(a => a.id === id)),
  appMenuById: id => appMenu(DB.apps.find(a => a.id === id)),
  help: () => helpModal(),
  retryRoute: () => route(),
  pageGo: (key, page) => {
    S.page[key] = page;
    const routes = { apps: '/apps', comps: '/components', wls: '/workloads', access: '/access' };
    if (typeof syncListUrl === 'function') syncListUrl(key, routes[key]);
    if (key === 'apps' && $('#appsGrid')) return paintApps();
    if (key === 'comps' && $('#comp-rows')) return paintComps();
    if (key === 'wls' && $('#wl-rows')) return paintWls();
    if (key === 'access' && $('#access-rows')) return paintAccess();
    route();
  },
  sortSet: (key, field) => {
    const cur = S.sort[key];
    S.sort[key] = { key: field, dir: cur.key === field && cur.dir === 'asc' ? 'desc' : 'asc' };
    S.page[key] = 1;
    const routes = { apps: '/apps', comps: '/components', wls: '/workloads', access: '/access' };
    if (typeof syncListUrl === 'function') syncListUrl(key, routes[key]);
    route();
  }
};
/* 这几个动作需要知道触发元素本身，委托时作为最后一个参数传入 */
const EL_ACTIONS = new Set(['statusFilter', 'globalGo']);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-stop]');
  if (!el) return;
  if (el.dataset.stop) e.stopPropagation();
  const name = el.dataset.act;
  if (!name) return;
  let args;
  try { args = JSON.parse(el.dataset.args || '[]'); }
  catch (err) { console.warn('[act] 参数解析失败:', name); return; }
  const fn = ACTIONS[name] || window[name];
  if (typeof fn !== 'function') { console.warn('[act] 未注册的操作:', name); return; }
  if (EL_ACTIONS.has(name)) fn(...args, el); else fn(...args);
});

/* ---------------- 帮助与错误边界 ---------------- */
function helpModal() {
  openModal({
    title: '帮助与快捷键',
    desc: '纯前端演示原型：所有新建、修改与删除都会写入浏览器本地存储。',
    okText: '知道了',
    body: `
      <div class="form-sec">快捷键</div>
      <table class="table">
        <tbody>
          <tr><td class="name" style="width:120px"><kbd>F</kbd></td><td>聚焦顶栏全局搜索，按名称查找应用 / 组件 / 工作负载</td></tr>
          <tr><td class="name"><kbd>Enter</kbd></td><td>在弹窗表单中提交；多步向导中进入下一步</td></tr>
          <tr><td class="name"><kbd>Esc</kbd></td><td>关闭当前弹窗</td></tr>
        </tbody>
      </table>
      <div class="form-sec">推荐动线</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="btn sm" ${act('go', '/apps/retail-platform')}>三层模型</button>
        <button class="btn sm" ${act('go', '/admin/modules')}>模块开关</button>
        <button class="btn sm" ${act('go', '/apps/retail-platform/config')}>配置治理</button>
        <button class="btn sm" ${act('go', '/cicd/pl-order')}>发布链路</button>
        <button class="btn sm" ${act('go', '/mesh/tracing')}>链路追踪</button>
      </div>`
  });
}

function renderErrorPage(err) {
  if (LOG_TIMER) { clearInterval(LOG_TIMER); LOG_TIMER = null; }
  const detail = esc(String((err && (err.stack || err.message)) || err));
  $('#view').innerHTML = `
    <div class="page-head">
      <div><div class="ttl">页面加载失败</div><div class="sub">当前视图渲染时出错，侧边栏与其他页面仍可继续使用。</div></div>
    </div>
    <div class="card">
      <div class="empty" style="padding:42px 20px">
        <h3>这个页面没有渲染成功</h3>
        <p>可以重试当前页面，或回到概览继续操作。</p>
        <div style="display:flex;gap:8px;justify-content:center;margin:14px 0">
          <button class="btn primary" ${act('retryRoute')}>重试</button>
          <button class="btn" ${act('go', '/overview')}>回到概览</button>
        </div>
        <pre style="text-align:left;max-width:760px;margin:0 auto;padding:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--text-3);font-family:var(--mono)">${detail}</pre>
      </div>
    </div>`;
}

