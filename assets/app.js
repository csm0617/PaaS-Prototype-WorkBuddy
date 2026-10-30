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
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function num(n) { return Number(n).toLocaleString('en-US'); }

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
  const path = location.hash.replace(/^#/, '') || '/overview';
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
    n.onclick = () => { location.hash = n.dataset.route; };
  });
}

function renderTopbar() {
  /* 单环境部署：不提供环境切换 */
  $('#topbar').innerHTML = `
    <div class="crumb">控制台<span class="sep">/</span><b id="crumbCur">概览</b></div>
    <div class="search gsearch">
      ${icon('search', '', 14)}
      <input id="gsearch" placeholder="搜索应用 / 组件 / 工作负载" autocomplete="off"
        oninput="globalSearch(this.value)" onkeydown="globalSearchKey(event)" />
      <kbd>F</kbd>
      <div class="gs-list" id="gsList"></div>
    </div>
    <button class="icon-btn" title="帮助">${icon('help', '', 16)}</button>
    <button class="icon-btn" title="告警" onclick="location.hash='/ops/alerts'">${icon('bell', '', 16)}<span class="dot-red"></span></button>
    <div class="avatar" title="${DB.user.name} · ${DB.user.role}">${DB.user.avatar}</div>`;
}
function setCrumb(t) { const e = $('#crumbCur'); if (e) e.textContent = t; }

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
    ? hits.slice(0, 8).map(x => `<div class="gs-item" data-h="${esc(x.h)}" data-comp="${esc(x.comp || '')}" onclick="globalGo(this)">
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

function openModal(o) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">
    <div class="mh"><h3>${o.title}</h3>${o.desc ? `<p>${o.desc}</p>` : ''}</div>
    <div class="mb">${o.body || ''}</div>
    <div class="mf">
      <button class="btn" data-act="cancel">${o.cancelText || '取消'}</button>
      <button class="btn ${o.danger ? 'danger' : 'primary'}" data-act="ok">${o.okText || '确定'}</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('[data-act=cancel]').onclick = close;
  mask.querySelector('[data-act=ok]').onclick = () => { close(); o.onOk && o.onOk(); };
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
      <button class="btn" data-act="cancel"${o.hideCancel ? ' style="display:none"' : ''}>${o.cancelText || '取消'}</button>
      <button class="btn ${o.danger ? 'danger' : o.plain ? '' : 'primary'}" data-act="ok">${o.okText || '确定'}</button>
    </div>
  </div>`;
  document.body.appendChild(mask);

  const err = mask.querySelector('.form-err');
  const close = () => mask.remove();
  const showErr = m => { err.textContent = m; err.hidden = false; err.style.display = 'block'; };
  const clearErr = () => { err.hidden = true; err.style.display = 'none'; };

  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('[data-act=cancel]').onclick = close;
  mask.querySelector('[data-act=ok]').onclick = () => {
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
      <button class="btn" data-act="cancel">取消</button>
      <button class="btn" data-act="prev">上一步</button>
      <button class="btn primary" data-act="next">下一步</button>
    </div>
  </div>`;
  document.body.appendChild(mask);

  const stepsBar = mask.querySelector('.wiz-steps');
  const body = mask.querySelector('.mb');
  const prevBtn = mask.querySelector('[data-act=prev]');
  const nextBtn = mask.querySelector('[data-act=next]');
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

  const close = () => mask.remove();
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  mask.querySelector('[data-act=cancel]').onclick = close;
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

/* ==========================================================
   视图
   ========================================================== */

/* ---------- 概览 ---------- */
const curEnv = () => DB.envs.find(e => e.code === S.env) || DB.envs[0];

function viewOverview() {
  setCrumb('概览');
  const appCount = DB.apps.length;
  const compCount = DB.apps.reduce((a, x) => a + x.components.length, 0);
  const wls = DB.apps.flatMap(a => a.components.flatMap(c => c.workloads.map(w => ({ ...w, app: a.name, comp: c.name }))));
  const runWl = wls.filter(w => w.status === '运行中').length;
  const env = curEnv();

  const maxR = Math.max(...DB.releases7d.map(r => r.v));

  return `
  <div class="page-head">
    <div>
      <div class="ttl">概览</div>
      <div class="sub">集群 <span class="mono">${env.cluster}</span> · 单环境部署 · 数据更新于 1 分钟前</div>
    </div>
    <div class="acts">
      <button class="btn" onclick="toast('已刷新')">${icon('refresh', '', 14)}刷新</button>
      <button class="btn primary" onclick="newApp()">${icon('plus', '', 14)}新建应用</button>
    </div>
  </div>

  <div class="grid g4">
    <div class="stat">
      <div class="lab">应用</div>
      <div class="val">${appCount}</div>
      <div class="foot"><span class="up">+2</span> 本周新增</div>
    </div>
    <div class="stat">
      <div class="lab">组件</div>
      <div class="val">${compCount}</div>
      <div class="foot">平均 <b>${appCount ? (compCount / appCount).toFixed(1) : '0.0'}</b> 个 / 应用</div>
    </div>
    <div class="stat">
      <div class="lab">工作负载</div>
      <div class="val">${wls.length}<small>个</small></div>
      <div class="foot"><span class="up">${runWl}</span> 运行中 · <span class="down">${wls.length - runWl}</span> 异常/停止</div>
    </div>
    <div class="stat">
      <div class="lab">今日发布</div>
      <div class="val">14<small>次</small></div>
      <div class="foot">成功率 <b>92.8%</b> · 平均 6m12s</div>
    </div>
  </div>

  <div class="grid g2 mt16">
    ${S.modules.mesh ? `
    <div class="card">
      <div class="card-head">
        <span style="color:var(--primary)">${icon('share', '', 15)}</span>
        <div><div class="t">Service Mesh</div><div class="d">可插拔模块 · 已启用</div></div>
        <div class="r"><span class="badge info">运行中</span><span class="link tiny" onclick="location.hash='/mesh'">进入 →</span></div>
      </div>
      <div class="card-body" style="display:flex;gap:26px">
        <div><div class="tiny muted">纳管服务</div><div style="font-size:19px;font-weight:660">8</div></div>
        <div><div class="tiny muted">Sidecar 注入率</div><div style="font-size:19px;font-weight:660">87.5<span style="font-size:11px;color:var(--text-3)">%</span></div></div>
        <div><div class="tiny muted">请求成功率</div><div style="font-size:19px;font-weight:660;color:var(--success)">99.94<span style="font-size:11px;color:var(--text-3)">%</span></div></div>
        <div><div class="tiny muted">P99 延迟</div><div style="font-size:19px;font-weight:660">48<span style="font-size:11px;color:var(--text-3)">ms</span></div></div>
      </div>
    </div>` : `
    <div class="card" style="border-style:dashed;background:#fbfcfe">
      <div class="card-head" style="border-bottom:none">
        <span style="color:#a3aec2">${icon('share', '', 15)}</span>
        <div><div class="t" style="color:var(--text-3)">Service Mesh</div><div class="d">可插拔模块 · 未启用</div></div>
        <div class="r"><button class="btn sm" onclick="toggleModule('mesh',true)">启用</button></div>
      </div>
      <div class="card-body tiny muted" style="padding-top:0">未启用时不占用任何资源，基础发布与负载均衡由 Kubernetes Service 原生承担。</div>
    </div>`}

    ${S.modules.edge ? `
    <div class="card">
      <div class="card-head">
        <span style="color:var(--teal)">${icon('cloud', '', 15)}</span>
        <div><div class="t">云边端协同</div><div class="d">可插拔模块 · 已启用</div></div>
        <div class="r"><span class="badge teal">运行中</span><span class="link tiny" onclick="location.hash='/edge/nodes'">进入 →</span></div>
      </div>
      <div class="card-body" style="display:flex;gap:26px">
        <div><div class="tiny muted">边缘节点</div><div style="font-size:19px;font-weight:660">8</div></div>
        <div><div class="tiny muted">在线率</div><div style="font-size:19px;font-weight:660">87.5<span style="font-size:11px;color:var(--text-3)">%</span></div></div>
        <div><div class="tiny muted">端设备</div><div style="font-size:19px;font-weight:660">150</div></div>
        <div><div class="tiny muted">边云同步</div><div style="font-size:19px;font-weight:660;color:var(--success)">正常</div></div>
      </div>
    </div>` : `
    <div class="card" style="border-style:dashed;background:#fbfcfe">
      <div class="card-head" style="border-bottom:none">
        <span style="color:#a3aec2">${icon('cloud', '', 15)}</span>
        <div><div class="t" style="color:var(--text-3)">云边端协同</div><div class="d">可插拔模块 · 未启用</div></div>
        <div class="r"><button class="btn sm" onclick="toggleModule('edge',true)">启用</button></div>
      </div>
      <div class="card-body tiny muted" style="padding-top:0">未启用时所有工作负载仅在云端集群调度，边缘与端侧菜单及入口自动隐藏。</div>
    </div>`}
  </div>

  <div class="grid g21 mt16">
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card">
        <div class="card-head"><div class="t">集群资源</div><div class="r tiny muted">${env.cluster}</div></div>
        <div class="card-body">
          <div class="res-row"><span class="k">CPU</span><div class="b"><div class="progress"><div style="width:62%"></div></div></div><span class="v">62% / 96c</span></div>
          <div class="res-row"><span class="k">内存</span><div class="b"><div class="progress"><div class="warn" style="width:71%"></div></div></div><span class="v">71% / 384Gi</span></div>
          <div class="res-row"><span class="k">存储</span><div class="b"><div class="progress"><div class="ok" style="width:38%"></div></div></div><span class="v">38% / 8Ti</span></div>
          <div class="res-row"><span class="k">Pod</span><div class="b"><div class="progress"><div style="width:54%"></div></div></div><span class="v">386 / 720</span></div>
          <div class="divider"></div>
          <div class="spread tiny">
            <span class="muted">节点</span><span><b>12</b> 台 · 全部就绪</span>
            <span class="muted">命名空间</span><span><b>18</b> 个</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t">近 7 日发布趋势</div><div class="r tiny muted">共 115 次</div></div>
        <div class="card-body">
          <div class="bar-chart">
            ${DB.releases7d.map((r, i) => `<div class="b ${i === 4 ? 'hi' : ''}" style="height:${(r.v / maxR) * 100}%" title="${r.d}: ${r.v} 次"></div>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:7px" class="tiny muted">
            ${DB.releases7d.map(r => `<span>${r.d}</span>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="t">待处理告警</div><div class="r"><span class="badge bad">${DB.alerts.filter(a => a.status === '未处理').length}</span></div></div>
      <div class="card-body tight">
        ${DB.alerts.slice(0, 4).map(a => `
          <div style="padding:11px 16px;border-bottom:1px solid #f0f3f9;display:flex;gap:9px">
            <span style="margin-top:4px;width:6px;height:6px;border-radius:50%;flex:0 0 6px;background:${a.level === '严重' ? 'var(--danger)' : a.level === '警告' ? 'var(--warning)' : '#c7d0e0'}"></span>
            <div style="min-width:0">
              <div style="font-size:12.3px;color:var(--text);line-height:1.5">${esc(a.title)}</div>
              <div class="tiny muted mt8" style="margin-top:3px">${esc(a.res)} · ${a.time}</div>
            </div>
          </div>`).join('')}
        <div style="padding:10px 16px" class="tiny"><span class="link" onclick="location.hash='/ops/alerts'">查看全部告警 →</span></div>
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">最近流水线</div><div class="r"><span class="link tiny" onclick="location.hash='/cicd'">全部流水线 →</span></div></div>
    <table class="table">
      <thead><tr><th>流水线</th><th>所属应用</th><th>触发</th><th>最近运行</th><th>状态</th><th class="right">成功率</th></tr></thead>
      <tbody>
        ${DB.pipelines.slice(0, 5).map(p => `
          <tr class="clickable" onclick="location.hash='/cicd/${p.id}'">
            <td class="name">${esc(p.name)}</td>
            <td>${esc(p.app)}</td>
            <td><span class="chip">${esc(p.trigger)}</span></td>
            <td>${p.last}</td>
            <td>${pbadge(p.status)}</td>
            <td class="right num">${p.success}%</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ---------- 应用列表 ---------- */
/* 通用前端过滤：列表项用 data-q 承载可搜索文本，data-status 承载状态值 */
function listFilter(rootSel, v) {
  const q = String(v || '').trim().toLowerCase();
  document.querySelectorAll(`${rootSel} [data-q]`).forEach(el => {
    el.style.display = !q || (el.dataset.q || '').toLowerCase().includes(q) ? '' : 'none';
  });
}
function listStatus(rootSel, status, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }
  document.querySelectorAll(`${rootSel} [data-q]`).forEach(el => {
    el.style.display = status === 'all' || el.dataset.status === status ? '' : 'none';
  });
}

function viewApps() {
  setCrumb('应用列表');
  if (!DB.apps.length) {
    return `<div class="page-head">
      <div><div class="ttl">应用</div>
        <div class="sub">应用是业务交付单元，下辖若干组件，组件进一步展开为工作负载。</div></div>
      <div class="acts"><button class="btn primary" onclick="newApp()">${icon('plus', '', 14)}新建应用</button></div>
    </div>
    <div class="card"><div class="empty">
      <div class="eic">${icon('box', '', 22)}</div>
      <h3>还没有应用</h3>
      <p>新建第一个应用后，就能在它下面创建组件与工作负载，形成完整的三层模型。</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn primary" onclick="newApp()">${icon('plus', '', 14)}新建应用</button>
        <button class="btn" onclick="resetSnapshot()">重置演示数据</button>
      </div>
    </div></div>`;
  }
  return `
  <div class="page-head">
    <div>
      <div class="ttl">应用</div>
      <div class="sub">应用是业务交付单元，下辖若干组件，组件进一步展开为工作负载。</div>
    </div>
    <div class="acts">
      <div class="search" style="margin:0;width:200px">${icon('search', '', 14)}<input placeholder="搜索应用 / 业务域 / 负责人" oninput="listFilter('#appsGrid', this.value)" /></div>
      <button class="btn primary" onclick="newApp()">${icon('plus', '', 14)}新建应用</button>
    </div>
  </div>

  <div class="grid g3" id="appsGrid">
    ${DB.apps.map(a => {
      const wlCount = a.components.reduce((s, c) => s + c.workloads.length, 0);
      return `<div class="card" style="cursor:pointer;transition:.16s" data-q="${esc(a.name)} ${esc(a.domain)} ${esc(a.owner)} ${esc(a.desc)}" onclick="location.hash='/apps/${a.id}'"
        onmouseover="this.style.boxShadow='var(--shadow)';this.style.transform='translateY(-1px)'"
        onmouseout="this.style.boxShadow='var(--shadow-sm)';this.style.transform='none'">
        <div class="card-body">
          <div class="spread">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span style="color:var(--primary)">${icon('box', '', 16)}</span>
              <span style="font-size:13.5px;font-weight:650">${esc(a.name)}</span>
              ${badge(a.level)}
            </div>
            ${badge(appStatus(a))}
          </div>
          <div class="tiny muted" style="margin-top:5px;min-height:32px;line-height:1.6">${esc(a.desc)}</div>
          ${(() => {
            const list = DB.access[a.id] || [];
            const p = list.find(x => x.status === '已生效' && x.scope === '公网') || list.find(x => x.status === '已生效');
            return p
              ? `<div style="display:flex;align-items:center;gap:5px;margin-top:7px;min-width:0">
                   <span style="color:var(--text-3);display:flex;flex:0 0 auto">${icon('globe', '', 12)}</span>
                   <span class="mono" style="font-size:11px;color:var(--primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.url)}</span>
                 </div>`
              : list.length
                ? `<div class="tiny muted" style="margin-top:7px">访问入口已停用</div>`
                : `<div class="tiny muted" style="margin-top:7px">未配置访问入口</div>`;
          })()}
          <div style="display:flex;gap:18px;margin-top:12px">
            <div class="link" title="查看该应用的组件" onclick="event.stopPropagation();openComponentsOf('${a.id}')">
              <div class="tiny muted">组件</div><div style="font-size:16px;font-weight:660;color:inherit">${a.components.length}</div></div>
            <div><div class="tiny muted">工作负载</div><div style="font-size:16px;font-weight:660">${wlCount}</div></div>
            <div><div class="tiny muted">健康度</div><div style="font-size:16px;font-weight:660;color:${healthText(a).color}">${healthText(a).v}${healthText(a).v === '—' ? '' : '<span style="font-size:10px">%</span>'}</div></div>
          </div>
        </div>
        <div style="padding:9px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px" class="tiny muted">
          <span class="chip">${esc(a.domain)}</span>
          <span style="margin-left:auto">${esc(a.owner)} · ${a.updated.slice(5, 16)}</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------- 应用详情 ---------- */
function viewAppDetail(id) {
  const app = DB.apps.find(a => a.id === id) || DB.apps[0];
  if (!app) {
    setCrumb('应用');
    return `<div class="empty">
      <div class="eic">${icon('box', '', 22)}</div>
      <h3>没有可展示的应用</h3>
      <p>演示数据中的最后一条应用已被删除。可以新建一个应用，或重置演示数据。</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn primary" onclick="newApp()">${icon('plus', '', 14)}新建应用</button>
        <button class="btn" onclick="resetSnapshot()">重置演示数据</button>
      </div>
    </div>`;
  }
  setCrumb(app.name);
  if (!S.appComp || !findComp(app, S.appComp)) S.appComp = app.components[0] ? app.components[0].name : null;

  const wlCount = app.components.reduce((s, c) => s + c.workloads.length, 0);
  const meshOn = S.modules.mesh;

  const tabs = [
    { k: 'overview', n: '概览' },
    { k: 'components', n: '组件与工作负载', c: app.components.length },
    { k: 'topology', n: '组件拓扑' },
    { k: 'access', n: '访问入口', c: (DB.access[app.id] || []).filter(x => x.status === '已生效').length },
    { k: 'pipelines', n: '流水线', c: app.pipelines.length },
    { k: 'releases', n: '发布记录', c: ensureReleases(app).length },
    { k: 'mesh', n: '流量治理', lock: !meshOn },
    { k: 'config', n: '配置与密钥' },
    { k: 'events', n: '事件' }
  ];

  const primary = (DB.access[app.id] || []).find(x => x.status === '已生效' && x.scope === '公网')
    || (DB.access[app.id] || []).find(x => x.status === '已生效');

  return `
  <div class="page-head">
    <div>
      <div style="display:flex;align-items:center;gap:9px">
        <span style="color:var(--primary)">${icon('box', '', 19)}</span>
        <div class="ttl">${esc(app.name)}</div>
        ${badge(app.level)} ${badge(appStatus(app))}
      </div>
      <div class="sub">${esc(app.desc)}</div>
      <div style="display:flex;align-items:center;gap:7px;margin-top:5px">
        ${primary ? `<span style="color:var(--text-3);display:flex">${icon('globe', '', 13)}</span>
          <span class="mono" style="font-size:11.5px;color:var(--primary);font-weight:600">${esc(primary.url)}</span>
          <span class="badge ${primary.type === '域名' ? 'purple' : 'info'}">${primary.type}</span>
          <button class="btn sm ghost" style="height:22px;padding:0 6px" onclick="copyText('${esc(primary.url)}')">${icon('copy', '', 11)}复制</button>`
        : `<span class="tiny muted">未配置对外访问入口</span>`}
      </div>
    </div>
    <div class="acts">
      <button class="btn" onclick="releaseApp('${app.id}')">${icon('send', '', 14)}发布</button>
      <button class="btn" onclick="scaleApp(DB.apps.find(a=>a.id==='${app.id}'))">扩缩容</button>
      <button class="btn" onclick="appMenu(DB.apps.find(a=>a.id==='${app.id}'))">···</button>
    </div>
  </div>

  <div class="card">
    <div class="card-body" style="display:flex;gap:34px;flex-wrap:wrap;padding:14px 18px">
      <div><div class="tiny muted">业务域</div><div style="font-weight:600;margin-top:2px">${esc(app.domain)}</div></div>
      <div><div class="tiny muted">负责人</div><div style="font-weight:600;margin-top:2px">${esc(app.owner)}</div></div>
      <div><div class="tiny muted">组件</div><div style="font-weight:600;margin-top:2px">${app.components.length}</div></div>
      <div><div class="tiny muted">工作负载</div><div style="font-weight:600;margin-top:2px">${wlCount}</div></div>
      <div><div class="tiny muted">健康度</div><div style="font-weight:600;margin-top:2px;color:${healthText(app).color}">${healthText(app).v === '—' ? '—' : healthText(app).v + '%'}</div></div>
      <div><div class="tiny muted">运行集群</div><div class="mono" style="margin-top:2px;font-size:11.5px">${esc((curEnv() && curEnv().cluster) || '—')}</div></div>
      <div style="margin-left:auto"><div class="tiny muted">最近更新</div><div class="mono" style="margin-top:2px;font-size:11.5px">${app.updated}</div></div>
    </div>
    <div class="tabs" style="padding:0 14px">
      ${tabs.map(t => `<div class="tab ${S.appTab === t.k ? 'on' : ''}" onclick="setAppTab('${t.k}')">
        ${t.n}${t.c ? `<span style="font-size:10px;color:var(--text-3)">${t.c}</span>` : ''}${t.lock ? '<span class="lock">未启用</span>' : ''}
      </div>`).join('')}
    </div>
    <div style="padding:16px">
      ${appTabBody(app)}
    </div>
  </div>`;
}

function setAppTab(k) { goAppTab(currentAppId(), k); }

function currentAppId() {
  const p = location.hash.replace(/^#/, '').split('/').filter(Boolean);
  return p[0] === 'apps' && p[1] ? p[1] : DB.apps[0].id;
}
function goAppTab(id, k) {
  S.appTab = k;
  S.appWl = null;
  const target = `#/apps/${id}/${k}`;
  if (location.hash === target) route(); else location.hash = target;
}

function appTabBody(app) {
  const meshOn = S.modules.mesh;

  if (S.appTab === 'overview') {
    return `
      <div class="grid g4" style="margin-bottom:14px">
        <div class="stat" style="box-shadow:none"><div class="lab">组件</div><div class="val">${app.components.length}</div><div class="foot">含 ${app.components.filter(c => c.role === '核心服务').length} 个核心服务</div></div>
        <div class="stat" style="box-shadow:none"><div class="lab">工作负载</div><div class="val">${app.components.reduce((s, c) => s + c.workloads.length, 0)}</div><div class="foot">云端 ${app.components.flatMap(c => c.workloads).filter(w => w.where === '云端').length} · 边缘 ${app.components.flatMap(c => c.workloads).filter(w => w.where === '边缘').length}</div></div>
        <div class="stat" style="box-shadow:none"><div class="lab">近 7 日发布</div><div class="val">6<small>次</small></div><div class="foot">成功率 <b>96.4%</b></div></div>
        <div class="stat" style="box-shadow:none"><div class="lab">异常工作负载</div><div class="val">${app.components.flatMap(c => c.workloads).filter(w => w.status !== '运行中' && w.status !== '已完成').length}</div><div class="foot">需关注</div></div>
      </div>
      <div class="grid g21">
        <div class="card" style="box-shadow:none">
          <div class="card-head"><div class="t">组件健康</div></div>
          <table class="table">
            <thead><tr><th>组件</th><th>角色</th><th>版本</th><th>工作负载</th><th>状态</th></tr></thead>
            <tbody>${app.components.map(c => {
              const bad = c.workloads.some(w => w.status !== '运行中' && w.status !== '已完成');
              return `<tr class="clickable" onclick="gotoComp('${c.name}')">
                <td class="name">${esc(c.name)}</td><td>${esc(c.role)}</td>
                <td class="mono">${esc(c.version)}</td><td>${c.workloads.length}</td>
                <td>${bad ? badge('待关注', 'warn') : badge('正常', 'ok')}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <div class="card" style="box-shadow:none">
          <div class="card-head"><div class="t">最近事件</div></div>
          <div class="card-body"><div class="tl">
            ${app.events.map(e => `<div class="tl-item ${e.k}"><div class="tm">${e.t}</div><div class="tx">${e.tx}</div></div>`).join('')}
          </div></div>
        </div>
      </div>`;
  }

  if (S.appTab === 'components') {
    const comp = findComp(app, S.appComp) || app.components[0];
    if (!comp) {
      return `<div class="empty" style="padding:38px 20px">
        <div class="eic">${icon('layers', '', 22)}</div>
        <h3>这个应用还没有组件</h3>
        <p>组件是构建与发布的边界，对应一个镜像与版本；工作负载从组件派生。先创建第一个组件。</p>
        <button class="btn primary" onclick="newComponent('${app.id}')">${icon('plus', '', 14)}新建组件</button>
      </div>`;
    }
    const wl = findWl(comp, S.appWl);

    return `
    <div class="grid g12" style="align-items:start">
      <div class="card" style="box-shadow:none">
        <div class="card-head" style="padding:11px 14px">
          <div class="t" style="font-size:12px">资源树</div>
          <div class="r">
            <button class="mini-act" title="新建组件" onclick="newComponent('${app.id}')">${icon('plus', '', 13)}</button>
          </div>
        </div>
        <div class="card-body" style="padding:8px">
          <div class="tree">
            <div class="tree-node" style="font-weight:600;color:var(--text);cursor:default">
              ${icon('box', '', 14)}<span class="nm">${esc(app.name)}</span>
            </div>
            <div class="tree-lead">组件 · ${app.components.length}</div>
            ${app.components.map(c => `
              <div class="tree-node lvl2 ${c.name === comp.name ? 'on' : ''}" onclick="selectComp('${c.name}')">
                ${icon('layers', '', 13)}<span class="nm">${esc(c.name)}</span><span class="ct">${c.workloads.length}</span>
              </div>
              ${c.name === comp.name ? c.workloads.map(w => `
                <div class="tree-node lvl3 ${w.name === S.appWl ? 'on' : ''}" onclick="selectWl('${w.name}')">
                  <span class="nm">${esc(w.name)}</span>
                </div>`).join('') : ''}
            `).join('')}
          </div>
        </div>
      </div>

      <div class="card" style="box-shadow:none">
        <div class="card-head">
          <div>
            <div class="t">${esc(comp.name)} <span class="chip" style="margin-left:4px">${esc(comp.role)}</span></div>
            <div class="d mono" style="margin-top:2px">${esc(comp.image)} · ${runtimeText(comp)}</div>
            <div class="dep-chips">
              <span class="chip svc" title="集群内服务名与端口">${esc(comp.serviceName || comp.name)}:${comp.port}</span>
              <span class="chip ver" title="查看版本历史" onclick="componentVersions('${app.id}','${comp.name}')">${esc(comp.version)}</span>
              <span class="chip proto" title="对外协议">${esc(comp.protocol || 'HTTP')}</span>
              ${(() => {
                const d = compDeps(app.id, comp.name);
                return d.up.map(x => `<span class="chip" title="上游调用方 · ${esc(x.l || '')}">← ${esc(x.n)}</span>`).join('')
                  + d.down.map(x => `<span class="chip" title="下游依赖 · ${esc(x.l || '')}">→ ${esc(x.n)}</span>`).join('');
              })()}
            </div>
          </div>
          <div class="r">
            <button class="btn sm ghost" onclick="newWorkload('${app.id}','${comp.name}')">${icon('plus', '', 12)}工作负载</button>
            <button class="btn sm" onclick="componentConfig('${app.id}','${comp.name}')">配置</button>
            <button class="btn sm primary" onclick="releaseApp('${app.id}','${comp.name}')">${icon('send', '', 12)}发布</button>
            <button class="mini-act danger" title="删除组件" onclick="deleteComponent('${app.id}','${comp.name}')">${icon('archive', '', 13)}</button>
          </div>
        </div>
        <table class="table">
          <thead><tr>
            <th>工作负载</th><th>类型</th><th>副本</th><th>状态</th><th>调度</th>
            <th>CPU / 内存</th>${meshOn ? '<th>Mesh</th>' : ''}<th class="right">重启</th>
          </tr></thead>
          <tbody>
            ${comp.workloads.length ? comp.workloads.map(w => `
              <tr class="clickable" onclick="selectWl('${w.name}')">
                <td class="name">${esc(w.name)}<div class="sub mono">${esc(w.image)}</div></td>
                <td><span class="chip">${esc(w.kind)}</span></td>
                <td class="num">${wReady(w)}</td>
                <td>${badge(w.status)}</td>
                <td>${whereChip(w.where)}</td>
                <td class="mono" style="font-size:11px">${esc(w.cpu)}<div class="sub">${esc(w.mem)}</div></td>
                ${meshOn ? `<td>${w.mesh === '已注入' ? '<span class="badge info">已注入</span>' : w.mesh === '网关' ? '<span class="badge purple">网关</span>' : '<span class="badge muted">—</span>'}</td>` : ''}
                <td class="right num">${w.restarts}</td>
              </tr>`).join('') : `
              <tr><td colspan="${meshOn ? 8 : 7}">
                <div class="empty" style="padding:28px 16px">
                  <p style="margin:0 0 12px">该组件还没有工作负载，副本与资源规格无从声明。</p>
                  <button class="btn sm primary" onclick="newWorkload('${app.id}','${comp.name}')">${icon('plus', '', 12)}新建工作负载</button>
                </div>
              </td></tr>`}
          </tbody>
        </table>
        ${!meshOn ? `<div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text-3);display:flex;align-items:center;gap:6px">
          ${icon('share', '', 12)} Service Mesh 模块未启用，Sidecar 注入列已隐藏，服务间通信由 Kubernetes Service 原生承担。
        </div>` : ''}

        ${wl ? `
        <div style="border-top:1px solid var(--border);padding:14px 16px;background:var(--surface-2)">
          <div class="spread" style="margin-bottom:11px">
            <div style="font-size:12.5px;font-weight:650">${esc(wl.name)} <span class="chip">${esc(wl.kind)}</span></div>
            <div style="display:flex;gap:7px">
              <button class="btn sm primary" onclick="wlOpen('${app.id}','${comp.name}','${wl.name}','overview')">打开详情</button>
              <button class="btn sm ghost" onclick="S.appWl=null;route()">收起</button>
            </div>
          </div>
          <div class="grid g2" style="gap:16px">
            <dl class="kv">
              <dt>镜像</dt><dd class="mono">${esc(wl.image)}</dd>
              <dt>副本</dt><dd>${wReady(wl)} 就绪</dd>
              <dt>调度位置</dt><dd>${whereChip(wl.where)} <span class="mono muted" style="font-size:11px">${esc(wl.cluster)}</span></dd>
              <dt>资源</dt><dd class="mono">${esc(wl.cpu)} · ${esc(wl.mem)}</dd>
            </dl>
            <dl class="kv">
              <dt>状态</dt><dd>${badge(wl.status)}</dd>
              <dt>重启次数</dt><dd>${wl.restarts}</dd>
              <dt>运行时长</dt><dd class="mono">${esc(wl.age)}</dd>
              <dt>Mesh</dt><dd>${wl.mesh === '已注入' ? badge('Sidecar 已注入', 'info') : '<span class="muted">未接入</span>'}</dd>
            </dl>
          </div>
          <div style="display:flex;gap:7px;margin-top:12px">
            <button class="btn sm" onclick="wlOpen('${app.id}','${comp.name}','${wl.name}','logs')">日志</button>
            <button class="btn sm" onclick="wlOpen('${app.id}','${comp.name}','${wl.name}','terminal')">终端</button>
            <button class="btn sm" onclick="wlOpen('${app.id}','${comp.name}','${wl.name}','yaml')">YAML</button>
            <button class="btn sm" onclick="wlRestart('${app.id}','${comp.name}','${wl.name}')">${icon('refresh', '', 12)}重启</button>
            <button class="btn sm danger" style="margin-left:auto" onclick="deleteWorkload('${app.id}','${comp.name}','${wl.name}')">删除</button>
          </div>
        </div>` : ''}
      </div>
    </div>`;
  }

  if (S.appTab === 'topology') return appTopologyView(app);
  if (S.appTab === 'access') return appAccessView(app);

  if (S.appTab === 'releases') return appReleasesView(app);

  if (S.appTab === 'pipelines') {
    const pls = DB.pipelines.filter(p => p.appId === app.id);
    return `<div class="card" style="box-shadow:none">
      <table class="table">
        <thead><tr><th>流水线</th><th>关联组件</th><th>触发方式</th><th>最近运行</th><th>状态</th><th class="right">成功率</th></tr></thead>
        <tbody>${pls.length ? pls.map(p => `
          <tr class="clickable" onclick="location.hash='/cicd/${p.id}'">
            <td class="name">${esc(p.name)}</td><td>${esc(p.comp)}</td>
            <td><span class="chip">${esc(p.trigger)}</span></td><td>${p.last}</td>
            <td>${pbadge(p.status)}</td><td class="right num">${p.success}%</td></tr>`).join('')
        : `<tr><td colspan="6"><div class="empty" style="padding:32px"><p style="margin:0">该应用尚未配置流水线</p></div></td></tr>`}
        </tbody>
      </table>
    </div>`;
  }

  if (S.appTab === 'mesh') {
    if (!meshOn) {
      return `<div class="empty">
        <div class="eic">${icon('share', '', 22)}</div>
        <h3>Service Mesh 模块未启用</h3>
        <p>流量治理依赖 Service Mesh 提供的能力。该模块为可插拔组件，启用后本页将展示虚拟服务、目标规则与 Sidecar 状态。</p>
        <button class="btn primary" onclick="toggleModule('mesh',true)">启用 Service Mesh</button>
      </div>`;
    }
    const svcs = DB.mesh.services.filter(s => app.components.some(c => s.name.startsWith(c.name.split('-')[0])));
    return `
    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat" style="box-shadow:none"><div class="lab">纳管服务</div><div class="val">${svcs.length || 4}</div></div>
      <div class="stat" style="box-shadow:none"><div class="lab">Sidecar 注入率</div><div class="val">86<small>%</small></div></div>
      <div class="stat" style="box-shadow:none"><div class="lab">请求成功率</div><div class="val" style="color:var(--success)">99.9<small>%</small></div></div>
      <div class="stat" style="box-shadow:none"><div class="lab">mTLS</div><div class="val" style="font-size:20px">严格模式</div></div>
    </div>
    <div class="card" style="box-shadow:none">
      <table class="table">
        <thead><tr><th>服务</th><th>命名空间</th><th>版本</th><th>Sidecar</th><th>QPS</th><th>成功率</th><th>P99</th><th>状态</th></tr></thead>
        <tbody>${DB.mesh.services.slice(0, 5).map(s => `
          <tr><td class="name">${esc(s.name)}</td><td class="mono">${esc(s.ns)}</td>
          <td class="mono">${esc(s.ver)}</td>
          <td>${s.sidecar === '已注入' ? '<span class="badge info">已注入</span>' : '<span class="badge muted">未注入</span>'}</td>
          <td class="num">${s.rps}</td><td class="num">${s.success}</td><td class="num">${s.p99}</td>
          <td>${badge(s.status)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  }

  if (S.appTab === 'config') {
    // 作用域可能停在上一个应用的组件上，切应用后回落到全部
    if (S.cfgScope !== 'all-app' && S.cfgScope !== 'all' && !findComp(app, S.cfgScope)) S.cfgScope = 'all-app';
    return appConfigView(app);
  }

  return `<div class="tl" style="max-width:760px">
    ${app.events.map(e => `<div class="tl-item ${e.k}"><div class="tm">${e.t}</div><div class="tx">${e.tx}</div></div>`).join('')}
  </div>`;
}

/* ==========================================================
   应用级组件拓扑（声明式依赖，来自平台内核，不依赖 Service Mesh）
   ========================================================== */
const NODE_W = 220, NODE_H = 66;
const ROLE_COLOR = {
  '入口网关': ['#f4efff', '#ddd0fb', '#6d28d9'],
  '核心服务': ['#eef4ff', '#cddcff', '#1d4ed8'],
  '边缘采集': ['#e6f7f5', '#c5eae4', '#0d9488'],
  '流接入': ['#e6f7f5', '#c5eae4', '#0d9488'],
  '协议解析': ['#e6f7f5', '#c5eae4', '#0d9488'],
  '推理引擎': ['#e6f7f5', '#c5eae4', '#0d9488'],
  '渠道适配': ['#fdf3e3', '#f6e2be', '#b45309'],
  '异步任务': ['#f4f6fb', '#dfe5f1', '#475569'],
  '对账任务': ['#f4f6fb', '#dfe5f1', '#475569'],
  '规则计算': ['#f4f6fb', '#dfe5f1', '#475569'],
  _: ['#eef4ff', '#cddcff', '#1d4ed8']
};

/* 分层布局：按依赖求最长路径层级，层内垂直居中排列 */
function layoutGraph(names, edges) {
  const indeg = {}, adj = {};
  names.forEach(n => { indeg[n] = 0; adj[n] = []; });
  edges.forEach(([a, b]) => { if (adj[a]) adj[a].push(b); if (indeg[b] !== undefined) indeg[b]++; });

  const lv = {};
  const roots = names.filter(n => !indeg[n]);
  (roots.length ? roots : [names[0]]).forEach(r => { lv[r] = 0; });
  const q = (roots.length ? roots : [names[0]]).slice();
  let guard = 0;
  while (q.length && guard++ < 400) {
    const u = q.shift();
    (adj[u] || []).forEach(v => {
      const cand = (lv[u] || 0) + 1;
      if (lv[v] === undefined || lv[v] < cand) { lv[v] = cand; q.push(v); }
    });
  }
  names.forEach(n => { if (lv[n] === undefined) lv[n] = 0; });

  const groups = {};
  names.forEach(n => { (groups[lv[n]] = groups[lv[n]] || []).push(n); });
  const cols = Math.max(...Object.keys(groups).map(Number)) + 1;
  const rows = Math.max(...Object.values(groups).map(g => g.length));

  const PAD = 28, GAPX = 196, GAPY = 26;
  const pos = {};
  const maxH = rows * NODE_H + (rows - 1) * GAPY;
  Object.keys(groups).forEach(k => {
    const arr = groups[k];
    const x = PAD + Number(k) * (NODE_W + GAPX);
    const totalH = arr.length * NODE_H + (arr.length - 1) * GAPY;
    const startY = PAD + (maxH - totalH) / 2;
    arr.forEach((n, i) => { pos[n] = { x, y: startY + i * (NODE_H + GAPY) }; });
  });

  return {
    pos, cols, rows,
    width: PAD * 2 + cols * NODE_W + (cols - 1) * GAPX,
    height: PAD * 2 + maxH
  };
}

/* 正交连线：竖直段走列间通道，避免穿过中间列节点 */
function orthPath(x1, y1, x2, y2, off) {
  if (Math.abs(y2 - y1) < 2) return `M${x1} ${y1} L${x2 - 4} ${y2}`;
  const xc = x1 + (x2 - x1) * 0.5 + (off || 0);
  const r = 7, dir = y2 > y1 ? 1 : -1;
  return `M${x1} ${y1} H${xc - r} Q${xc} ${y1} ${xc} ${y1 + dir * r}`
    + ` V${y2 - dir * r} Q${xc} ${y2} ${xc + r} ${y2} H${x2 - 4}`;
}

function buildAppTopo(app) {
  /* 图节点以组件 id 为 key，依赖边按 id 解析；name 只用于展示 */
  const byKey = {};
  app.components.forEach(c => { byKey[c.id] = c; byKey[c.name] = c; });
  const keys = app.components.map(c => c.id);
  const edges = (DB.deps[app.id] || [])
    .map(([a, b, label, kind]) => {
      const ca = byKey[a], cb = byKey[b];
      return ca && cb ? [ca.id, cb.id, label, kind] : null;
    })
    .filter(Boolean);
  const { pos, width, height } = layoutGraph(keys, edges);

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
    style="max-width:100%;height:auto;display:block;margin:0 auto">`;
  svg += `<defs>
    <marker id="ta" markerWidth="7" markerHeight="7" refX="6" refY="3.2" orient="auto">
      <path d="M0,0 L6,3.2 L0,6.4 z" fill="#a8b8d4"/></marker>
    <marker id="tb" markerWidth="7" markerHeight="7" refX="6" refY="3.2" orient="auto">
      <path d="M0,0 L6,3.2 L0,6.4 z" fill="#c6d0e2"/></marker>
  </defs>`;

  edges.forEach(([a, b, label, kind], i) => {
    const x1 = pos[a].x + NODE_W, y1 = pos[a].y + NODE_H / 2;
    const x2 = pos[b].x, y2 = pos[b].y + NODE_H / 2;
    const async = kind === 'async';
    const off = (i % 3 - 1) * 7;
    svg += `<path d="${orthPath(x1, y1, x2, y2, off)}"
      stroke="${async ? '#c6d0e2' : '#a8b8d4'}" stroke-width="1.5"
      ${async ? 'stroke-dasharray="5 3"' : ''} fill="none" marker-end="url(#${async ? 'tb' : 'ta'})"/>`;
    if (label) {
      const straight = Math.abs(y2 - y1) < 2;
      const lx = straight ? (x1 + x2) / 2 : x1 + 8;
      const ly = straight ? y1 - 8 : y1 - 9 - (i % 2) * 13;
      const anchor = straight ? 'middle' : 'start';
      svg += `<text x="${lx}" y="${ly}" font-size="9.5" fill="#8b97ad" text-anchor="${anchor}"
        font-family="ui-monospace,SFMono-Regular,monospace">${esc(label)}</text>`;
    }
  });

  app.components.forEach(c => {
    const p = pos[c.id];
    const col = ROLE_COLOR[c.role] || ROLE_COLOR._;
    const wheres = [...new Set(c.workloads.map(w => w.where))].join(' / ');
    const bad = c.workloads.some(w => w.status !== '运行中' && w.status !== '已完成');
    svg += `<g style="cursor:pointer" onclick="gotoComp('${c.name}')">
      <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="9"
        fill="${col[0]}" stroke="${col[1]}" stroke-width="1.2"/>
      ${bad ? `<circle cx="${p.x + NODE_W - 13}" cy="${p.y + 13}" r="3.6" fill="#dc2f4b"/>` : ''}
      <text x="${p.x + 13}" y="${p.y + 23}" font-size="12" font-weight="600" fill="#0e1729"
        font-family="ui-sans-serif,system-ui">${esc(c.name)}</text>
      <text x="${p.x + 13}" y="${p.y + 39}" font-size="10" fill="#7b8aa3"
        font-family="ui-monospace,monospace">${esc(c.role)} · ${esc(c.version)}</text>
      <text x="${p.x + 13}" y="${p.y + 54}" font-size="10" fill="#8b97ad"
        font-family="ui-monospace,monospace">${c.workloads.length} 工作负载 · ${esc(wheres)}</text>
    </g>`;
  });
  svg += `</svg>`;
  return { svg, edgeCount: edges.length };
}

/* 组件依赖编辑：列表 + 增删，改动同步到拓扑与组件卡片的上下游 */
function closeTopModal() {
  const masks = document.querySelectorAll('.modal-mask');
  if (masks.length) masks[masks.length - 1].remove();
}
function editDeps(appId) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  const comps = app.components.map(c => [c.id, c.name]);
  if (comps.length < 2) return toast('至少需要两个组件才能声明依赖', 'warn');
  const list = (DB.deps[appId] = DB.deps[appId] || []);
  formModal({
    title: `编辑依赖 · ${app.name}`,
    desc: '声明组件间的同步调用或异步消息，拓扑与组件卡片上的上下游会同步更新。',
    okText: '保存依赖',
    wide: true,
    body: `
      <div class="dep-list">
        ${list.length ? list.map(([a, b, label, kind], i) => `<div class="dep-row">
          <span class="mono dep-n">${esc(compLabel(app, a))}</span>
          <span class="dep-arrow">→</span>
          <span class="mono dep-n">${esc(compLabel(app, b))}</span>
          <span class="chip">${esc(label || '调用')}</span>
          ${kind === 'async' ? '<span class="badge muted">异步</span>' : ''}
          <button class="mini-act danger" title="删除该依赖" onclick="removeDep('${appId}',${i})">${icon('archive', '', 12)}</button>
        </div>`).join('') : '<div class="tiny muted">还没有声明依赖，可在下方添加第一条</div>'}
      </div>
      <div class="divider"></div>
      <div class="tiny muted" style="margin-bottom:8px">新增一条依赖</div>
      <div class="form-row">
        ${fField('上游组件', fSelect('from', comps, comps[0][0]))}
        ${fField('下游组件', fSelect('to', comps, comps[1][0]))}
      </div>
      <div class="form-row">
        ${fField('调用说明', fInput('label', '', '例如：HTTP · 1.2k rps'))}
        ${fCheck('async', '异步 / 消息', false, '拓扑中以虚线表示')}
      </div>`,
    onSubmit: st => {
      if (!st.from || !st.to) return null;
      if (st.from === st.to) return '上下游不能是同一个组件';
      if (list.some(([a, b]) => a === st.from && b === st.to)) return '这条依赖已存在';
      list.push([st.from, st.to, st.label || '调用', st.async ? 'async' : 'sync']);
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: '', tx: `新增依赖 <b>${esc(compLabel(app, st.from))} → ${esc(compLabel(app, st.to))}</b>` });
      saveSnapshot();
      route();
      toast('依赖已添加', 'ok');
    }
  });
}
function removeDep(appId, idx) {
  const list = DB.deps[appId] || [];
  const item = list[idx];
  if (!item) return;
  list.splice(idx, 1);
  const app = DB.apps.find(a => a.id === appId);
  if (app) {
    app.updated = nowStamp();
    app.events.unshift({ t: clockNow(), k: 'warn', tx: `删除依赖 <b>${esc(compLabel(app, item[0]))} → ${esc(compLabel(app, item[1]))}</b>` });
  }
  saveSnapshot();
  closeTopModal();
  route();
  toast('依赖已删除', 'warn');
}

function appTopologyView(app) {
  if (!app.components.length) {
    return `<div class="empty">
      <div class="eic">${icon('topo2', '', 22)}</div>
      <h3>还没有可绘制的组件</h3>
      <p>拓扑由组件间的声明式依赖生成。先创建组件，节点与连线就会出现在这里。</p>
      <button class="btn primary" onclick="newComponent('${app.id}')">${icon('plus', '', 14)}新建组件</button>
    </div>`;
  }
  const { svg, edgeCount } = buildAppTopo(app);
  const wlTotal = app.components.reduce((s, c) => s + c.workloads.length, 0);
  const multiWhere = app.components.filter(c => new Set(c.workloads.map(w => w.where)).size > 1).length;

  return `
  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat" style="box-shadow:none"><div class="lab">组件节点</div><div class="val">${app.components.length}</div><div class="foot">按依赖分层排布</div></div>
    <div class="stat" style="box-shadow:none"><div class="lab">依赖链路</div><div class="val">${edgeCount}<small>条</small></div><div class="foot">实线同步 · 虚线异步</div></div>
    <div class="stat" style="box-shadow:none"><div class="lab">工作负载</div><div class="val">${wlTotal}</div><div class="foot">分布在 ${new Set(app.components.flatMap(c => c.workloads.map(w => w.where))).size} 类位置</div></div>
    <div class="stat" style="box-shadow:none"><div class="lab">跨端组件</div><div class="val">${multiWhere}</div><div class="foot">同时含云端与边缘负载</div></div>
  </div>

  <div class="card" style="box-shadow:none">
    <div class="card-head">
      <div class="t">组件拓扑</div>
      <div class="d">点击节点可下钻到该组件的工作负载</div>
      <div class="r">
        <span class="chip blue">声明式依赖</span>
        <button class="btn sm" onclick="editDeps('${app.id}')">编辑依赖</button>
      </div>
    </div>
    <div class="card-body" style="padding:10px 12px 4px">${svg}</div>
    <div style="padding:6px 16px 14px">
      <div class="legend">
        <span><i style="background:#eef4ff;border:1px solid #cddcff"></i>核心服务</span>
        <span><i style="background:#f4efff;border:1px solid #ddd0fb"></i>入口网关</span>
        <span><i style="background:#e6f7f5;border:1px solid #c5eae4"></i>边缘/推理</span>
        <span><i style="background:#f4f6fb;border:1px solid #dfe5f1"></i>异步任务</span>
        <span style="color:var(--text-3)">— 实线：同步调用　- - 虚线：异步/消息</span>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:11px 14px;background:#f7f9fd;border:1px solid var(--border);border-radius:9px">
    <span style="color:var(--primary);margin-top:1px">${icon('topo2', '', 14)}</span>
    <div class="tiny" style="color:var(--text-2);line-height:1.75">
      <b style="color:var(--text)">这是「声明式依赖拓扑」</b>，由平台内核根据组件间声明的调用关系生成，<b>不依赖 Service Mesh</b>，模块关闭时依然可用。<br>
      如需查看基于 Sidecar 实测流量绘制的调用链（含 QPS、延迟、异常链路），请到
      <span class="link" onclick="location.hash='${S.modules.mesh ? '/mesh/topology' : '/admin/modules'}'">Service Mesh 服务拓扑</span>${S.modules.mesh ? '' : '（当前模块未启用）'}。
    </div>
  </div>`;
}

/* ==========================================================
   应用访问入口（独立域名 / 平台网关路径）
   ========================================================== */
/* 访问入口：新增、启停、删除 */
function newAccess(appId) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  if (!app.components.length) return toast('该应用还没有组件，无法绑定后端', 'warn');
  const comps = app.components.map(c => c.name);
  const gw = DB.gateway;
  formModal({
    title: `新增访问入口 · ${app.name}`,
    desc: '域名入口需把 CNAME 指到平台网关；网关路径入口由平台统一签发，无需自备域名。',
    okText: '创建入口',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('类型', fSelect('type', ['网关路径', '域名'], '网关路径'))}
        ${fField('访问范围', fSelect('scope', ['公网', '内网'], '公网'))}
      </div>
      ${fField('域名或路径', fInput('host', '', `留空则用 ${gw.domain}/${app.id}/`), '域名填主机名；路径需以 / 开头')}
      <div class="form-row">
        ${fField('后端组件', fSelect('comp', comps, comps[0]))}
        ${fField('端口', fInput('port', String(app.components[0].port || 8080), '8080', 'number'))}
      </div>
      <div class="form-row">
        ${fField('TLS', fSelect('tls', ['平台泛域名', '已签发（自有证书）', '不启用'], '平台泛域名'))}
        ${fField('认证', fSelect('auth', ['无', 'OAuth2 登录', 'API Key', 'JWT 校验'], '无'))}
      </div>
      ${fField('备注', fInput('note', '', '可选'))}`,
    onSubmit: st => {
      const host = String(st.host || '').trim();
      let url;
      if (st.type === '域名') {
        if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(host)) return '请填写合法域名，例如 retail.corp.io';
        url = `https://${host}`;
      } else {
        if (host && !host.startsWith('/')) return '网关路径需以 / 开头';
        url = `https://${gw.domain}${host || '/' + app.id + '/'}`;
      }
      const port = clampInt(st.port, 1, 65535, 8080);
      const target = findComp(app, st.comp);
      if (!target) return '请选择后端组件';
      const list = DB.access[app.id] || (DB.access[app.id] = []);
      if (list.some(x => x.url === url)) return '该地址已存在，请换一个';
      list.unshift({
        env: curEnv().name, type: st.type, url, backend: `${target.name}:${port}`,
        scope: st.scope, tls: st.tls === '不启用' ? '未启用' : st.tls,
        auth: st.auth, status: '已生效', hits: '0 / 日', note: st.note || ''
      });
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'ok', tx: `新增访问入口 <b>${esc(url)}</b> → ${esc(target.name)}:${port}` });
      saveSnapshot();
      route();
      toast('访问入口已创建', 'ok');
    }
  });
}
function newAccessGlobal() {
  if (!DB.apps.length) return toast('请先创建应用', 'warn');
  formModal({
    title: '新增访问入口',
    desc: '入口归属于某个应用，先选择应用再填写地址。',
    okText: '下一步',
    body: fField('所属应用', fSelect('appId', DB.apps.map(a => [a.id, a.name]), DB.apps[0].id)),
    onSubmit: st => {
      const app = DB.apps.find(a => a.id === st.appId);
      if (!app) return '请选择应用';
      newAccess(app.id);
    }
  });
}
function toggleAccess(appId, url) {
  const e = (DB.access[appId] || []).find(x => x.url === url);
  if (!e) return;
  e.status = e.status === '已生效' ? '已停用' : '已生效';
  const app = DB.apps.find(a => a.id === appId);
  if (app) app.events.unshift({ t: clockNow(), k: e.status === '已生效' ? 'ok' : 'warn', tx: `访问入口 <b>${esc(url)}</b> 已${e.status === '已生效' ? '启用' : '停用'}` });
  saveSnapshot();
  route();
  toast(`入口已${e.status === '已生效' ? '启用' : '停用'}`, 'ok');
}
function deleteAccess(appId, url) {
  openModal({
    title: '删除访问入口',
    desc: url,
    danger: true,
    okText: '确认删除',
    body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">删除后该地址立即不可访问，正在调用的客户端会收到 404。此操作不可撤销。</p>`,
    onOk: () => {
      DB.access[appId] = (DB.access[appId] || []).filter(x => x.url !== url);
      const app = DB.apps.find(a => a.id === appId);
      if (app) app.events.unshift({ t: clockNow(), k: 'warn', tx: `访问入口 <b>${esc(url)}</b> 已删除` });
      saveSnapshot();
      route();
      toast('访问入口已删除', 'warn');
    }
  });
}

function appAccessView(app) {
  const list = DB.access[app.id] || [];
  const gw = DB.gateway;
  const live = list.filter(x => x.status === '已生效');
  const primary = live.find(x => x.scope === '公网') || live[0];
  const dCount = live.filter(x => x.type === '域名').length;
  const pCount = live.filter(x => x.type === '网关路径').length;

  if (!list.length) {
    return `<div class="empty">
      <div class="eic">${icon('globe', '', 22)}</div>
      <h3>尚未配置访问入口</h3>
      <p>可以为应用绑定独立域名，或直接挂到平台网关路径下，无需单独申请域名。</p>
      <button class="btn primary" onclick="newAccess('${app.id}')">新增入口</button>
    </div>`;
  }

  return `
  ${primary ? `
  <div class="card" style="margin-bottom:14px;background:linear-gradient(100deg,#f7faff 0%,#fdfdff 55%,#fff 100%);border-color:#dbe7ff">
    <div class="card-body" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="width:42px;height:42px;border-radius:12px;background:#fff;border:1px solid #dbe7ff;display:grid;place-items:center;color:var(--primary);flex:0 0 42px">
        ${icon('globe', '', 20)}
      </div>
      <div style="flex:1;min-width:280px">
        <div class="tiny" style="color:var(--text-3);display:flex;align-items:center;gap:6px">
          主访问入口
          <span class="badge ${primary.type === '域名' ? 'purple' : 'info'}">${primary.type}</span>
          <span class="badge ok">已生效</span>
        </div>
        <div class="mono" style="font-size:17px;font-weight:650;letter-spacing:-.3px;margin-top:3px;color:var(--text)">${esc(primary.url)}</div>
        <div class="tiny muted" style="margin-top:4px">
          ${primary.env} · ${primary.scope} · 转发至 <span class="mono">${esc(primary.backend)}</span> · ${primary.tls} · ${primary.hits}
        </div>
      </div>
      <div style="display:flex;gap:7px">
        <button class="btn" onclick="copyText('${esc(primary.url)}')">${icon('copy', '', 13)}复制</button>
        <button class="btn" onclick="openAccess('${app.id}','${esc(primary.url)}')">访问链路</button>
        <button class="btn primary" onclick="newAccess('${app.id}')">${icon('plus', '', 13)}新增入口</button>
      </div>
    </div>
  </div>` : ''}

  <div class="card" style="margin-bottom:14px">
    <div class="card-head">
      <div class="t">全部访问入口</div>
      <div class="r tiny muted">生效 ${live.length} 条 · 域名 ${dCount} · 网关路径 ${pCount}</div>
    </div>
    ${list.map(e => `
      <div style="padding:13px 16px;border-bottom:1px solid #f0f3f9;display:flex;gap:12px;align-items:flex-start">
        <span class="badge ${e.type === '域名' ? 'purple' : 'info'}" style="margin-top:2px;flex:0 0 auto">${e.type}</span>
        <div style="flex:1;min-width:0">
          <div class="mono" style="font-size:12.5px;font-weight:600;color:${e.status === '已生效' ? 'var(--text)' : 'var(--text-3)'};word-break:break-all">${esc(e.url)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;align-items:center" class="tiny muted">
            <span class="chip">${e.env}</span>
            <span>${e.scope}</span><span>·</span>
            <span>后端 <b class="mono" style="color:var(--text-2)">${esc(e.backend)}</b></span><span>·</span>
            <span>${e.tls}</span><span>·</span>
            <span>${e.auth}</span><span>·</span>
            <span>${e.hits}</span>
          </div>
          ${e.note ? `<div class="tiny muted" style="margin-top:3px">${esc(e.note)}</div>` : ''}
        </div>
        <div style="flex:0 0 auto;margin-top:1px">${badge(e.status)}</div>
        <div style="display:flex;gap:2px;flex:0 0 auto;align-items:center">
          <button class="btn sm ghost" onclick="copyText('${esc(e.url)}')">复制</button>
          <button class="btn sm ghost" onclick="openAccess('${app.id}','${esc(e.url)}')">链路</button>
          <button class="btn sm ghost" onclick="toggleAccess('${app.id}','${esc(e.url)}')">${e.status === '已生效' ? '停用' : '启用'}</button>
          <button class="mini-act danger" title="删除入口" onclick="deleteAccess('${app.id}','${esc(e.url)}')">${icon('archive', '', 13)}</button>
        </div>
      </div>`).join('')}
  </div>

  <div class="card" style="box-shadow:none">
    <div class="card-head"><div class="t">平台网关</div><div class="r"><span class="badge ok">运行中</span></div></div>
    <div class="card-body">
      <div class="grid g4" style="gap:18px">
        <div><div class="tiny muted">网关域名</div><div class="mono" style="font-weight:600;margin-top:2px">${gw.domain}</div></div>
        <div><div class="tiny muted">入口 IP</div><div class="mono" style="font-weight:600;margin-top:2px">${gw.ip}</div></div>
        <div><div class="tiny muted">证书</div><div style="font-weight:600;margin-top:2px">${gw.cert}</div></div>
        <div><div class="tiny muted">引擎</div><div style="font-weight:600;margin-top:2px">${gw.engine}</div></div>
      </div>
      <div class="divider"></div>
      <div class="tiny muted" style="line-height:1.8">
        路径型入口由平台统一签发，无需自备域名，规则为
        <span class="mono" style="color:var(--text-2)">${gw.pathRule}</span>；
        若需绑定自有域名，新增入口时填写域名并完成 CNAME 指向 <span class="mono" style="color:var(--text-2)">${gw.domain}</span> 即可。
      </div>
    </div>
  </div>`;
}

/* 访问链路说明（请求从哪里进来、落到哪个工作负载） */
function openAccess(appId, url) {
  const app = DB.apps.find(a => a.id === appId);
  const e = (DB.access[appId] || []).find(x => x.url === url);
  if (!app || !e) return;
  const host = e.backend.split(':')[0];
  const comp = findComp(app, host)
    || app.components.find(c => c.workloads.some(w => w.name === host || w.id === host));
  const wls = comp ? comp.workloads : [];

  const step = (n, t, d, c) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;position:relative">
    <div style="width:21px;height:21px;border-radius:50%;background:${c}1a;color:${c};display:grid;place-items:center;font-size:10.5px;font-weight:700;flex:0 0 21px">${n}</div>
    <div style="min-width:0">
      <div style="font-size:12.3px;font-weight:600;color:var(--text)">${t}</div>
      <div class="tiny mono" style="color:var(--text-2);margin-top:1px;word-break:break-all">${esc(d)}</div>
    </div>
  </div>`;

  openModal({
    title: '访问链路',
    desc: `${app.name} · ${e.type}`,
    okText: '关闭',
    cancelText: '复制地址',
    body: `<div style="border-left:2px dashed var(--border);margin-left:10px;padding-left:12px">
      ${step(1, '客户端发起请求', e.url, '#2563eb')}
      ${step(2, '平台网关接入', `${DB.gateway.domain} · ${DB.gateway.ip} · TLS`, '#0d9488')}
      ${step(3, '路由匹配', `${e.type}规则 → ${e.backend}（${e.auth}）`, '#7c3aed')}
      ${step(4, '转发到后端', comp ? `组件 ${comp.name} · ${comp.workloads.length} 个工作负载` : e.backend, '#2563eb')}
      ${wls.length ? `<div style="padding:2px 0 4px 31px;display:flex;gap:5px;flex-wrap:wrap">
        ${wls.map(w => `<span class="chip" style="font-size:10.5px">${esc(w.name)} · ${wReady(w)}</span>`).join('')}
      </div>` : ''}
    </div>
    <div class="tiny muted" style="margin-top:10px;padding-top:9px;border-top:1px solid var(--border);line-height:1.7">
      该链路为平台内统一入口，鉴权、限流、证书轮换均在网关层完成，业务组件无需感知。
    </div>`,
    onOk: () => copyText(e.url)
  });
}

function gotoComp(n) { S.appComp = n; goAppTab(currentAppId(), 'components'); }

function copyText(t) {
  const done = () => toast(`已复制 <b class="mono">${t}</b>`, 'ok');
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (err) { toast('复制失败，请手动选择文本', 'warn'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done).catch(fallback);
  } else fallback();
}

/* ==========================================================
   全局组件视图：应用 → 组件 → 工作负载 的中间层
   ========================================================== */
function compRows() {
  const rows = [];
  DB.apps.forEach(a => a.components.forEach(c => {
    let ready = 0, want = 0;
    c.workloads.forEach(w => {
      if (w.kind === 'CronJob') return;
      ready += w.readyN || 0;
      want += w.replicas || 0;
    });
    const bad = c.workloads.filter(w => w.status !== '运行中' && w.status !== '已完成').length;
    rows.push({
      name: c.name, role: c.role, image: c.image, version: c.version,
      runtime: c.runtime, buildMode: c.buildMode,
      pending: !c.runtime || c.runtime === RUNTIME_PENDING,
      app: a.name, appId: a.id, appLevel: a.level,
      wl: c.workloads.length, bad, ready, want
    });
  }));
  return rows;
}
function compFiltered() {
  const q = (S.compQ || '').trim().toLowerCase();
  return compRows().filter(c => {
    if (S.compApp !== 'all' && c.appId !== S.compApp) return false;
    if (S.compFilter === 'bad' && !c.bad) return false;
    if (S.compFilter === 'empty' && c.wl) return false;
    if (!q) return true;
    return c.name.includes(q) || c.app.toLowerCase().includes(q) || c.role.toLowerCase().includes(q) || c.runtime.toLowerCase().includes(q);
  });
}
function viewComponents() {
  setCrumb('组件');
  if (S.compApp !== 'all' && !DB.apps.some(a => a.id === S.compApp)) S.compApp = 'all';
  const all = compRows();
  const list = compFiltered();
  const badCount = all.filter(c => c.bad).length;
  const emptyCount = all.filter(c => !c.wl).length;
  return `
  <div class="page-head">
    <div>
      <div class="ttl">组件</div>
      <div class="sub">组件是构建与发布的边界：向上归属应用，向下展开为工作负载。此视图跨应用汇总全部组件。</div>
    </div>
    <div class="acts">
      <button class="btn" onclick="location.hash='/apps'">${icon('box', '', 14)}按应用浏览</button>
      <button class="btn primary" onclick="newComponentGlobal()">${icon('plus', '', 14)}新建组件</button>
    </div>
  </div>

  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">组件</div><div class="val">${all.length}</div>
      <div class="foot">分布在 <b>${new Set(all.map(c => c.appId)).size}</b> 个应用</div></div>
    <div class="stat"><div class="lab">工作负载</div><div class="val">${all.reduce((s, c) => s + c.wl, 0)}</div>
      <div class="foot">平均 <b>${all.length ? (all.reduce((s, c) => s + c.wl, 0) / all.length).toFixed(1) : '0.0'}</b> 个 / 组件</div></div>
    <div class="stat"><div class="lab">实例</div><div class="val">${all.reduce((s, c) => s + c.ready, 0)}<small> / ${all.reduce((s, c) => s + c.want, 0)}</small></div>
      <div class="foot">就绪 / 期望副本</div></div>
    <div class="stat"><div class="lab">需关注</div><div class="val" style="${badCount || emptyCount ? 'color:var(--warning)' : ''}">${badCount + emptyCount}</div>
      <div class="foot">${badCount} 个有异常负载 · ${emptyCount} 个暂无工作负载</div></div>
  </div>

  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:240px">${icon('search', '', 14)}
        <input id="comp-q" placeholder="组件名 / 应用 / 运行时" value="${esc(S.compQ)}" oninput="compQuery(this.value)" />
      </div>
      <select class="input" style="width:170px;height:30px;padding:0 8px;font-size:12px" onchange="compApp(this.value)">
        <option value="all"${S.compApp === 'all' ? ' selected' : ''}>全部应用</option>
        ${DB.apps.map(a => `<option value="${a.id}"${S.compApp === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select>
      ${[['all', '全部'], ['bad', '有异常'], ['empty', '无工作负载']].map(([k, n]) =>
        `<button class="filter-pill ${S.compFilter === k ? 'on' : ''}" onclick="compFilter('${k}')">${n}</button>`).join('')}
      <div class="grow"><span class="tiny muted" style="align-self:center" id="comp-count">${list.length} 个组件</span></div>
    </div>
    <table class="table">
      <thead><tr><th>组件</th><th>所属应用</th><th>角色</th><th>运行时</th><th>版本</th><th class="right">工作负载</th><th class="right">实例</th><th>状态</th></tr></thead>
      <tbody id="comp-rows">${compTableRows(list)}</tbody>
    </table>
  </div>`;
}
function compTableRows(list) {
  if (!list.length) {
    return `<tr><td colspan="8"><div class="empty" style="padding:34px 16px">
      <h3>没有匹配的组件</h3><p>换个应用或筛选条件，或者清空搜索关键词。</p></div></td></tr>`;
  }
  return list.map(c => `<tr class="clickable" onclick="openComponent('${c.appId}','${esc(c.name)}')">
    <td class="name">${esc(c.name)}<div class="sub mono">${esc(c.image)}</div></td>
    <td><span style="color:var(--text)">${esc(c.app)}</span> ${badge(c.appLevel)}</td>
    <td><span class="chip">${esc(c.role)}</span></td>
    <td class="tiny" style="color:var(--text-2)">${c.pending
      ? `<span class="muted" title="运行时由首次构建自动识别，创建时无需填写">待首次构建</span>`
      : esc(c.runtime)}${c.buildMode && c.pending ? `<div class="sub">${esc(c.buildMode)}</div>` : ''}</td>
    <td class="mono" style="font-size:11px">${esc(c.version)}</td>
    <td class="right num">${c.wl}</td>
    <td class="right num">${c.want ? `${c.ready}/${c.want}` : '—'}</td>
    <td>${c.bad ? `<span class="badge warn">${c.bad} 个异常</span>` : c.wl ? '<span class="badge ok"><i></i>健康</span>' : '<span class="badge muted">无负载</span>'}</td>
  </tr>`).join('');
}
function paintComps() {
  const list = compFiltered();
  const rows = $('#comp-rows');
  if (rows) rows.innerHTML = compTableRows(list);
  const cnt = $('#comp-count');
  if (cnt) cnt.textContent = `${list.length} 个组件`;
}
function compQuery(v) { S.compQ = v; paintComps(); }
function compApp(v) { S.compApp = v; paintComps(); }
function compFilter(v) {
  S.compFilter = v;
  document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('on'));
  const btn = [...document.querySelectorAll('.filter-pill')].find(b => b.textContent.trim() === ({ all: '全部', bad: '有异常', empty: '无工作负载' })[v]);
  if (btn) btn.classList.add('on');
  paintComps();
}
function openComponent(appId, name) {
  S.appComp = name;
  S.appWl = null;
  goAppTab(appId, 'components');
}
function openComponentsOf(appId) {
  S.compApp = appId;
  S.compFilter = 'all';
  S.compQ = '';
  goto('#/components');
}
/* 组件上下游：来自 DB.deps[appId] 的 [上游, 下游, 说明, async?] */
function compDeps(appId, key) {
  const app = DB.apps.find(a => a.id === appId);
  const self = findComp(app, key);
  const selfId = self ? self.id : key;
  const selfName = self ? self.name : key;
  const list = (DB.deps && DB.deps[appId]) || [];
  const nameOf = k => compLabel(app, k);
  const isSelf = k => k === selfId || k === selfName;
  return {
    up: list.filter(e => isSelf(e[1])).map(e => ({ n: nameOf(e[0]), l: e[2] })),
    down: list.filter(e => isSelf(e[0])).map(e => ({ n: nameOf(e[1]), l: e[2] }))
  };
}
function newComponentGlobal() {
  if (!DB.apps.length) return toast('请先创建应用，组件必须归属于应用', 'warn');
  formModal({
    title: '新建组件',
    desc: '组件必须归属于某个应用；创建后可在应用详情里继续添加工作负载。',
    okText: '下一步',
    body: fField('所属应用', fSelect('appId', DB.apps.map(a => [a.id, a.name]), DB.apps[0].id), '组件是构建与发布的边界'),
    onSubmit: st => {
      if (!DB.apps.some(a => a.id === st.appId)) return '请选择所属应用';
      newComponent(st.appId);
    }
  });
}

/* ==========================================================
   全局访问入口
   ========================================================== */
function viewAccessList() {
  setCrumb('访问入口');
  const rows = [];
  DB.apps.forEach(a => (DB.access[a.id] || []).forEach(e => rows.push({ ...e, app: a.name, appId: a.id })));
  const gw = DB.gateway;
  const live = rows.filter(r => r.status === '已生效');
  const dCount = live.filter(r => r.type === '域名').length;
  const pCount = live.filter(r => r.type === '网关路径').length;
  const pub = live.filter(r => r.scope === '公网').length;

  return `
  <div class="page-head">
    <div><div class="ttl">访问入口</div>
      <div class="sub">所有应用对外暴露的统一视图。支持<b>独立域名</b>与<b>平台网关路径</b>两种形态，鉴权、限流与证书统一在网关层处理。</div></div>
    <div class="acts">
      <button class="btn" disabled title="证书管理尚未开放，当前由访问入口的 TLS 配置承担">证书管理</button>
      <button class="btn primary" onclick="newAccessGlobal()">${icon('plus', '', 14)}新增入口</button>
    </div>
  </div>

  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">生效入口</div><div class="val">${live.length}</div><div class="foot">共 ${rows.length} 条 · 1 条已停用</div></div>
    <div class="stat"><div class="lab">独立域名</div><div class="val">${dCount}</div><div class="foot">需自备证书或平台代签</div></div>
    <div class="stat"><div class="lab">网关路径</div><div class="val">${pCount}</div><div class="foot">平台统一签发，零配置</div></div>
    <div class="stat"><div class="lab">公网暴露</div><div class="val">${pub}</div><div class="foot">其余仅内网可达</div></div>
  </div>

  <div class="grid g21" style="margin-bottom:14px;align-items:stretch">
    <div class="card">
      <div class="card-head"><div class="t">平台网关</div><div class="r"><span class="badge ok">运行中</span></div></div>
      <div class="card-body" style="display:flex;gap:32px;flex-wrap:wrap">
        <div><div class="tiny muted">网关域名</div><div class="mono" style="font-weight:600;margin-top:2px">${gw.domain}</div></div>
        <div><div class="tiny muted">入口 IP</div><div class="mono" style="font-weight:600;margin-top:2px">${gw.ip}</div></div>
        <div><div class="tiny muted">证书</div><div style="font-weight:600;margin-top:2px">${gw.cert}</div></div>
        <div><div class="tiny muted">有效期</div><div style="font-weight:600;margin-top:2px">${gw.expire}</div></div>
        <div><div class="tiny muted">引擎</div><div style="font-weight:600;margin-top:2px">${gw.engine}</div></div>
        <div><div class="tiny muted">模式</div><div style="font-weight:600;margin-top:2px">${gw.mode}</div></div>
      </div>
    </div>
    <div class="card" style="background:linear-gradient(120deg,#f7faff,#fff);border-color:#dbe7ff">
      <div class="card-body">
        <div style="font-size:12.5px;font-weight:650;display:flex;align-items:center;gap:7px">
          <span style="color:var(--primary)">${icon('globe', '', 14)}</span>路径型入口规则
        </div>
        <div class="mono" style="font-size:11.5px;margin-top:8px;padding:8px 10px;background:#fff;border:1px solid #e2ebff;border-radius:7px;word-break:break-all">${gw.pathRule}</div>
        <div class="tiny muted" style="margin-top:8px;line-height:1.7">
          新建应用时自动分配路径，无需申请域名与证书，适合内部系统与联调环境。
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><div class="t">全部入口</div><div class="r tiny muted">按应用聚合</div></div>
    <div style="overflow-x:auto">
    <table class="table">
      <thead><tr><th>应用</th><th>类型</th><th>访问地址</th><th>后端</th><th>环境</th><th>范围</th><th>鉴权</th><th>状态</th><th class="right">操作</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td class="name"><span class="link" onclick="location.hash='/apps/${r.appId}'">${esc(r.app)}</span></td>
          <td><span class="badge ${r.type === '域名' ? 'purple' : 'info'}">${r.type}</span></td>
          <td class="mono" style="font-size:11.5px;color:${r.status === '已生效' ? 'var(--text)' : 'var(--text-3)'}">${esc(r.url)}</td>
          <td class="mono" style="font-size:11px">${esc(r.backend)}</td>
          <td><span class="chip">${r.env}</span></td>
          <td>${r.scope === '公网' ? '<span class="badge warn">公网</span>' : '<span class="badge muted">内网</span>'}</td>
          <td class="tiny">${r.auth}</td>
          <td>${badge(r.status)}</td>
          <td class="right" style="white-space:nowrap">
            <button class="btn sm ghost" onclick="copyText('${esc(r.url)}')">复制</button>
            <button class="btn sm ghost" onclick="openAccess('${r.appId}','${esc(r.url)}')">链路</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>
    </div>
  </div>`;
}

function whereChip(w) {
  const m = { '云端': 'blue', '边缘': 'teal', '端侧': 'purple' };
  return `<span class="chip ${m[w] || ''}">${w}</span>`;
}
function selectComp(n) { S.appComp = n; S.appWl = null; route(); }
function selectWl(n) { S.appWl = S.appWl === n ? null : n; route(); }

/* ---------- 工作负载（全局） ---------- */
function viewWorkloads() {
  setCrumb('工作负载');
  const all = DB.apps.flatMap(a => a.components.flatMap(c =>
    c.workloads.map(w => ({ ...w, app: a.name, appId: a.id, comp: c.name }))));

  const f = S.wlFilter;
  const list = all.filter(w =>
    f === 'all' ? true :
      f === '云端' || f === '边缘' || f === '端侧' ? w.where === f :
        f === '异常' ? (w.status !== '运行中' && w.status !== '已完成') : true);

  return `
  <div class="page-head">
    <div><div class="ttl">工作负载</div>
      <div class="sub">跨应用统一视图。工作负载是调度的最小单位，归属于某个组件，可调度至云端集群、边缘节点或端侧设备。</div></div>
  </div>

  <div class="card">
    <div class="toolbar">
      ${[['all', '全部'], ['云端', '云端'], ['边缘', '边缘'], ['端侧', '端侧'], ['异常', '异常']].map(([k, n]) =>
        `<button class="filter-pill ${f === k ? 'on' : ''}" onclick="S.wlFilter='${k}';route()">${n}
         <span style="font-size:10px;color:var(--text-3)">${k === 'all' ? all.length : k === '异常' ? all.filter(w => w.status !== '运行中' && w.status !== '已完成').length : all.filter(w => w.where === k).length}</span>
        </button>`).join('')}
      <div class="grow"><button class="btn sm" onclick="exportWorkloadsCsv()">${icon('archive', '', 12)}导出 CSV</button></div>
    </div>
    <div style="overflow-x:auto">
    <table class="table">
      <thead><tr><th>工作负载</th><th>所属应用 / 组件</th><th>类型</th><th>副本</th><th>状态</th><th>调度</th><th>集群</th><th>CPU</th><th class="right">重启</th></tr></thead>
      <tbody>
        ${list.map(w => `<tr class="clickable" onclick="wlOpen('${w.appId}','${esc(w.comp)}','${esc(w.name)}','overview')">
          <td class="name">${esc(w.name)}<div class="sub mono">${esc(w.image)}</div></td>
          <td>${esc(w.app)}<div class="sub">${esc(w.comp)}</div></td>
          <td><span class="chip">${esc(w.kind)}</span></td>
          <td class="num">${wReady(w)}</td>
          <td>${badge(w.status)}</td>
          <td>${whereChip(w.where)}</td>
          <td class="mono" style="font-size:11px">${esc(w.cluster)}</td>
          <td class="mono" style="font-size:11px">${esc(w.cpu)}</td>
          <td class="right num">${w.restarts}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
  </div>`;
}

/* ==========================================================
   工作负载详情：实例 / 指标 / 日志 / 事件 / YAML / 终端
   运行时数据由工作负载字段确定性生成，新建的负载同样有合理数据
   ========================================================== */
function wlUrl(appId, compKey, wlKey) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = findComp(app, compKey);
  const wl = findWl(comp, wlKey);
  return `#/workloads/${encodeURIComponent(appId)}/${encodeURIComponent(comp ? comp.id : compKey)}/${encodeURIComponent(wl ? wl.id : wlKey)}`;
}
function wHash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function parsePair(s) { // "1.8 / 8c" → [1.8, 8]（兼容旧调用）
  const r = parseRes(s);
  return [r.cur, r.cap];
}
/* 解析 "2Gi / 4Gi"、"256Mi / 512Mi"、"1.8 / 8c"，统一到 c 与 Gi */
function parseRes(s, kind) {
  const str = String(s || '');
  const m = str.match(/([\d.]+)\s*([A-Za-z%]*)\s*\/\s*([\d.]+)\s*([A-Za-z%]*)/);
  if (!m) return { cur: 0, cap: 1, unit: kind === 'mem' ? 'Gi' : 'c' };
  let cur = parseFloat(m[1]), cap = parseFloat(m[3]);
  let unit = m[4] || m[2] || (kind === 'mem' ? 'Gi' : 'c');
  if (kind === 'mem' && /^Mi$/i.test(unit)) { cur /= 1024; cap /= 1024; unit = 'Gi'; }
  if (kind === 'mem' && /^Gi$/i.test(unit)) unit = 'Gi';
  return { cur, cap, unit };
}
/* 数值展示：大数取整、小数保留有效位 */
function fmtQty(v) {
  if (!isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (a >= 1) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/0$/, '');
}
/* 镜像引用：data 里既有纯 tag（v2.4.1）也有完整引用（mysql:8.0.34） */
function imgRef(comp, w) {
  if (!comp) return w.image;
  return /:/.test(w.image) ? w.image : `${comp.image}:${w.image}`;
}
function wlFlavor(w) {
  const n = (w.name + ' ' + w.kind).toLowerCase();
  if (n.includes('cron') || n.includes('job') || n.includes('archiver') || n.includes('recon')) return 'job';
  if (w.kind === 'StatefulSet' || n.includes('-db') || n.includes('mysql')) return 'db';
  if (w.where === '边缘' || w.where === '端侧' || w.kind === 'EdgeApp') return 'edge';
  if (n.includes('worker') || n.includes('consumer') || n.includes('collector')) return 'queue';
  return 'http';
}

/* ---------- 实例（Pod） ---------- */
function podsFor(w) {
  const total = w.kind === 'CronJob' ? 0 : (w.replicas || 0);
  const readyN = Math.min(w.readyN == null ? total : w.readyN, total);
  if (!total) return [];
  const r = mulberry32(wHash(w.name));
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rc = parseRes(w.cpu, 'cpu'), rm = parseRes(w.mem, 'mem');
  const pods = [];
  for (let i = 0; i < total; i++) {
    const hash = Array.from({ length: 9 }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
    const suf = Array.from({ length: 5 }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
    const ready = i < readyN;
    const restarts = (w.restarts || 0) > 0 && i === total - 1 ? w.restarts : (r() > 0.9 ? 1 : 0);
    const node = w.where === '云端'
      ? `${w.cluster}-node-0${1 + Math.floor(r() * 6)}`
      : w.where === '边缘' ? w.cluster : `dev-${20000 + Math.floor(r() * 800)}`;
    pods.push({
      name: `${w.name}-${hash}-${suf}`,
      phase: ready ? 'Running' : (w.status === '待调度' ? 'Pending' : 'CrashLoopBackOff'),
      ready: ready ? '1/1' : (w.status === '待调度' ? '0/1' : `0/1`),
      restarts,
      node,
      ip: `10.${20 + Math.floor(r() * 20)}.${Math.floor(r() * 250)}.${2 + Math.floor(r() * 250)}`,
      age: i === 0 ? w.age : `${1 + Math.floor(r() * 20)}h`,
      cpu: (rc.cur / total * (0.8 + r() * 0.5)).toFixed(2),
      mem: (rm.cur / total * (0.9 + r() * 0.3)).toFixed(2)
    });
  }
  return pods;
}

/* ---------- 指标序列 ---------- */
function walk(r, n, base, amp, lo, hi, spike) {
  const out = []; let v = base;
  const at = Math.floor(n * (0.22 + r() * 0.55));
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * amp;
    if (spike && i >= at && i < at + 3) v += amp * 0.95;
    v = Math.max(lo, Math.min(hi, v));
    out.push(v);
  }
  return out;
}
/* 让序列末端收敛到当前值，避免图表尾值和上方统计卡对不上 */
function anchor(arr, target) {
  const n = arr.length, delta = target - arr[n - 1];
  return arr.map((v, i) => v + delta * Math.pow(i / (n - 1), 2.2));
}
function wlMetrics(w, range) {
  const n = range === '15m' ? 45 : range === '6h' ? 72 : 60;
  const r = mulberry32(wHash(w.name + range));
  const { cur: cpuCur, cap: cpuCap } = parseRes(w.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(w.mem, 'mem');
  const load = w.status === '运行中' ? 1 : w.status === '已完成' ? 0 : 0.7;
  const cpu = anchor(walk(r, n, cpuCur * load, cpuCap * 0.05, cpuCur * 0.4, cpuCap * 0.98, true), cpuCur * load);
  const mem = anchor(walk(r, n, memCur * load, memCap * 0.03, memCur * 0.55, memCap * 0.97, false), memCur * load);
  const baseRt = wlFlavor(w) === 'db' ? 18 : wlFlavor(w) === 'edge' ? 62 : 44;
  const rt = walk(r, n, baseRt / (load || 1), baseRt * 0.32, baseRt * 0.4, baseRt * 4, true);
  const qpsBase = wlFlavor(w) === 'job' ? 0.2 : 60 + (wHash(w.name) % 340);
  const qps = walk(r, n, qpsBase, qpsBase * 0.2, qpsBase * 0.25, qpsBase * 1.8, false);
  return { n, cpu, mem, rt, qps, cpuCap, memCap };
}
function axisLabels(range) {
  if (range === '15m') return ['-15m', '-10m', '-5m', '现在'];
  if (range === '6h') return ['-6h', '-4h', '-2h', '现在'];
  return ['-1h', '-40m', '-20m', '现在'];
}
function chartCard(title, sub, vals, o) {
  const W = 600, H = 110;
  const color = o.color || 'var(--primary)';
  const fmt = o.fmt || (v => v.toFixed(2));
  const max = Math.max(...vals), min = Math.min(...vals);
  const pad = (max - min) * 0.2 || Math.abs(max * 0.1) || 1;
  const lo = Math.max(0, min - pad), hi = max + pad;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - ((v - lo) / (hi - lo)) * H]);
  const d = 'M' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L');
  const area = `${d} L${W} ${H} L0 ${H} Z`;
  const last = vals[vals.length - 1];
  return `<div class="chart" data-vals='${JSON.stringify(vals.map(v => +v.toFixed(2)))}' data-unit='${o.unit || ''}' data-span='${o.span || 60}'>
    <div class="chart-h">
      <div><div class="chart-t">${title}</div><div class="chart-s">${sub}</div></div>
      <div class="chart-v">${fmt(last)}<small>${o.unit || ''}</small></div>
    </div>
    <div class="chart-body">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path d="${area}" fill="${color}" opacity=".09"/>
        <path d="${d}" fill="none" stroke="${color}" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        <line class="hl" x1="0" y1="0" x2="0" y2="${H}" stroke="#8b97ad" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" opacity="0"/>
        <circle class="hd" r="3.4" cx="0" cy="0" fill="${color}" stroke="#fff" stroke-width="1.6" opacity="0"/>
      </svg>
      <div class="chart-tip"></div>
    </div>
    <div class="chart-axis">${(o.labels || []).map(t => `<span>${t}</span>`).join('')}</div>
  </div>`;
}

/* ---------- 日志 ---------- */
const TRACE_IDS = ['4bf29a1c8e7d4f03', '9d0c2b7a4e51f8c6', '5a91c6e0f2b7d348', '7c33f0ab91d6e542', '2b8e6d1f45a7c093'];
const LOG_RES = ['/api/order/submit', '/api/order/detail', '/api/cart/add', '/api/stock/deduct', '/api/pay/charge', '/api/user/profile', '/api/inventory/sync'];
function stamp(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
function mkLog(w, r, ts) {
  const fl = wlFlavor(w);
  const trace = TRACE_IDS[Math.floor(r() * TRACE_IDS.length)];
  const pick = a => a[Math.floor(r() * a.length)];
  const ms = (2 + r() * 180).toFixed(1);
  const lvl = r() > 0.94 ? 'ERROR' : r() > 0.84 ? 'WARN' : r() > 0.16 ? 'INFO' : 'DEBUG';
  let msg;
  if (fl === 'http') {
    const code = lvl === 'ERROR' ? pick([500, 502, 503]) : pick([200, 200, 200, 201, 204, 304]);
    msg = r() > 0.45
      ? `${pick(['POST', 'GET', 'PUT'])} ${pick(LOG_RES)} ${code} ${ms}ms trace=${trace}`
      : `${pick(['orderService', 'inventoryClient', 'payGateway'])} ${lvl === 'ERROR' ? 'call failed: context deadline exceeded' : 'call ok'} cost=${ms}ms peer=${pick(['order-service', 'inventory-service', 'pay-router'])}`;
    if (lvl === 'ERROR' && r() > 0.6) msg += ' err="upstream reset by peer"';
  } else if (fl === 'queue') {
    msg = pick([
      `consume topic=${pick(['order.created', 'stock.updated', 'pay.result'])} partition=${Math.floor(r() * 6)} offset=${100000 + Math.floor(r() * 90000)} lag=${Math.floor(r() * 40)}`,
      `batch commit ${Math.floor(r() * 120) + 1} records cost=${ms}ms`,
      `ack topic=order.created msgId=${Math.floor(r() * 1e9).toString(36)}`
    ]);
    if (lvl === 'ERROR') msg = `consume failed topic=order.created retry=${1 + Math.floor(r() * 3)} err="deserialize payload: unexpected end of JSON"`;
  } else if (fl === 'job') {
    msg = pick([
      `job start schedule="*/5 * * * *" runId=${Math.floor(r() * 1e6)}`,
      `archived 1284 rows shard=${Math.floor(r() * 8)} cost=${ms}ms`,
      `job finish status=success duration=${(20 + r() * 40).toFixed(1)}s`
    ]);
  } else if (fl === 'db') {
    msg = pick([
      `slow query 412ms rows_examined=182044 sql="SELECT * FROM order_item WHERE created_at > ?"`,
      `connection pool active=18 idle=6 waiting=0`,
      `checkpoint complete lsn=${Math.floor(r() * 1e9).toString(16)}`
    ]);
    if (lvl === 'WARN') msg = `slow query ${(400 + r() * 900).toFixed(0)}ms rows_examined=${Math.floor(r() * 500000)}`;
  } else {
    msg = pick([
      `sync to cloud edges=${Math.floor(r() * 12) + 1} bytes=${Math.floor(r() * 4000) + 200} cost=${ms}ms`,
      `edge heartbeat node=${pick(['edge-sh-007', 'edge-sh-021', 'edge-hz-004'])} rtt=${(6 + r() * 30).toFixed(0)}ms`,
      `offline buffer flush records=${Math.floor(r() * 200)}`
    ]);
  }
  return { t: ts, level: lvl, msg };
}
function seedLogs(w, count) {
  const r = mulberry32(wHash(w.name + 'logs'));
  const now = Date.now();
  const out = [];
  for (let i = 0; i < count; i++) out.push(mkLog(w, r, now - (count - i) * 1400));
  return out;
}

/* ---------- 事件 ---------- */
function eventsFor(w, comp) {
  const r = mulberry32(wHash(w.name + 'ev'));
  const img = imgRef(comp, w);
  const ev = [
    { type: 'Normal', reason: 'Scheduled', msg: `Successfully assigned retail-prod/${w.name} to ${w.cluster}-node-0${1 + Math.floor(r() * 5)}`, count: 1, age: w.age },
    { type: 'Normal', reason: 'Pulling', msg: `Pulling image "${img}"`, count: 1, age: w.age },
    { type: 'Normal', reason: 'Started', msg: 'Started container ' + w.name, count: 1, age: w.age }
  ];
  if ((w.restarts || 0) > 0) {
    ev.push({ type: 'Warning', reason: 'Unhealthy', msg: `Liveness probe failed: Get "http://10.24.7.19:${comp ? comp.port : 8080}${comp ? comp.healthPath : '/healthz'}": context deadline exceeded`, count: w.restarts, age: '32m' });
    ev.push({ type: 'Warning', reason: 'BackOff', msg: 'Back-off restarting failed container', count: w.restarts, age: '31m' });
  }
  if (w.status !== '运行中' && w.status !== '已完成') {
    ev.push({ type: 'Warning', reason: w.status === '待调度' ? 'FailedScheduling' : 'Unhealthy', msg: w.status === '待调度' ? '0/6 nodes are available: 6 Insufficient cpu.' : 'Readiness probe failed: connection refused', count: 4, age: '8m' });
  }
  if (w.mesh === '已注入' && S.modules.mesh) {
    ev.push({ type: 'Normal', reason: 'SidecarInjected', msg: 'istio-proxy injected, mTLS strict mode active', count: 1, age: w.age });
  }
  return ev;
}

/* ---------- YAML ---------- */
/* 配置项 → 环境变量片段；密钥走 secretKeyRef */
function yamlFor(app, comp, w) {
  if (w.kind === 'CronJob') return cronYaml(app, comp, w);
  const { cur: cpuCur, cap: cpuCap } = parseRes(w.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(w.mem, 'mem');
  const np = w.replicas || 0;
  const reqCpu = Math.max(0.1, cpuCap / 4), reqMem = Math.max(0.25, memCap / 2);
  const inject = w.mesh === '已注入' && S.modules.mesh;
  const base = [
    'apiVersion: apps/v1',
    `kind: ${w.kind === 'StatefulSet' ? 'StatefulSet' : w.kind === 'CronJob' ? 'CronJob' : w.where !== '云端' ? 'EdgeApp' : 'Deployment'}`,
    'metadata:',
    `  name: ${w.name}`,
    `  namespace: ${app.id.split('-')[0]}-prod`,
    '  labels:',
    `    app.kubernetes.io/name: ${comp.name}`,
    `    app.kubernetes.io/component: ${comp.name}`,
    `    app.kubernetes.io/part-of: ${app.id}`,
    `    platform.io/application-id: ${app.id}`,
    'spec:',
    `  replicas: ${np}`,
    '  strategy:',
    '    type: RollingUpdate',
    '    rollingUpdate:',
    '      maxSurge: 25%',
    '      maxUnavailable: 0',
    '  selector:',
    '    matchLabels:',
    `      app: ${w.name}`,
    '  template:',
    '    metadata:',
    '      labels:',
    `        app: ${w.name}`,
    '      annotations:',
    `        sidecar.istio.io/inject: "${inject ? 'true' : 'false'}"`,
    '        platform.io/scheduled-to: ' + w.where,
    '    spec:',
    `      serviceAccountName: ${app.id}-sa`,
    '      nodeSelector:',
    `        topology.kubernetes.io/region: ${w.where === '云端' ? 'cn-east-1' : 'edge'}`,
    '      containers:',
    `        - name: ${w.name}`,
    `          image: ${imgRef(comp, w)}`,
    '          imagePullPolicy: IfNotPresent',
    '          ports:',
    `            - containerPort: ${comp.port}`,
    '              name: http',
    '          resources:',
    '            requests:',
    `              cpu: "${Math.round(reqCpu * 1000)}m"`,
    `              memory: "${reqMem}Gi"`,
    '            limits:',
    `              cpu: "${cpuCap}"`,
    `              memory: "${memCap}Gi"`,
    '          env:',
    '            - name: APP_ENV',
    '              value: prod',
    '            - name: OTEL_EXPORTER_OTLP_ENDPOINT',
    '              value: http://otel-collector.observability:4317',
    ...envYamlLines(effectiveEnv(app, comp, w), '            '),
    '          livenessProbe:',
    '            httpGet:',
    `              path: ${comp.healthPath}`,
    `              port: ${comp.port}`,
    '            initialDelaySeconds: 15',
    '            periodSeconds: 10',
    '          readinessProbe:',
    '            httpGet:',
    `              path: ${comp.readyPath}`,
    `              port: ${comp.port}`,
    '            periodSeconds: 5',
    ...ioMountLines(app, comp, w, '          ')
  ];
  base.push(...ioVolumeLines(app, comp, w, '      '));
  const kind = String(base[1] || '').replace('kind: ', '');
  if (kind === 'StatefulSet') {
    const i = base.indexOf('  selector:');
    base.splice(i, 0, `  serviceName: ${w.name}-headless`, '  podManagementPolicy: OrderedReady');
    const claims = (w.volumes || []).filter(v => v.type === 'pvc');
    if (claims.length) {
      base.push('  volumeClaimTemplates:');
      claims.forEach(v => base.push(...[
        '    - metadata:',
        `        name: ${v.name}`,
        '      spec:',
        `        accessModes: ["${v.mode || 'ReadWriteOnce'}"]`,
        v.sc ? `        storageClassName: ${v.sc}` : null,
        '        resources:',
        '          requests:',
        `            storage: ${v.size}`
      ].filter(Boolean)));
    }
  }
  if (kind === 'EdgeApp') {
    base[0] = 'apiVersion: edge.platform.io/v1alpha1';
    const i = base.findIndex(l => /^  replicas: /.test(l));
    base.splice(i + 1, 0,
      '  targetNodes:',
      `    selector: topology.kubernetes.io/region=edge`,
      `    count: 12`,
      '  offlinePolicy:',
      '    bufferSeconds: 3600',
      '    onReconnect: replay');
  }
  return base;
}
function cronYaml(app, comp, w) {
  const { cur: cpuCur, cap: cpuCap } = parseRes(w.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(w.mem, 'mem');
  const lines = [
    'apiVersion: batch/v1',
    'kind: CronJob',
    'metadata:',
    `  name: ${w.name}`,
    `  namespace: ${app.id.split('-')[0]}-prod`,
    '  labels:',
    `    app.kubernetes.io/name: ${comp.name}`,
    `    app.kubernetes.io/part-of: ${app.id}`,
    'spec:',
    '  schedule: "*/5 * * * *"',
    '  concurrencyPolicy: Forbid',
    '  startingDeadlineSeconds: 120',
    '  successfulJobsHistoryLimit: 3',
    '  failedJobsHistoryLimit: 1',
    '  jobTemplate:',
    '    spec:',
    '      backoffLimit: 2',
    '      template:',
    '        metadata:',
    '          labels:',
    `            app: ${w.name}`,
    '        spec:',
    '          restartPolicy: OnFailure',
    `          serviceAccountName: ${app.id}-sa`,
    '          containers:',
    `            - name: ${w.name}`,
    `              image: ${imgRef(comp, w)}`,
    '              args: ["--schedule=cron", "--once=false"]',
    '              resources:',
    '                requests:',
    `                  cpu: "${Math.round(Math.max(0.1, cpuCap / 8) * 1000)}m"`,
    `                  memory: "${Math.max(0.25, memCap / 4)}Gi"`,
    '                limits:',
    `                  cpu: "${cpuCap}"`,
    `                  memory: "${memCap}Gi"`,
    '              env:',
    '                - name: APP_ENV',
    '                  value: prod',
    ...envYamlLines(effectiveEnv(app, comp, w), '                ')
  ];
  return lines.concat(ioMountLines(app, comp, w, '                '), ioVolumeLines(app, comp, w, '          '));
}
function yamlDrift(lines) {
  // 线上运行态与仓库声明的差异：副本被手工扩过、镜像带 hotfix、多了一个调试环境变量
  return lines.map(l => {
    if (/^  replicas: /.test(l)) return l.replace(/\d+/, m => String(+m + 1));
    if (/^  schedule: /.test(l)) return l.replace(/\*\/\d+/, '*/2');
    if (/^\s+image: /.test(l) && /:v?\d/.test(l)) return l.replace(/:v?([\d.]+)$/, ':v$1-hotfix');
    if (/^\s+- name: APP_ENV/.test(l)) {
      const ind = l.match(/^(\s*)/)[1];
      return `${ind}- name: DEBUG_PROFILE\n${ind}  value: "true"\n` + l;
    }
    return l;
  }).join('\n').split('\n');
}
function hlYaml(line) {
  if (/^\s*#/.test(line)) return `<span class="y-c">${esc(line)}</span>`;
  const kv = line.match(/^(\s*)(-\s+)?([A-Za-z0-9_.\/-]+)(:)(.*)$/);
  if (kv) {
    const [, sp, dash, k, colon, rest] = kv;
    return `${sp}${dash || ''}<span class="y-k">${k}</span>${colon}${hlVal(esc(rest))}`;
  }
  return hlVal(esc(line));
}
function hlVal(s) {
  return s
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="y-s">$1</span>')
    .replace(/(^|\s)(true|false|null)(\s|$)/g, '$1<span class="y-b">$2</span>$3')
    .replace(/(\s)([\d.]+[a-zA-Z%]*)/g, '$1<span class="y-n">$2</span>');
}
function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([' ', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', a[i]]); i++; }
    else { out.push(['+', b[j]]); j++; }
  }
  while (i < n) out.push(['-', a[i++]]);
  while (j < m) out.push(['+', b[j++]]);
  return out;
}

/* ---------- 终端 ---------- */
const TERM_HELP = `可用命令（原型模拟）：
  ls                  查看工作目录
  env                 环境变量
  cat /etc/os-release 基础镜像信息
  ps                  进程列表
  curl localhost:8080/healthz   健康检查
  clear               清屏`;
function termWelcome(w) {
  return [
    { k: 'sys', v: `Connected to ${w.name} · ${w.cluster}` },
    { k: 'sys', v: `容器 ${w.name} /bin/sh · 30 分钟无操作自动断开 · 输入 help 查看可用命令` }
  ];
}
function termRun(w, raw) {
  const cmd = (raw || '').trim();
  if (!cmd) return;
  const out = [{ k: 'cmd', v: `$ ${cmd}` }];
  const push = (v, k = 'out') => out.push({ k, v });
  switch (cmd) {
    case 'ls':
      push('bin  boot  dev  etc  healthz  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var  workspace');
      break;
    case 'env':
      push('APP_ENV=prod'); push(`POD_NAME=${w.name}-5b6c8d`); push(`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability:4317`);
      push(`OTEL_SERVICE_NAME=${w.name}`); push('JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75'); push('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/bin');
      break;
    case 'cat /etc/os-release':
      push('NAME="Alpine Linux"'); push('VERSION="3.20.3"'); push('ID=alpine'); push('PRETTY_NAME="Alpine Linux v3.20"');
      break;
    case 'ps':
    case 'ps aux':
      push('PID   USER   TIME  COMMAND');
      push(`    1 root   0:12  /app/${w.name}`);
      push('   18 root   0:03  /usr/local/bin/envoy -c /etc/istio/proxy/envoy-rev.json');
      push('   42 root   0:00  /bin/sh');
      break;
    case 'curl localhost:8080/healthz':
    case 'curl -s localhost:8080/healthz':
      push('{"status":"UP","checks":[{"name":"db","status":"UP"},{"name":"redis","status":"UP"}]}');
      break;
    case 'help':
      push(TERM_HELP);
      break;
    case 'clear':
      return 'clear';
    default:
      push(`/bin/sh: ${cmd}: not found`, 'err');
  }
  return out;
}

/* ---------- 详情页 ---------- */
function viewWorkloadDetail(appId, compName, wlName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  const wl = comp && findWl(comp, wlName);
  setCrumb(app ? app.name : '工作负载');

  if (!wl) {
    return `<div class="card"><div class="empty" style="padding:60px 20px">
      <h3>找不到该工作负载</h3>
      <p>它可能已被删除，或链接里的应用 / 组件名不匹配。</p>
      <button class="btn primary" onclick="location.hash='/workloads'">返回工作负载列表</button>
    </div></div>`;
  }

  const wlKey = `${appId}/${compName}/${wlName}`;
  if (S.wlKey !== wlKey) {
    S.wlKey = wlKey;
    S.wlTab = S.wlPending || 'overview';
    S.wlPending = null;
    S.term = [];
    S.termKey = '';
    S.yamlDiff = false;
  }

  const tabs = [['overview', '概览'], ['metrics', '指标'], ['logs', '日志'], ['events', '事件'], ['io', '配置与存储'], ['yaml', 'YAML'], ['terminal', '终端']];
  const { cur: cpuCur, cap: cpuCap } = parseRes(wl.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(wl.mem, 'mem');
  const pods = podsFor(wl);

  return `
  <div class="page-head">
    <div style="min-width:0">
      <div class="ttl" style="display:flex;align-items:center;gap:9px">${esc(wl.name)} ${badge(wl.status)} <span class="chip">${esc(wl.kind)}</span></div>
      <div class="sub">
        <span class="link" onclick="location.hash='/apps/${app.id}/components'">${esc(app.name)}</span>
        <span class="muted"> / </span>
        <span class="link" onclick="location.hash='/apps/${app.id}/components'">${esc(comp.name)}</span>
        <span class="muted"> / </span><span class="mono">${esc(wl.image)}</span>
        · ${whereChip(wl.where)} <span class="mono">${esc(wl.cluster)}</span>
        ${wl.mesh === '已注入' && S.modules.mesh ? '· <span class="badge info">Sidecar 已注入</span>' : ''}
      </div>
      <div class="lbl-row">${labelChips(wl.labels, 4)}</div>
    </div>
    <div class="acts">
      <button class="btn" onclick="wlGo('logs')">${icon('doc', '', 14)}日志</button>
      <button class="btn" onclick="wlGo('terminal')">${icon('server', '', 14)}终端</button>
      <button class="btn" onclick="wlRestart('${app.id}','${comp.name}','${wl.name}')">${icon('refresh', '', 14)}重启</button>
      <button class="btn primary" onclick="location.hash='/cicd'">${icon('flow', '', 14)}发布</button>
    </div>
  </div>

  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">实例</div><div class="val">${wReady(wl)}</div>
      <div class="foot">${pods.filter(p => p.phase === 'Running').length} 个 Running · ${pods.length} 个实例</div></div>
    <div class="stat"><div class="lab">重启次数</div><div class="val" style="${wl.restarts ? 'color:var(--warning)' : ''}">${wl.restarts}</div>
      <div class="foot">运行时长 ${esc(wl.age)}</div></div>
    <div class="stat"><div class="lab">CPU</div><div class="val">${fmtQty(cpuCur)}<small>/ ${fmtQty(cpuCap)}c</small></div>
      <div class="foot"><div class="progress thin" style="width:100%"><div style="width:${Math.min(100, cpuCur / cpuCap * 100)}%;background:${cpuCur / cpuCap > 0.8 ? 'var(--warning)' : 'var(--primary)'}"></div></div></div></div>
    <div class="stat"><div class="lab">内存</div><div class="val">${fmtQty(memCur)}<small>/ ${fmtQty(memCap)}Gi</small></div>
      <div class="foot"><div class="progress thin" style="width:100%"><div style="width:${Math.min(100, memCur / memCap * 100)}%;background:${memCur / memCap > 0.8 ? 'var(--warning)' : 'var(--success)'}"></div></div></div></div>
  </div>

  <div class="card">
    <div class="tabs wl-tabs">
      ${tabs.map(([k, n]) => `<div class="tab ${S.wlTab === k ? 'on' : ''}" onclick="wlGo('${k}')">${n}</div>`).join('')}
    </div>
    ${wlTabBody(app, comp, wl, pods)}
  </div>`;
}
function wlGo(k) {
  S.wlTab = k;
  if (k === 'logs') ensureLogs(curWl());
  route();
}
function wlOpen(appId, comp, name, tab) {
  const key = `${appId}/${comp}/${name}`;
  if (S.wlKey === key) S.wlTab = tab || 'overview';
  else S.wlPending = tab || 'overview';
  goto(wlUrl(appId, comp, name));
}
function curWl() {
  const p = location.hash.replace(/^#/, '').split('/').filter(Boolean);
  const app = DB.apps.find(a => a.id === decodeURIComponent(p[1] || ''));
  const comp = app && findComp(app, decodeURIComponent(p[2] || ''));
  return comp && findWl(comp, decodeURIComponent(p[3] || ''));
}
function wlTabBody(app, comp, wl, pods) {
  if (S.wlTab === 'metrics') return wlMetricsView(wl);
  if (S.wlTab === 'logs') return wlLogsView(wl);
  if (S.wlTab === 'events') return wlEventsView(wl, comp);
  if (S.wlTab === 'io') return wlIOView(app, comp, wl);
  if (S.wlTab === 'yaml') return wlYamlView(app, comp, wl);
  if (S.wlTab === 'terminal') return wlTerminalView(wl);
  return wlOverviewView(app, comp, wl, pods);
}

function wlOverviewView(app, comp, wl, pods) {
  const m = wlMetrics(wl, '1h');
  const ev = eventsFor(wl, comp).slice(-3).reverse();
  const inject = wl.mesh === '已注入' && S.modules.mesh;
  return `
  <div class="card-body" style="padding:14px 16px 6px">
    <div class="grid g2" style="gap:14px">
      ${chartCard('CPU 使用', '近 1 小时 · 单位核心', m.cpu, { unit: 'c', color: '#2563eb', labels: axisLabels('1h'), span: 60, fmt: v => fmtQty(v) })}
      ${chartCard('内存占用', '近 1 小时 · 单位 GiB', m.mem, { unit: 'GiB', color: '#0d9488', labels: axisLabels('1h'), span: 60, fmt: v => fmtQty(v) })}
    </div>
  </div>

  <div class="card-body tight" style="border-top:1px solid var(--border)">
    <div style="padding:13px 16px 9px;display:flex;align-items:center;gap:8px">
      <div style="font-size:12.5px;font-weight:650">实例</div>
      <span class="chip">${pods.length}</span>
      <span class="tiny muted" style="margin-left:auto">节点名与 IP 为调度结果，重启次数含历史累计</span>
    </div>
    ${pods.length ? `<div style="overflow-x:auto"><table class="table">
      <thead><tr><th>Pod</th><th>状态</th><th>就绪</th><th>重启</th><th>节点</th><th>IP</th><th>CPU</th><th>内存</th><th class="right">运行时长</th></tr></thead>
      <tbody>${pods.map(p => `<tr>
        <td class="name mono" style="font-size:11px">${esc(p.name)}</td>
        <td>${p.phase === 'Running' ? '<span class="badge ok"><i></i>Running</span>' : `<span class="badge bad">${esc(p.phase)}</span>`}</td>
        <td class="num">${esc(p.ready)}</td>
        <td class="num" style="${p.restarts ? 'color:var(--warning);font-weight:600' : ''}">${p.restarts}</td>
        <td class="mono" style="font-size:11px">${esc(p.node)}</td>
        <td class="mono" style="font-size:11px">${esc(p.ip)}</td>
        <td class="num">${p.cpu}c</td>
        <td class="num">${p.mem}Gi</td>
        <td class="right mono" style="font-size:11px">${esc(p.age)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty" style="padding:26px 16px">
      <p style="margin:0">${wl.kind === 'CronJob'
        ? '该工作负载按计划触发，不保留常驻实例；每次运行会创建一个临时 Job 与 Pod。'
        : `当前副本数为 0（${esc(wl.status)}），没有运行中的实例。把副本数调大即会自动拉起。`}</p>
    </div>`}
  </div>

  <div class="grid g3" style="gap:0;border-top:1px solid var(--border)">
    <div style="padding:14px 16px;border-right:1px solid var(--border)">
      <div class="tiny muted" style="margin-bottom:9px">容器</div>
      <dl class="kv" style="grid-template-columns:70px 1fr">
        <dt>名称</dt><dd class="mono" style="font-size:11px">${esc(wl.name)}</dd>
        <dt>镜像</dt><dd class="mono" style="font-size:11px;word-break:break-all">${esc(imgRef(comp, wl))}</dd>
        <dt>端口</dt><dd class="mono" style="font-size:11px">${comp.port}/TCP · http</dd>
        <dt>拉取策略</dt><dd>IfNotPresent</dd>
        ${inject ? `<dt>Sidecar</dt><dd>istio-proxy 1.29 · mTLS strict</dd>` : ''}
      </dl>
    </div>
    <div style="padding:14px 16px;border-right:1px solid var(--border)">
      <div class="tiny muted" style="margin-bottom:9px">探针与策略</div>
      <dl class="kv" style="grid-template-columns:70px 1fr">
        <dt>存活探针</dt><dd class="mono" style="font-size:11px">GET ${esc(comp.healthPath)} :${comp.port} · 10s</dd>
        <dt>就绪探针</dt><dd class="mono" style="font-size:11px">GET ${esc(comp.readyPath)} :${comp.port} · 5s</dd>
        <dt>更新策略</dt><dd>RollingUpdate · 25% / 0</dd>
        <dt>调度位置</dt><dd>${whereChip(wl.where)} <span class="mono muted" style="font-size:10.5px">${esc(wl.cluster)}</span></dd>
      </dl>
    </div>
    <div style="padding:14px 16px">
      <div class="tiny muted" style="margin-bottom:9px">最近事件</div>
      ${ev.map(e => `<div style="display:flex;gap:7px;margin-bottom:7px;font-size:11.5px">
        <span class="badge ${e.type === 'Warning' ? 'warn' : 'muted'}" style="flex:none">${e.reason}</span>
        <span style="color:var(--text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45">${esc(e.msg)}</span>
      </div>`).join('')}
      <div class="link tiny" onclick="wlGo('events')">查看全部事件 →</div>
    </div>
  </div>`;
}

function wlMetricsView(wl) {
  const range = S.wlRange;
  const m = wlMetrics(wl, range);
  const labels = axisLabels(range);
  const span = range === '15m' ? 15 : range === '6h' ? 360 : 60;
  const { cur: cpuCur, cap: cpuCap } = parseRes(wl.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(wl.mem, 'mem');
  return `
  <div class="toolbar">
    <div class="seg">
      ${[['15m', '15 分钟'], ['1h', '1 小时'], ['6h', '6 小时']].map(([k, n]) =>
        `<button class="${range === k ? 'on' : ''}" onclick="wlSetRange('${k}')">${n}</button>`).join('')}
    </div>
    <span class="tiny muted">采样 15s · 数据来自 Prometheus（原型模拟）</span>
    <div class="grow"><button class="btn sm" onclick="toast('已刷新指标')">${icon('refresh', '', 12)}刷新</button></div>
  </div>
  <div class="card-body" style="padding:14px 16px">
    <div class="grid g2" style="gap:16px">
      ${chartCard('CPU 使用', `${fmtQty(cpuCap)}c 上限 · 当前 ${fmtQty(cpuCur)}c`, m.cpu, { unit: 'c', color: '#2563eb', labels, span, fmt: v => fmtQty(v) })}
      ${chartCard('内存占用', `${fmtQty(memCap)}Gi 上限 · 当前 ${fmtQty(memCur)}Gi`, m.mem, { unit: 'GiB', color: '#0d9488', labels, span, fmt: v => fmtQty(v) })}
      ${chartCard('P99 响应延迟', '按入口请求统计', m.rt, { unit: 'ms', color: '#c2760a', labels, span, fmt: v => Math.round(v) })}
      ${chartCard('请求速率', '每秒请求数', m.qps, { unit: 'req/s', color: '#7c3aed', labels, span, fmt: v => Math.round(v) })}
    </div>
    <div class="sd-note" style="margin-top:6px">悬停任意曲线可查看该时刻的读数。指标仅覆盖当前工作负载实例，不含 Sidecar 自身开销。</div>
  </div>`;
}
function wlSetRange(k) { S.wlRange = k; route(); }

function wlLogsView(wl) {
  const L = S.logs;
  ensureLogs(wl);
  const containers = [wl.name, ...(wl.mesh === '已注入' && S.modules.mesh ? ['istio-proxy'] : [])];
  return `
  <div class="toolbar log-toolbar">
    <select class="input" style="width:160px;height:30px;padding:0 8px;font-size:12px" onchange="logSet('container', this.value)">
      ${containers.map(c => `<option value="${esc(c)}"${L.container === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    ${['all', 'ERROR', 'WARN', 'INFO', 'DEBUG'].map(k =>
      `<button class="filter-pill ${L.level === k ? 'on' : ''}" onclick="logSet('level','${k}')">${k === 'all' ? '全部' : k}</button>`).join('')}
    <div class="search" style="margin:0;width:190px">${icon('search', '', 13)}
      <input placeholder="过滤关键字" value="${esc(L.q)}" oninput="logSet('q', this.value, true)" />
    </div>
    <div class="grow">
      <button class="btn sm ${L.paused ? 'primary' : ''}" onclick="logTogglePause()">${L.paused ? '继续跟随' : '暂停'}</button>
      <button class="btn sm" onclick="logClear()">清空</button>
      <span class="tiny muted" style="align-self:center" id="logmeta">${L.lines.length} 行</span>
    </div>
  </div>
  <div class="logview" id="logview">${logRows()}</div>
  <div class="logfoot">
    <span class="dot-live ${L.paused ? 'off' : ''}"></span>${L.paused ? '已暂停，新日志仍在接收' : '实时跟随中'}
    <span style="margin-left:auto" class="mono">kubectl logs -f ${esc(wl.name)}</span>
  </div>`;
}
function ensureLogs(wl) {
  if (!wl) return;
  const key = wl.name + '|' + wl.image;
  if (S.logs.key === key && S.logs.lines.length) return;
  S.logs.key = key;
  S.logs.lines = seedLogs(wl, 60);
  S.logs.paused = false;
  S.logs.q = '';
  S.logs.level = 'all';
  S.logs.container = wl.name;
  S.logs.pending = 0;
}
function logMatch(l) {
  const L = S.logs;
  if (L.level !== 'all' && l.level !== L.level) return false;
  if (L.q && !l.msg.toLowerCase().includes(L.q.toLowerCase())) return false;
  return true;
}
function logRows() {
  const L = S.logs;
  const list = L.lines.filter(logMatch);
  if (!list.length) return `<div class="log-empty">没有匹配的日志行</div>`;
  return list.map(l => {
    let msg = esc(l.msg);
    if (L.q) {
      const re = new RegExp(`(${L.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      msg = msg.replace(re, '<mark>$1</mark>');
    }
    return `<div class="ln ${l.level}"><span class="lt">${stamp(l.t)}</span><span class="ll">${l.level}</span><span class="lm">${msg}</span></div>`;
  }).join('');
}
function logSet(k, v, typing) {
  S.logs[k] = v;
  if (k === 'level' || k === 'container') route();
  else paintLogs();
}
function paintLogs() {
  const el = $('#logview');
  if (!el) return;
  el.innerHTML = logRows();
  if (S.logs.follow !== false) el.scrollTop = el.scrollHeight;
  const meta = $('#logmeta');
  if (meta) meta.textContent = `${S.logs.lines.filter(logMatch).length} / ${S.logs.lines.length} 行`;
}
function logTogglePause() {
  S.logs.paused = !S.logs.paused;
  if (!S.logs.paused) S.logs.pending = 0;
  route();
}
function logClear() {
  S.logs.lines = [];
  paintLogs();
  toast('日志视图已清空（仅影响当前会话）');
}

function wlEventsView(wl, comp) {
  const ev = eventsFor(wl, comp).reverse();
  return `
  <div class="toolbar">
    <span class="badge warn">${ev.filter(e => e.type === 'Warning').length} 条 Warning</span>
    <span class="badge muted">${ev.filter(e => e.type === 'Normal').length} 条 Normal</span>
    <span class="tiny muted">保留 1 小时 · 相同原因会聚合计数</span>
    <div class="grow"><button class="btn sm" onclick="toast('已刷新事件')">${icon('refresh', '', 12)}刷新</button></div>
  </div>
  <table class="table">
    <thead><tr><th>类型</th><th>原因</th><th>消息</th><th class="right">次数</th><th>最近发生</th></tr></thead>
    <tbody>${ev.map(e => `<tr>
      <td>${e.type === 'Warning' ? '<span class="badge warn">Warning</span>' : '<span class="badge muted">Normal</span>'}</td>
      <td class="name">${esc(e.reason)}</td>
      <td class="mono" style="font-size:11px;color:var(--text-2);max-width:620px">${esc(e.msg)}</td>
      <td class="right num">${e.count}</td>
      <td class="tiny muted">${esc(e.age)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function wlYamlView(app, comp, wl) {
  const lines = yamlFor(app, comp, wl);
  const showDiff = S.yamlDiff;
  const ops = showDiff ? diffLines(lines, yamlDrift(lines)) : null;
  const body = showDiff
    ? ops.map(([k, l]) => `<div class="yl ${k === '+' ? 'add' : k === '-' ? 'del' : ''}">
        <span class="yn">${k === '+' ? '+' : k === '-' ? '-' : ''}</span>
        <code>${hlYaml(l)}</code></div>`).join('')
    : lines.map((l, i) => `<div class="yl"><span class="yn">${i + 1}</span><code>${hlYaml(l)}</code></div>`).join('');
  return `
  <div class="toolbar">
    <span class="chip blue">${esc(wl.kind)}</span>
    <span class="tiny muted">声明式配置 · 与集群内实际对象保持同步</span>
    <div class="grow">
      <button class="btn sm" onclick="S.yamlDiff=${showDiff ? 'false' : 'true'};route()">${showDiff ? '退出对比' : '与运行态对比'}</button>
      <button class="btn sm" onclick="toast('YAML 已复制到剪贴板','ok')">${icon('copy', '', 12)}复制</button>
    </div>
  </div>
  ${showDiff ? `<div class="diff-legend"><span class="add">+ 线上多出的行</span><span class="del">- 仓库声明但线上缺失</span><span>对比基准：上一次发布提交的清单</span></div>` : ''}
  <div class="yaml"><div class="ylines">${body}</div></div>`;
}

function wlTerminalView(wl) {
  if (S.termKey !== wl.name) {
    S.termKey = wl.name;
    S.term = termWelcome(wl);
  }
  return `
  <div class="term">
    <div class="term-bar"><i></i><i></i><i></i><span>${esc(wl.name)} · /bin/sh · ${esc(wl.cluster)}</span></div>
    <div class="term-body" id="termbody">
      ${S.term.map(l => `<div class="tl ${l.k}">${esc(l.v)}</div>`).join('')}
    </div>
    <form class="term-in" onsubmit="termSubmit(event)">
      <span>$</span><input id="terminput" autocomplete="off" spellcheck="false" placeholder="输入命令，help 查看可用命令" />
    </form>
  </div>`;
}
function termSubmit(e) {
  e.preventDefault();
  const inp = $('#terminput');
  const cmd = inp.value;
  inp.value = '';
  const wl = curWl();
  const res = termRun(wl, cmd);
  if (res === 'clear') S.term = [];
  else S.term.push(...res);
  const body = $('#termbody');
  if (body) {
    body.innerHTML = S.term.map(l => `<div class="tl ${l.k}">${esc(l.v)}</div>`).join('');
    body.scrollTop = body.scrollHeight;
  }
  inp.focus();
}
function wlRestart(appId, comp, name) {
  const app = DB.apps.find(a => a.id === appId);
  const c = app && findComp(app, comp);
  const w = c && findWl(c, name);
  if (!w) return;
  w.restarts = (w.restarts || 0) + 0;
  w.status = '运行中';
  saveSnapshot();
  toast('已触发滚动重启，实例将逐个替换', 'ok');
  route();
}

/* 详情页渲染后的挂载：图表悬停、日志跟随 */
let LOG_TIMER = null;
function mountWorkload() {
  if (LOG_TIMER) { clearInterval(LOG_TIMER); LOG_TIMER = null; }
  document.querySelectorAll('.chart').forEach(bindChart);
  if (S.wlTab !== 'logs') return;
  paintLogs();
  LOG_TIMER = setInterval(() => {
    if (!S.logs.lines.length && S.logs.paused) return;
    const wl = curWl();
    if (!wl) return;
    const r = mulberry32(Date.now() & 0xffff);
    S.logs.lines.push(mkLog(wl, r, Date.now()));
    if (S.logs.lines.length > 400) S.logs.lines.splice(0, S.logs.lines.length - 400);
    if (S.logs.paused) { S.logs.pending++; if (S.logs.pending === 1) paintLogs(); return; }
    paintLogs();
  }, 1500);
}
function bindChart(el) {
  const vals = JSON.parse(el.dataset.vals || '[]');
  if (!vals.length) return;
  const svg = el.querySelector('svg');
  const hl = el.querySelector('.hl'), hd = el.querySelector('.hd');
  const tip = el.querySelector('.chart-tip');
  const unit = el.dataset.unit || '';
  const span = +el.dataset.span || 60;
  const W = 600, H = 110;
  const max = Math.max(...vals), min = Math.min(...vals);
  const pad = (max - min) * 0.2 || Math.abs(max * 0.1) || 1;
  const lo = Math.max(0, min - pad), hi = max + pad;
  el.onmousemove = e => {
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const i = Math.round(frac * (vals.length - 1));
    const v = vals[i];
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - lo) / (hi - lo)) * H;
    hl.setAttribute('x1', x); hl.setAttribute('x2', x); hl.setAttribute('opacity', '.9');
    hd.setAttribute('cx', x); hd.setAttribute('cy', y); hd.setAttribute('opacity', '1');
    const pct = i / (vals.length - 1);
    const mins = Math.round(span * (1 - pct));
    const rel = mins <= 0 ? '现在' : mins >= 120 ? `-${(mins / 60).toFixed(1)}h` : `-${mins}m`;
    tip.innerHTML = `<b>${v}${unit}</b><span>${rel}</span>`;
    tip.style.left = Math.min(rect.width - 76, Math.max(6, frac * rect.width - 38)) + 'px';
    tip.classList.add('on');
  };
  el.onmouseleave = () => {
    hl.setAttribute('opacity', '0'); hd.setAttribute('opacity', '0');
    tip.classList.remove('on');
  };
}

/* ==========================================================
   配置与密钥：应用级存储，作用域可落到组件
   ========================================================== */
/* ==========================================================
   配置 / 密钥 / 存储
   ----------------------------------------------------------
   配置项（ConfigMap）与密钥（Secret）建在应用级，按作用域生效；
   挂载方式有两种：环境变量（env）与文件挂载（file，按目录挂成卷）。
   存储卷建在工作负载级：持久卷（PVC）与临时卷（emptyDir）。
   ========================================================== */
const SC_DEFS = [
  { name: 'standard-ssd', provider: '阿里云 ESSD', reclaim: 'Delete', binding: 'WaitForFirstConsumer', desc: '通用 SSD，默认存储类' },
  { name: 'ceph-rbd', provider: 'Ceph RBD', reclaim: 'Retain', binding: 'Immediate', desc: '块存储，支持多挂载（ReadWriteMany）' },
  { name: 'local-path', provider: '节点本地盘', reclaim: 'Delete', binding: 'WaitForFirstConsumer', desc: '边缘场景默认，随节点漂移重建' }
];
const VOL_TYPES = [['pvc', '持久卷 PVC'], ['emptyDir', '临时卷 emptyDir']];
const ACCESS_MODES = ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany'];

/* 历史数据补齐：配置项的挂载方式、工作负载的自有变量与存储卷 */
function normalizeIO() {
  Object.keys(DB.config || {}).forEach(k => {
    DB.config[k].forEach(c => {
      if (!c.mount) c.mount = 'env';
      if (c.mount === 'file' && !c.path) c.path = c.secret ? '/etc/app/secrets' : '/etc/app/conf';
    });
  });
  DB.apps.forEach(a => a.components.forEach(c => c.workloads.forEach(w => {
    if (!Array.isArray(w.env)) {
      w.env = [];
      if (w.kind === 'EdgeApp') w.env = [{ key: 'EDGE_SYNC_INTERVAL', value: '30' }, { key: 'MODEL_DIR', value: '/models' }];
      else if (w.kind === 'CronJob') w.env = [{ key: 'JOB_DRY_RUN', value: 'false' }];
      else if (w.kind === 'StatefulSet') w.env = [{ key: 'TZ', value: 'Asia/Shanghai' }];
      else if (/order-service/.test(w.name)) w.env = [{ key: 'JAVA_TOOL_OPTIONS', value: '-XX:MaxRAMPercentage=75' }];
      else if (w.mesh === '已注入') w.env = [{ key: 'TZ', value: 'Asia/Shanghai' }];
    }
    if (!Array.isArray(w.volumes)) {
      if (w.kind === 'StatefulSet') w.volumes = [{ name: 'data', type: 'pvc', size: '100Gi', sc: 'standard-ssd', mode: 'ReadWriteOnce', mount: '/var/lib/mysql' }];
      else if (w.kind === 'EdgeApp') w.volumes = [{ name: 'cache', type: 'pvc', size: '20Gi', sc: 'local-path', mode: 'ReadWriteOnce', mount: '/models' }, { name: 'tmp', type: 'emptyDir', size: '2Gi', mount: '/tmp' }];
      else if (w.kind === 'CronJob') w.volumes = [{ name: 'tmp', type: 'emptyDir', size: '2Gi', mount: '/tmp' }];
      else if (/order-service-api/.test(w.name)) w.volumes = [{ name: 'logs', type: 'pvc', size: '50Gi', sc: 'standard-ssd', mode: 'ReadWriteOnce', mount: '/var/log/app' }, { name: 'tmp', type: 'emptyDir', size: '1Gi', mount: '/tmp' }];
      else w.volumes = [{ name: 'tmp', type: 'emptyDir', size: '1Gi', mount: '/tmp' }];
    }
  })));
}

/* 当前工作负载实际生效的环境变量：应用配置（同作用域）在前，工作负载自有覆盖同名项 */
function effectiveEnv(app, comp, w) {
  const out = new Map();
  configOf(app, comp.name).filter(c => (c.mount || 'env') === 'env')
    .forEach(c => out.set(c.key, { key: c.key, value: c.value, secret: !!c.secret, from: 'app', scope: c.scope }));
  (w.env || []).forEach(e => out.set(e.key, { key: e.key, value: e.value, secret: false, from: 'wl' }));
  return [...out.values()];
}
function envYamlLines(list, ind) {
  return list.flatMap(e => e.secret
    ? [`${ind}- name: ${e.key}`, `${ind}  valueFrom:`, `${ind}    secretKeyRef:`, `${ind}      name: app-secrets`, `${ind}      key: ${e.key}`]
    : [`${ind}- name: ${e.key}`, `${ind}  value: "${String(e.value).replace(/"/g, '\\"')}"`]);
}

/* 工作负载的卷：自有存储卷 + 应用配置里以文件方式挂载的项（按目录合并成 ConfigMap / Secret 卷） */
function ioVolumes(app, comp, w) {
  const out = (w.volumes || []).map(v => ({ ...v }));
  const files = configOf(app, comp.name).filter(c => c.mount === 'file');
  const byPath = new Map();
  files.forEach(c => {
    const p = c.path || '/etc/app/conf';
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p).push(c);
  });
  let ci = 0, si = 0;
  [...byPath.entries()].forEach(([path, items]) => {
    const plains = items.filter(i => !i.secret);
    const secrets = items.filter(i => i.secret);
    if (plains.length) {
      ci++;
      out.push({ name: `app-config-${ci}`, type: 'configMap', mount: path, readOnly: true, items: plains.map(i => i.key), source: `${app.id}-config` });
    }
    if (secrets.length) {
      si++;
      out.push({ name: `app-secret-${si}`, type: 'secret', mount: path, readOnly: true, items: secrets.map(i => i.key), source: 'app-secrets' });
    }
  });
  return out;
}
function pvcName(w, v) { return `${w.name}-${v.name}`; }
function ioMountLines(app, comp, w, ind) {
  const vols = ioVolumes(app, comp, w);
  if (!vols.length) return [];
  const out = [`${ind}volumeMounts:`];
  vols.forEach(v => {
    out.push(`${ind}  - name: ${v.name}`);
    out.push(`${ind}    mountPath: ${v.mount}`);
    if (v.readOnly || v.type === 'configMap' || v.type === 'secret') out.push(`${ind}    readOnly: true`);
  });
  return out;
}
function ioVolumeLines(app, comp, w, ind) {
  const vols = ioVolumes(app, comp, w).filter(v => !(v.type === 'pvc' && w.kind === 'StatefulSet'));
  if (!vols.length) return [];
  const out = [`${ind}volumes:`];
  vols.forEach(v => {
    out.push(`${ind}  - name: ${v.name}`);
    if (v.type === 'pvc') {
      out.push(`${ind}    persistentVolumeClaim:`, `${ind}      claimName: ${pvcName(w, v)}`);
    } else if (v.type === 'emptyDir') {
      out.push(`${ind}    emptyDir:`);
      if (v.size) out.push(`${ind}      sizeLimit: ${v.size}`);
    } else if (v.type === 'configMap') {
      out.push(`${ind}    configMap:`, `${ind}      name: ${v.source}`, `${ind}      items:`);
      v.items.forEach(k => out.push(`${ind}        - key: ${k}`, `${ind}          path: ${k}`));
    } else if (v.type === 'secret') {
      out.push(`${ind}    secret:`, `${ind}      secretName: ${v.source}`, `${ind}      items:`);
      v.items.forEach(k => out.push(`${ind}        - key: ${k}`, `${ind}          path: ${k}`));
    }
  });
  return out;
}

/* ---------- 工作负载：配置与存储页签 ---------- */
function ioWl() {
  const p = location.hash.replace(/^#/, '').split('/').filter(Boolean);
  const app = DB.apps.find(a => a.id === decodeURIComponent(p[1] || ''));
  const comp = app && findComp(app, decodeURIComponent(p[2] || ''));
  const w = comp && findWl(comp, decodeURIComponent(p[3] || ''));
  return { app, comp, w };
}
function wlIOView(app, comp, wl) {
  const env = effectiveEnv(app, comp, wl);
  const own = wl.env || [];
  const vols = ioVolumes(app, comp, wl);
  const files = configOf(app, comp.name).filter(c => c.mount === 'file');
  return `
  <div class="card" style="box-shadow:none;margin-bottom:14px">
    <div class="card-head">
      <div class="t">环境变量</div>
      <div class="r">
        <span class="tiny muted">${env.length} 个生效 · 其中 ${own.length} 个工作负载自有</span>
        <button class="btn sm primary" onclick="wlEnvNew()">${icon('plus', '', 12)}新增变量</button>
      </div>
    </div>
    <table class="table">
      <thead><tr><th style="width:26%">Key</th><th style="width:26%">值</th><th style="width:14%">来源</th><th style="width:14%">生效范围</th><th>已注入</th><th class="right" style="width:16%">操作</th></tr></thead>
      <tbody>${env.length ? env.map(e => {
        const shown = S.ioShown[e.key];
        return `<tr>
          <td class="name mono" style="font-size:11.5px">${esc(e.key)}</td>
          <td class="mono" style="font-size:11px">
            ${e.secret && !shown
              ? `<span style="letter-spacing:2px;color:var(--text-3)">••••••••</span>
                 <button class="btn sm ghost" style="height:18px;padding:0 5px;margin-left:4px" onclick="ioReveal('${esc(e.key)}')">显示</button>`
              : esc(String(e.value).slice(0, 60))}
          </td>
          <td>${e.from === 'app' ? '<span class="chip blue">应用配置</span>' : '<span class="chip">工作负载</span>'}</td>
          <td class="tiny">${e.from === 'app' ? esc(e.scope === 'all' ? '全部组件' : e.scope) : '仅本负载'}</td>
          <td>${e.secret ? '<span class="badge purple">secretKeyRef</span>' : '<span class="badge muted">明文</span>'}</td>
          <td class="right" onclick="event.stopPropagation()">
            <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
              ${e.from === 'app'
                ? `<button class="btn sm" onclick="location.hash='/apps/${app.id}/config'">去配置页</button>`
                : `<button class="btn sm" onclick="wlEnvEdit('${esc(e.key)}')">编辑</button>
                   <button class="mini-act danger" title="删除变量" onclick="wlEnvDelete('${esc(e.key)}')">${icon('archive', '', 13)}</button>`}
            </div>
          </td>
        </tr>`;
      }).join('') : `<tr><td colspan="6"><div class="empty" style="padding:26px 16px">
        <h3>还没有环境变量</h3><p>在应用「配置与密钥」里添加，或在本页新增工作负载自有变量。</p></div></td></tr>`}</tbody>
    </table>
    <div class="cfg-foot">工作负载自有变量与同名的应用配置「同名覆盖」，只影响本负载；密钥统一在应用级维护，避免轮换时逐负载改。</div>
  </div>

  <div class="card" style="box-shadow:none">
    <div class="card-head">
      <div class="t">存储卷</div>
      <div class="r">
        <span class="tiny muted">${vols.length} 个挂载${files.length ? ` · 含 ${files.length} 个配置文件` : ''}</span>
        <button class="btn sm primary" onclick="wlVolNew()">${icon('plus', '', 12)}新增存储卷</button>
      </div>
    </div>
    <table class="table">
      <thead><tr><th style="width:24%">卷名</th><th style="width:14%">类型</th><th style="width:10%">容量</th><th style="width:14%">存储类</th><th style="width:12%">访问模式</th><th style="width:16%">挂载路径</th><th class="right">操作</th></tr></thead>
      <tbody>${vols.length ? vols.map(v => `<tr>
        <td class="name mono" style="font-size:11.5px">${esc(v.name)}
          <div class="sub">${v.type === 'pvc' ? esc(pvcName(wl, v)) : v.type === 'emptyDir' ? '随 Pod 生命周期' : esc(v.source || '') + (v.items ? ` · ${v.items.length} 个键` : '')}</div>
        </td>
        <td><span class="chip ${v.type === 'pvc' ? 'blue' : v.type === 'emptyDir' ? '' : v.type === 'secret' ? 'purple' : 'teal'}">${v.type === 'pvc' ? '持久卷' : v.type === 'emptyDir' ? '临时卷' : v.type === 'secret' ? '密钥卷' : '配置卷'}</span></td>
        <td class="mono" style="font-size:11px">${esc(v.size || '—')}</td>
        <td class="mono" style="font-size:11px">${esc(v.sc || '—')}</td>
        <td class="tiny">${esc(v.type === 'pvc' ? (v.mode || 'ReadWriteOnce') : v.type === 'emptyDir' ? '—' : '只读')}</td>
        <td class="mono" style="font-size:11px">${esc(v.mount)}</td>
        <td class="right">
          ${v.type === 'configMap' || v.type === 'secret'
            ? '<span class="tiny muted">随配置变化</span>'
            : `<button class="mini-act danger" title="移除挂载" onclick="wlVolDelete('${esc(v.name)}')">${icon('archive', '', 13)}</button>`}
        </td>
      </tr>`).join('') : `<tr><td colspan="7"><div class="empty" style="padding:26px 16px">
        <h3>还没有存储卷</h3><p>持久卷适合数据库与日志，临时卷适合缓存与临时文件。</p></div></td></tr>`}</tbody>
    </table>
    <div class="cfg-foot">持久卷会创建同名的 PVC；StatefulSet 使用 volumeClaimTemplates 按副本独立申请，删负载不会自动删除数据卷。</div>
  </div>`;
}
function ioReveal(key) {
  S.ioShown[key] = !S.ioShown[key];
  route();
}
function wlEnvModal(key) {
  const { app, comp, w } = ioWl();
  if (!w) return;
  const item = key ? (w.env || []).find(e => e.key === key) : null;
  const appCfg = configOf(app, comp.name).filter(c => (c.mount || 'env') === 'env');
  formModal({
    title: item ? `编辑变量 · ${item.key}` : '新增环境变量',
    desc: '工作负载自有变量只作用于本负载；与应用配置同名时以这里的值为准。',
    okText: item ? '保存' : '新增',
    body: `
      ${fField('Key', fInput('key', item ? item.key : '', 'JAVA_TOOL_OPTIONS'), '大写字母、数字与下划线', true)}
      ${fField('值', fInput('value', item ? item.value : '', ''), '纯文本；敏感信息请放到应用级密钥')}
      ${appCfg.some(c => c.key === (item ? item.key : '')) ? '<div class="hint" style="color:var(--warning)">应用配置里已有同名 Key，保存后将覆盖应用级取值。</div>' : ''}`,
    onSubmit: st => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(st.key)) return 'Key 只能是大写字母、数字与下划线，并以字母开头';
      if (!st.value) return '请填写变量值';
      w.env = w.env || [];
      if (w.env.some(e => e.key === st.key && e.key !== key)) return `变量 ${st.key} 已存在`;
      if (item) item.value = st.value;
      else w.env.push({ key: st.key, value: st.value });
      app.updated = nowStamp();
      saveSnapshot();
      route();
      toast(item ? '变量已更新' : '变量已新增', 'ok');
    }
  });
}
function wlEnvNew() { wlEnvModal(''); }
function wlEnvEdit(key) { wlEnvModal(key); }
function wlEnvDelete(key) {
  const { app, w } = ioWl();
  if (!w) return;
  openModal({
    title: '删除环境变量',
    desc: key,
    danger: true,
    okText: '确认删除',
    body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">删除后，本负载下次发布时不再注入该变量；若应用配置里有同名项，会回落到应用级取值。</p>`,
    onOk: () => {
      w.env = (w.env || []).filter(e => e.key !== key);
      app.updated = nowStamp();
      saveSnapshot();
      route();
      toast('变量已删除', 'warn');
    }
  });
}
function wlVolModal() {
  const { app, comp, w } = ioWl();
  if (!w) return;
  const used = (w.volumes || []).map(v => v.name);
  formModal({
    title: '新增存储卷',
    desc: '持久卷用于数据与日志；临时卷随 Pod 重建清空，适合缓存。',
    okText: '挂载',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('卷名', fInput('name', '', 'data'), '小写字母、数字与连字符，PVC 名为「负载名-卷名」', true)}
        ${fField('类型', fSelect('type', VOL_TYPES, 'pvc'))}
      </div>
      <div class="form-row">
        ${fField('容量', fInput('size', '20Gi', '20Gi'), '持久卷必填，临时卷作为 sizeLimit')}
        ${fField('挂载路径', fInput('mount', '/data', '/data'), '容器内绝对路径', true)}
      </div>
      <div class="form-row">
        ${fField('存储类', fSelect('sc', SC_DEFS.map(s => [s.name, s.name]), 'standard-ssd'), '决定后端存储与绑定方式')}
        ${fField('访问模式', fSelect('mode', ACCESS_MODES, 'ReadWriteOnce'))}
      </div>`,
    onSubmit: st => {
      const name = String(st.name || '').trim();
      if (!NAME_RE.test(name)) return '卷名只能是小写字母、数字与连字符';
      if (used.includes(name)) return `卷名 ${name} 已存在`;
      if (!String(st.mount || '').startsWith('/')) return '挂载路径需以 / 开头';
      const pvc = st.type === 'pvc';
      if (pvc && !String(st.size || '').trim()) return '持久卷需要填写容量';
      if (pvc && !/^\d+(Gi|Mi|Ti)$/.test(String(st.size).trim())) return '容量格式如 20Gi / 512Mi / 1Ti';
      w.volumes = w.volumes || [];
      w.volumes.push({
        name,
        type: pvc ? 'pvc' : 'emptyDir',
        size: String(st.size || '').trim(),
        sc: pvc ? st.sc : '',
        mode: pvc ? st.mode : '',
        mount: st.mount
      });
      app.updated = nowStamp();
      saveSnapshot();
      route();
      toast(`已挂载 ${name} 到 ${st.mount}`, 'ok');
    }
  });
}
function wlVolNew() { wlVolModal(); }
function wlVolDelete(name) {
  const { app, w } = ioWl();
  if (!w) return;
  const v = (w.volumes || []).find(x => x.name === name);
  if (!v) return;
  openModal({
    title: '移除存储卷',
    desc: `${name} · ${v.mount}`,
    danger: true,
    okText: '确认移除',
    body: `<div class="danger-box">
        从负载清单中移除挂载点后，Pod 重建即生效。
        ${v.type === 'pvc' ? 'PVC 会保留（回收策略 Delete 时才随声明删除），数据不会自动清除，但负载将无法再访问。' : '临时卷内的数据会随 Pod 删除而丢失。'}
      </div>`,
    onOk: () => {
      w.volumes = w.volumes.filter(x => x.name !== name);
      app.updated = nowStamp();
      saveSnapshot();
      route();
      toast(`已移除挂载 ${name}`, 'warn');
    }
  });
}

/* ---------- 全局：存储 ---------- */
function pvcList() {
  const out = [];
  DB.apps.forEach(a => a.components.forEach(c => c.workloads.forEach(w => {
    (w.volumes || []).filter(v => v.type === 'pvc').forEach(v => out.push({
      name: pvcName(w, v), app: a.name, appId: a.id, comp: c.name, wl: w.name,
      size: v.size || '—', sc: v.sc || 'standard-ssd', mode: v.mode || 'ReadWriteOnce',
      mount: v.mount, status: w.status === '运行中' ? '已绑定' : '未绑定'
    }));
  })));
  return out;
}
function storageUsedGi(size) {
  const m = String(size || '').match(/^([\d.]+)\s*(Ti|Gi|Mi)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] === 'Ti' ? n * 1024 : m[2] === 'Mi' ? n / 1024 : n;
}
function viewStorage() {
  setCrumb('存储');
  const list = pvcList();
  const totalGi = list.reduce((s, p) => s + storageUsedGi(p.size), 0);
  const pending = list.filter(p => p.status === '未绑定').length;
  const scRows = SC_DEFS.map(sc => {
    const own = list.filter(p => p.sc === sc.name);
    return { ...sc, count: own.length, gi: own.reduce((s, p) => s + storageUsedGi(p.size), 0), wls: new Set(own.map(p => p.wl)).size };
  });
  const q = String(S.storeQ || '').trim().toLowerCase();
  const rows = list.filter(p => !q || [p.name, p.app, p.wl, p.sc].join(' ').toLowerCase().includes(q));
  return `
  <div class="page-head">
    <div><div class="ttl">存储</div><div class="sub">持久卷由工作负载的存储卷声明派生，随发布一起下发；临时卷不计入容量。</div></div>
    <div class="acts"><button class="btn" onclick="toast('存储类由集群管理员在基础设施侧维护')">存储类说明</button></div>
  </div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">持久卷声明</div><div class="val">${list.length}</div><div class="foot">跨 ${new Set(list.map(p => p.app)).size} 个应用</div></div>
    <div class="stat"><div class="lab">申请容量</div><div class="val">${fmtQty(totalGi)}<small>Gi</small></div><div class="foot">按声明值合计，非实际占用</div></div>
    <div class="stat"><div class="lab">存储类</div><div class="val">${scRows.filter(s => s.count).length}<small>/ ${SC_DEFS.length}</small></div><div class="foot">默认 standard-ssd</div></div>
    <div class="stat"><div class="lab">未绑定</div><div class="val" style="color:${pending ? 'var(--warning)' : 'inherit'}">${pending}</div><div class="foot">${pending ? '所属工作负载非运行中' : '全部已绑定'}</div></div>
  </div>

  <div class="grid g3" style="margin-bottom:14px">
    ${scRows.map(s => `<div class="card"><div class="card-body">
      <div class="spread"><div style="font-size:13px;font-weight:650" class="mono">${esc(s.name)}</div>
        ${s.name === 'standard-ssd' ? '<span class="badge info">默认</span>' : ''}</div>
      <div class="tiny muted" style="margin-top:3px">${esc(s.provider)} · ${esc(s.reclaim)} · ${esc(s.binding)}</div>
      <div class="divider"></div>
      <div class="spread" style="font-size:12px"><span class="muted">声明 / 容量</span><span><b>${s.count}</b> 个 · <span class="mono">${fmtQty(s.gi)}Gi</span></span></div>
      <div class="tiny muted" style="margin-top:6px">${esc(s.desc)}</div>
    </div></div>`).join('')}
  </div>

  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:240px">${icon('search', '', 14)}
        <input id="store-q" placeholder="搜索 PVC / 应用 / 工作负载" value="${esc(S.storeQ || '')}" oninput="storeSet(this.value)" />
      </div>
      <div class="grow"><span class="tiny muted" style="align-self:center" id="store-count">${rows.length} / ${list.length} 个声明</span></div>
    </div>
    <table class="table">
      <thead><tr><th style="width:24%">PVC</th><th style="width:20%">应用 / 工作负载</th><th style="width:9%">容量</th><th style="width:13%">存储类</th><th style="width:13%">访问模式</th><th style="width:12%">挂载路径</th><th>状态</th></tr></thead>
      <tbody id="store-rows">${storeRows(rows)}</tbody>
    </table>
    <div class="cfg-foot">删除工作负载不会级联删除 PVC；需要回收数据时在集群侧手动处理，或在存储类上启用 Delete 回收策略。</div>
  </div>`;
}
function storeRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="7"><div class="empty" style="padding:30px 16px">
      <h3>没有匹配的持久卷</h3><p>在任意工作负载的「配置与存储」页签里新增持久卷。</p></div></td></tr>`;
  }
  return rows.map(p => `<tr class="clickable" onclick="openWlIO('${p.appId}','${esc(p.comp)}','${esc(p.wl)}')">
    <td class="name mono" style="font-size:11.5px">${esc(p.name)}</td>
    <td class="tiny">${esc(p.app)}<div class="sub">${esc(p.wl)}</div></td>
    <td class="mono" style="font-size:11px">${esc(p.size)}</td>
    <td class="mono" style="font-size:11px">${esc(p.sc)}</td>
    <td class="tiny">${esc(p.mode)}</td>
    <td class="mono" style="font-size:11px">${esc(p.mount)}</td>
    <td>${badge(p.status)}</td>
  </tr>`).join('');
}
function storeSet(v) {
  S.storeQ = v;
  const q = String(v || '').trim().toLowerCase();
  const rows = pvcList().filter(p => !q || [p.name, p.app, p.wl, p.sc].join(' ').toLowerCase().includes(q));
  const box = $('#store-rows');
  if (box) box.innerHTML = storeRows(rows);
  const cnt = $('#store-count');
  if (cnt) cnt.textContent = `${rows.length} / ${pvcList().length} 个声明`;
}
function openWlIO(appId, comp, wl) {
  S.wlPending = 'io';
  goto(wlUrl(appId, comp, wl));
}

function ensureConfig(app) {
  if (!app) return [];
  if (!DB.config[app.id]) {
    const comps = app.components.map(c => c.name);
    const seed = [
      { key: 'LOG_LEVEL', value: 'info', scope: 'all', secret: false, note: '日志级别：debug / info / warn / error' },
      { key: 'OTEL_SAMPLE_RATIO', value: '0.125', scope: 'all', secret: false, note: '链路采样率' },
      { key: 'INTERNAL_API_TOKEN', value: 'tok_live_3a91c7', scope: 'all', secret: true, note: '内部服务间调用凭证' }
    ];
    if (comps.includes('order-service')) seed.push(
      { key: 'ORDER_TIMEOUT_MS', value: '800', scope: 'order-service', secret: false, note: '下单主流程超时（毫秒）' },
      { key: 'FEATURE_SPLIT_ORDER', value: 'true', scope: 'order-service', secret: false, note: '门店自提订单拆分开关' },
      { key: 'application.yaml', value: 'server:\n  port: 8080\nmanagement:\n  endpoints:\n    web:\n      exposure:\n        include: health,info', scope: 'order-service', secret: false, mount: 'file', path: '/etc/app/conf', note: '外置配置文件，按文件挂载到容器' }
    );
    if (comps.includes('channel-adapter')) seed.push(
      { key: 'PAY_SIGN_KEY', value: 'sk_live_9f3c7a2b', scope: 'channel-adapter', secret: true, note: '渠道签名密钥' }
    );
    const idOf = new Map(app.components.map(c => [c.name, c.id]));
    DB.config[app.id] = seed.map((c, i) => Object.assign(
      { id: `cfg-${app.id}-${i}`, mount: 'env', updated: app.updated || nowStamp() },
      c, { scope: c.scope === 'all' ? 'all' : (idOf.get(c.scope) || c.scope) }));
    saveSnapshot();
  }
  return DB.config[app.id];
}
/* 某个组件实际生效的配置：全局 + 组件作用域 */
function configOf(app, key) {
  return ensureConfig(app).filter(c => scopeMatches(app, c.scope, key) || c.scope === 'all');
}
function cfgFiltered(app) {
  const q = (S.cfgQ || '').trim().toLowerCase();
  return ensureConfig(app).filter(c => {
    if (S.cfgScope !== 'all-app' && !scopeMatches(app, c.scope, S.cfgScope)) return false;
    if (S.cfgType === 'secret' && !c.secret) return false;
    if (S.cfgType === 'plain' && c.secret) return false;
    if (!q) return true;
    return c.key.toLowerCase().includes(q) || String(c.value).toLowerCase().includes(q) || String(c.note || '').toLowerCase().includes(q);
  });
}
/* 多行值在表格里只显示首行，完整内容放在 title */
function ioValPreview(v) {
  const t = String(v == null ? '' : v);
  const first = t.split('\n')[0];
  const clipped = first.length > 46 ? first.slice(0, 46) : first;
  return esc(clipped) + (t.includes('\n') || first.length > 46 ? '<span class="muted"> …</span>' : '');
}
function cfgUsers(app, scope) {
  return app.components.filter(c => scope === 'all' || c.id === scope || c.name === scope)
    .reduce((s, c) => s + c.workloads.length, 0);
}
function cfgRows(app) {
  const list = cfgFiltered(app);
  if (!list.length) {
    return `<tr><td colspan="7"><div class="empty" style="padding:30px 16px"><h3>没有匹配的配置项</h3><p>换个作用域或类型，或者新增一条。</p></div></td></tr>`;
  }
  return list.map(c => `<tr>
    <td class="name mono" style="font-size:11.5px">${esc(c.key)}${c.note ? `<div class="sub" style="font-weight:400">${esc(c.note)}</div>` : ''}</td>
    <td class="mono" style="font-size:11px" title="${esc(String(c.value).slice(0, 120))}">
      ${c.secret && !S.cfgShown[c.id]
        ? `<span style="letter-spacing:2px;color:var(--text-3)">••••••••</span>
           <button class="btn sm ghost" style="height:18px;padding:0 5px;margin-left:4px" onclick="cfgReveal('${app.id}','${c.id}')">显示</button>`
        : ioValPreview(c.value)}
    </td>
    <td>${c.scope === 'all' ? '<span class="chip">全部组件</span>' : `<span class="chip blue">${esc(compLabel(app, c.scope))}</span>`}
      <div class="sub">${cfgUsers(app, c.scope)} 个工作负载</div></td>
    <td>${c.mount === 'file'
      ? `<span class="badge info">文件挂载</span><div class="sub mono">${esc(c.path || '/etc/app/conf')}</div>`
      : `<span class="badge outline">环境变量</span>`}</td>
    <td>${c.secret ? '<span class="badge purple">密钥</span>' : '<span class="badge muted">明文</span>'}</td>
    <td class="tiny muted">${esc(c.updated)}</td>
    <td class="right">
      <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
        <button class="btn sm" onclick="cfgEdit('${app.id}','${c.id}')">编辑</button>
        <button class="mini-act danger" title="删除" onclick="cfgDelete('${app.id}','${c.id}')">${icon('archive', '', 13)}</button>
      </div>
    </td>
  </tr>`).join('');
}
function appConfigView(app) {
  const list = ensureConfig(app);
  const shown = cfgFiltered(app).length;
  return `
  <div class="card" style="box-shadow:none">
    <div class="toolbar">
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}
        <input id="cfg-q" placeholder="Key / 值 / 说明" value="${esc(S.cfgQ)}" oninput="cfgSet('q', this.value)" />
      </div>
      <select class="input" style="width:170px;height:30px;padding:0 8px;font-size:12px" onchange="cfgSet('scope', this.value)">
        <option value="all-app"${S.cfgScope === 'all-app' ? ' selected' : ''}>全部作用域</option>
        <option value="all"${S.cfgScope === 'all' ? ' selected' : ''}>全部组件</option>
        ${app.components.map(c => `<option value="${esc(c.id)}"${S.cfgScope === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      ${[['all', '全部'], ['plain', '明文'], ['secret', '密钥']].map(([k, n]) =>
        `<button class="filter-pill ${S.cfgType === k ? 'on' : ''}" onclick="cfgSet('type','${k}')">${n}</button>`).join('')}
      <div class="grow">
        <span class="tiny muted" style="align-self:center" id="cfg-count">${shown} / ${list.length} 项</span>
        <button class="btn sm primary" onclick="cfgNew('${app.id}')">${icon('plus', '', 12)}新增配置</button>
      </div>
    </div>
    <table class="table">
      <thead><tr><th>Key</th><th>值</th><th>生效范围</th><th>挂载方式</th><th>类型</th><th>更新</th><th class="right">操作</th></tr></thead>
      <tbody id="cfg-rows">${cfgRows(app)}</tbody>
    </table>
    <div class="cfg-foot">
      环境变量方式按作用域注入 env；文件方式按同一目录合并成 ConfigMap / Secret 卷挂载，密钥始终以 secretKeyRef 或 secret 卷引用，不写进 Deployment 明文。
    </div>
  </div>`;
}
function cfgMountChange() {
  const mask = document.querySelector('.modal-mask:last-child');
  if (!mask) return;
  const sel = mask.querySelector('[data-k=mount]');
  const box = mask.querySelector('#cfg-path');
  if (sel && box) box.style.display = sel.value === 'file' ? '' : 'none';
}
function cfgSet(k, v) {
  S['cfg' + k[0].toUpperCase() + k.slice(1)] = v;
  const appId = currentAppId();
  const app = DB.apps.find(a => a.id === appId);
  const rows = $('#cfg-rows');
  if (app && rows) rows.innerHTML = cfgRows(app);
  const cnt = $('#cfg-count');
  if (app && cnt) cnt.textContent = `${cfgFiltered(app).length} / ${ensureConfig(app).length} 项`;
  if (k === 'type') {
    document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('on'));
    const btn = [...document.querySelectorAll('.filter-pill')].find(b => b.textContent.trim() === ({ all: '全部', plain: '明文', secret: '密钥' })[v]);
    if (btn) btn.classList.add('on');
  }
}
function cfgReveal(appId, id) {
  S.cfgShown[id] = !S.cfgShown[id];
  const app = DB.apps.find(a => a.id === appId);
  const rows = $('#cfg-rows');
  if (app && rows) rows.innerHTML = cfgRows(app);
}
function cfgNew(appId) { cfgModal(appId, null); }
function cfgEdit(appId, id) { cfgModal(appId, id); }
function cfgModal(appId, id) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  const list = ensureConfig(app);
  const item = id ? list.find(c => c.id === id) : null;
  const scopes = [['all', '全部组件'], ...app.components.map(c => [c.id, c.name])];
  formModal({
    title: item ? `编辑配置 · ${item.key}` : '新增配置项',
    desc: 'Key 在同一作用域内唯一；密钥类型的值不会明文下发到工作负载。',
    okText: item ? '保存' : '新增',
    body: `
      ${fField('Key', fInput('key', item ? item.key : '', 'ORDER_TIMEOUT_MS'), '环境变量：大写字母、数字与下划线；文件挂载：文件名如 application.yaml', true)}
      ${fField('值', fArea('value', item ? item.value : '', item && item.secret ? '密钥值' : '配置值，支持多行'), '按原样写入；文件挂载时即文件内容')}
      <div class="form-row">
        ${fField('生效范围', fSelect('scope', scopes, item ? item.scope : 'all'))}
        ${fField('挂载方式', fSelect('mount', [['env', '环境变量'], ['file', '文件挂载']], item ? (item.mount || 'env') : 'env', ' onchange="cfgMountChange()"'))}
      </div>
      <div id="cfg-path" style="${item && item.mount === 'file' ? '' : 'display:none'}">
        ${fField('挂载目录', fInput('path', item ? item.path || '/etc/app/conf' : '/etc/app/conf', '/etc/app/conf'), '同一目录下的配置项合并成一个卷挂载')}
      </div>
      ${fField('说明', fInput('note', item ? item.note || '' : '', '可选'))}
      ${fCheck('secret', '作为密钥下发', item ? !!item.secret : false, '以 secretKeyRef 或 secret 卷引用，不写进 Deployment 明文')}`,
    onSubmit: st => {
      const isFile = st.mount === 'file';
      if (isFile ? !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(st.key) : !/^[A-Z][A-Z0-9_]*$/.test(st.key)) {
        return isFile ? '文件名只能包含字母、数字、点、下划线与连字符' : 'Key 只能是大写字母、数字与下划线，并以字母开头';
      }
      if (!String(st.value || '').trim()) return '请填写配置值';
      if (isFile && !String(st.path || '').startsWith('/')) return '挂载目录需以 / 开头';
      if (list.some(c => c.key === st.key && c.scope === st.scope && c.id !== id)) return `作用域 ${compLabel(app, st.scope)} 下已存在 ${st.key}`;
      const patch = {
        key: st.key, value: st.value, scope: st.scope, secret: st.secret,
        mount: st.mount, path: isFile ? st.path : '', note: st.note, updated: nowStamp()
      };
      if (item) {
        Object.assign(item, patch);
      } else {
        list.unshift(Object.assign({ id: `cfg-${appId}-${Date.now().toString(36)}` }, patch));
      }
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: '', tx: `配置 <b>${esc(st.key)}</b> ${item ? '已更新' : '已新增'}（作用域 ${esc(st.scope === 'all' ? '全部组件' : st.scope)}）` });
      saveSnapshot();
      route();
      toast(item ? '配置已保存' : '配置已新增', 'ok');
    }
  });
}
function cfgDelete(appId, id) {
  const app = DB.apps.find(a => a.id === appId);
  const item = app && ensureConfig(app).find(c => c.id === id);
  if (!item) return;
  openModal({
    title: '删除配置项',
    desc: `${item.key} · 作用域 ${item.scope === 'all' ? '全部组件' : item.scope}`,
    danger: true,
    okText: '确认删除',
    body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">删除后，引用该配置的工作负载下次发布时将不再注入此环境变量。</p>`,
    onOk: () => {
      DB.config[appId] = ensureConfig(app).filter(c => c.id !== id);
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'warn', tx: `配置 <b>${esc(item.key)}</b> 已删除` });
      saveSnapshot();
      route();
      toast('配置已删除', 'ok');
    }
  });
}

/* ==========================================================
   发布：申请 / 审批 / 回滚 / 记录
   ========================================================== */
DB.releases = DB.releases || [];
const REL_BADGE = { '待审批': 'warn', '发布中': 'info', '已发布': 'ok', '已回滚': 'muted', '失败': 'bad' };
function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function bumpVersion(v, delta) {
  const m = String(v || 'v1.0.0').match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return String(v || 'v1.0.0');
  let a = +m[1], b = +m[2], c = +m[3] + delta;
  if (c < 0) { c = 9; b = Math.max(0, b - 1); }
  return `v${a}.${b}.${c}`;
}
function relBadge(s) { return `<span class="badge ${REL_BADGE[s] || 'muted'}">${esc(s)}</span>`; }

/* 首次访问某个应用的发布记录时，用当前组件版本补一版基线 */
function ensureReleases(app) {
  if (!app) return [];
  let list = DB.releases.filter(r => r.appId === app.id);
  if (list.length) return list;
  const base = Date.now() - 86400000 * 2;
  app.components.forEach((c, i) => {
    DB.releases.push({
      id: `rel-${app.id}-${i}`,
      appId: app.id, comp: c.name, version: c.version, prev: bumpVersion(c.version, -1),
      env: '生产环境', strategy: '滚动更新', status: '已发布',
      by: app.owner || DB.user.name, approver: app.owner || DB.user.name,
      at: fmtDateTime(base - i * 86400000), ts: base - i * 86400000, note: '常规版本更新'
    });
  });
  saveSnapshot();
  return DB.releases.filter(r => r.appId === app.id);
}
function releaseNotes(rec, app) {
  return `<div class="rel-sum">
    <div><span class="tiny muted">组件</span><div class="mono" style="font-size:12px;font-weight:600">${esc(rec.comp)}</div></div>
    <div><span class="tiny muted">版本</span><div class="mono" style="font-size:12px;font-weight:600">${esc(rec.version)}</div></div>
    <div><span class="tiny muted">目标环境</span><div style="font-size:12px;font-weight:600">${esc(rec.env)}</div></div>
    <div><span class="tiny muted">策略</span><div style="font-size:12px">${esc(rec.strategy)}</div></div>
  </div>
  <div class="tiny muted" style="margin-top:8px">应用 <b style="color:var(--text-2)">${esc(app.name)}</b> · 发起人 ${esc(rec.by || DB.user.name)}</div>`;
}

function releaseApp(appId, compName) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  if (!app.components.length) return toast('该应用还没有组件，请先在「组件与工作负载」中创建', 'warn');
  const comps = app.components.map(c => c.name);
  const comp = compName && comps.includes(compName) ? compName : comps[0];
  const c0 = findComp(app, comp);
  const envNames = DB.envs.map(e => e.name);
  formModal({
    title: `发布「${app.name}」`,
    desc: '按策略更新该组件下的工作负载；生产环境默认需要人工审批。',
    okText: '提交发布',
    body: `
      <div class="form-row">
        ${fField('组件', fSelect('comp', comps, comp))}
        ${fField('目标环境', fSelect('env', envNames, '生产环境'))}
      </div>
      <div class="form-row">
        ${fField('版本', fInput('version', c0 ? c0.version : 'v1.0.0'), '默认取组件当前版本')}
        ${fField('发布策略', fSelect('strategy', ['滚动更新', '灰度 10% → 50% → 100%', '蓝绿切换'], '灰度 10% → 50% → 100%'))}
      </div>
      ${fCheck('approval', '需要人工审批', true, '单环境部署：生产发布一律需审批，P0 应用需两人', 'approvalBox')}
      <div class="float-fields" id="approvalBox">
        ${fField('审批人', fInput('approver', app.owner || DB.user.name), '默认应用负责人')}
      </div>
      ${fField('变更说明', `<textarea class="input" data-k="note" rows="2" placeholder="例如：支持门店自提订单拆分"></textarea>`)}
      <div class="warn-box" style="margin-top:12px">
        本次将影响 <b>${c0 ? c0.workloads.length : 0}</b> 个工作负载、<b>${c0 ? c0.workloads.reduce((s, w) => s + (w.kind === 'CronJob' ? 0 : (w.replicas || 0)), 0) : 0}</b> 个实例。
      </div>`,
    onSubmit: st => {
      if (!st.version) return '请填写发布版本';
      if (st.approval && !st.approver) return '请填写审批人，或关闭「需要人工审批」';
      const target = findComp(app, st.comp);
      if (!target || !target.workloads.length) return `组件「${st.comp}」还没有工作负载，发布不会产生任何变更`;
      const chosen = findComp(app, st.comp) || c0;
      const rec = {
        id: `rel-${Date.now().toString(36)}`,
        appId: app.id, comp: st.comp, version: st.version,
        prev: (chosen && chosen.version) || '',
        env: st.env, strategy: st.strategy,
        status: st.approval ? '待审批' : '发布中',
        by: DB.user.name, approver: st.approval ? st.approver : '自动',
        at: fmtDateTime(Date.now()), ts: Date.now(), note: st.note || '',
        configSnapshot: configOf(app, st.comp).map(c => ({
          key: c.key, scope: c.scope, secret: !!c.secret, value: c.secret ? '••••••' : c.value
        }))
      };
      DB.releases.unshift(rec);
      app.events.unshift({
        t: clockNow(), k: st.approval ? 'warn' : 'ok',
        tx: `组件 <b>${esc(rec.comp)}</b> 发起 <b>${esc(rec.version)}</b> 发布至 ${esc(rec.env)}${st.approval ? '，等待审批' : ''}`
      });
      saveSnapshot();
      if (st.approval) toast('发布已提交，等待审批', 'ok');
      else finishRelease(rec, 1600);
      if (location.hash.includes('/apps/')) route();
    }
  });
}

/* 发布完成：推进状态、更新组件版本、写事件 */
function finishRelease(rec, delay) {
  const done = () => {
    rec.status = '已发布';
    const app = DB.apps.find(a => a.id === rec.appId);
    const comp = app && findComp(app, rec.comp);
    if (comp) comp.version = rec.version;
    if (app) {
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'ok', tx: `组件 <b>${esc(rec.comp)}</b> 发布完成，当前版本 ${esc(rec.version)}` });
      app.events = app.events.slice(0, 30);
    }
    saveSnapshot();
    if (location.hash.includes(rec.appId)) route();
    toast(`发布完成：${rec.comp} ${rec.version}`, 'ok');
  };
  if (delay) setTimeout(done, delay); else done();
}

function approveRelease(id) {
  const rec = DB.releases.find(r => r.id === id);
  if (!rec) return;
  const app = DB.apps.find(a => a.id === rec.appId);
  formModal({
    title: '审批发布',
    desc: '通过后按策略推进灰度；驳回将终止本次发布。',
    okText: '通过并发布',
    body: `${releaseNotes(rec, app)}
      <div class="divider"></div>
      <dl class="kv" style="grid-template-columns:88px 1fr">
        <dt>审批人</dt><dd>${esc(rec.approver)}</dd>
        <dt>变更说明</dt><dd style="color:var(--text-2)">${esc(rec.note || '未填写')}</dd>
      </dl>
      ${fField('审批意见', `<input class="input" data-k="comment" placeholder="可选，例如：回归通过，同意发布" />`)}`,
    onSubmit: st => {
      rec.status = '发布中';
      rec.approver = rec.approver || DB.user.name;
      if (app) app.events.unshift({ t: clockNow(), k: 'ok', tx: `发布审批通过：<b>${esc(rec.comp)}</b> ${esc(rec.version)}${st.comment ? `（${esc(st.comment)}）` : ''}` });
      saveSnapshot();
      finishRelease(rec, 1800);
      route();
    }
  });
}

function rollbackRelease(id) {
  const rec = DB.releases.find(r => r.id === id);
  if (!rec) return;
  const app = DB.apps.find(a => a.id === rec.appId);
  formModal({
    title: '回滚发布',
    desc: '回滚会把组件版本退回上一版，并按相同策略重新下发。',
    okText: '确认回滚',
    danger: true,
    body: `${releaseNotes(rec, app)}
      <div class="divider"></div>
      <dl class="kv" style="grid-template-columns:88px 1fr">
        <dt>当前版本</dt><dd class="mono">${esc(rec.version)}</dd>
        <dt>回滚到</dt><dd class="mono" style="color:var(--danger);font-weight:600">${esc(rec.prev || '—')}</dd>
      </dl>
      <div class="danger-box" style="margin-top:12px">回滚会替换正在运行的实例，期间可能出现短暂流量抖动，请确认已停止相关变更。</div>`,
    onSubmit: () => {
      if (!rec.prev) return '该记录没有可回滚的历史版本';
      rec.status = '已回滚';
      const comp = app && findComp(app, rec.comp);
      if (comp) comp.version = rec.prev;
      if (app) {
        app.updated = nowStamp();
        app.events.unshift({ t: clockNow(), k: 'warn', tx: `组件 <b>${esc(rec.comp)}</b> 已回滚至 <b>${esc(rec.prev)}</b>` });
      }
      saveSnapshot();
      route();
      toast(`已回滚至 ${rec.prev}`, 'ok');
    }
  });
}

function cfgSnapDiff(prev, cur) {
  if (!cur) return null;
  const key = c => `${c.scope}:${c.key}`;
  if (!prev) return { total: cur.length, added: 0, changed: 0, removed: 0, first: true };
  const m = new Map(prev.map(c => [key(c), c.value]));
  let added = 0, changed = 0, removed = 0;
  cur.forEach(c => { const k = key(c); if (!m.has(k)) added++; else if (m.get(k) !== c.value) changed++; });
  prev.forEach(c => { if (!cur.some(x => key(x) === key(c))) removed++; });
  return { total: cur.length, added, changed, removed };
}
function componentVersions(appId, compName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  if (!comp) return;
  const list = DB.releases.filter(r => r.appId === appId && r.comp === compName)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  formModal({
    title: `版本历史 · ${compName}`,
    desc: '每次发布对应一个版本；带配置快照的可与上一版对比变更数。',
    okText: '关闭',
    hideCancel: true,
    wide: true,
    body: list.length ? `<div class="ver-list">${list.map((r, i) => {
      const d = cfgSnapDiff(list[i + 1] && list[i + 1].configSnapshot, r.configSnapshot);
      const delta = d && !d.first && (d.added || d.changed || d.removed);
      return `<div class="ver-item">
        <div class="ver-h">
          <span class="ver-tag mono">${esc(r.version)}</span>
          ${relBadge(r.status)}
          <span class="tiny muted">${esc(r.env)} · ${esc(r.at)} · ${esc(r.by)}</span>
        </div>
        <div class="ver-body">
          <span class="tiny muted">${esc(r.strategy)}</span>
          ${r.note ? `<span class="tiny muted">· ${esc(r.note)}</span>` : ''}
          ${d
            ? `<span class="chip" style="font-size:10px">配置 ${d.total} 项${d.first ? '（首个快照）' : delta ? `（+${d.added} ~${d.changed} -${d.removed}）` : ' · 与上一版一致'}</span>`
            : '<span class="tiny muted">· 该版本无配置快照</span>'}
        </div>
      </div>`;
    }).join('')}</div>` : `<div class="empty" style="padding:26px"><p style="margin:0">该组件还没有发布记录</p></div>`
  });
}

function appReleasesView(app) {
  const list = ensureReleases(app).sort((a, b) => (b.ts || 0) - (a.ts || 0) || (a.at < b.at ? 1 : -1));
  const pending = list.filter(r => r.status === '待审批').length;
  const okRate = list.length ? Math.round(list.filter(r => r.status === '已发布').length / list.length * 100) : 0;
  const month = list.filter(r => r.at.slice(0, 7) === fmtDateTime(Date.now()).slice(0, 7)).length;
  return `
  <div class="toolbar" style="border:1px solid var(--border);border-radius:8px;margin-bottom:12px">
    <span class="badge info">${list.length} 次发布</span>
    <span class="tiny muted">本月 <b style="color:var(--text)">${month}</b> 次 · 成功率 <b style="color:var(--success)">${okRate}%</b>${pending ? ` · <span style="color:var(--warning)">${pending} 条待审批</span>` : ''}</span>
    <div class="grow"><button class="btn sm primary" onclick="releaseApp('${app.id}')">${icon('send', '', 12)}发起发布</button></div>
  </div>
  <table class="table">
    <thead><tr><th>状态</th><th>版本</th><th>组件</th><th>环境</th><th>策略</th><th>发起人</th><th>审批人</th><th>时间</th><th class="right">操作</th></tr></thead>
    <tbody>${list.map(r => `<tr>
      <td>${relBadge(r.status)}</td>
      <td class="name mono">${esc(r.version)}${r.prev ? `<div class="sub mono">← ${esc(r.prev)}</div>` : ''}</td>
      <td class="mono" style="font-size:11.5px">${esc(r.comp)}</td>
      <td>${esc(r.env)}</td>
      <td class="tiny">${esc(r.strategy)}</td>
      <td>${esc(r.by)}</td>
      <td>${esc(r.approver)}</td>
      <td class="mono tiny">${esc(r.at)}</td>
      <td class="right">${r.status === '待审批'
        ? `<button class="btn sm primary" onclick="approveRelease('${r.id}')">审批</button>`
        : r.status === '已发布' && r.prev
          ? `<button class="btn sm" onclick="rollbackRelease('${r.id}')">回滚</button>`
          : '<span class="tiny muted">—</span>'}</td>
    </tr>`).join('')}</tbody>
  </table>
  ${list.length ? '' : `<div class="empty" style="padding:30px"><h3>还没有发布记录</h3><p>推进流水线或直接发起发布后，这里会记录每次变更。</p></div>`}`;
}

/* ---------- 流水线列表 ---------- */
/* 导出工作负载清单为 CSV（UTF-8 BOM，Excel 直接打开不乱码） */
function csvCell(v) {
  const t = String(v == null ? '' : v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function exportWorkloadsCsv() {
  const rows = DB.apps.flatMap(a => a.components.flatMap(c => c.workloads.map(w => ({ app: a.name, comp: c.name, w }))));
  if (!rows.length) return toast('没有可导出的工作负载', 'warn');
  const head = ['应用', '组件', '工作负载', '类型', '期望副本', '就绪副本', '状态', '调度位置', '集群', '镜像', 'CPU', '内存', '重启', '运行时长'];
  const lines = [head.join(',')];
  rows.forEach(({ app, comp, w }) => lines.push([
    app, comp, w.name, w.kind, w.replicas, w.readyN, w.status, w.where, w.cluster, w.image, w.cpu, w.mem, w.restarts, w.age
  ].map(csvCell).join(',')));
  downloadFile(`workloads-${fmtDateTime(Date.now()).replace(/[: ]/g, '-')}.csv`, '\ufeff' + lines.join('\n'), 'text/csv;charset=utf-8');
  toast(`已导出 ${rows.length} 个工作负载`, 'ok');
}

function viewCicd() {
  setCrumb('流水线');
  const total = DB.pipelines.length;
  return `
  <div class="page-head">
    <div><div class="ttl">持续交付</div>
      <div class="sub">流水线绑定「应用 - 组件」，构建产物推送至制品仓库后按环境策略发布。</div></div>
    <div class="acts">
      <button class="btn" onclick="location.hash='/artifacts'">${icon('archive', '', 14)}制品仓库</button>
      <button class="btn primary" onclick="newPipeline()">${icon('plus', '', 14)}新建流水线</button>
    </div>
  </div>

  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="lab">流水线</div><div class="val">${total}</div><div class="foot">覆盖 ${DB.apps.filter(a => a.pipelines.length).length} 个应用</div></div>
    <div class="stat"><div class="lab">今日运行</div><div class="val">14</div><div class="foot"><span class="up">13</span> 成功 · <span class="down">1</span> 失败</div></div>
    <div class="stat"><div class="lab">平均成功率</div><div class="val">96.3<small>%</small></div><div class="foot">近 7 日</div></div>
    <div class="stat"><div class="lab">平均时长</div><div class="val">6<small>m12s</small></div><div class="foot">较上周 <span class="up">-42s</span></div></div>
  </div>

  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索流水线 / 应用 / 组件" oninput="listFilter('#pipeTable', this.value)" /></div>
      <button class="filter-pill on" onclick="listStatus('#pipeTable','all',this)">全部</button>
      <button class="filter-pill" onclick="listStatus('#pipeTable','运行中',this)">运行中</button>
      <button class="filter-pill" onclick="listStatus('#pipeTable','失败',this)">失败</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">自动刷新 · 30s</span></div>
    </div>
    <table class="table" id="pipeTable">
      <thead><tr><th>流水线</th><th>应用 / 组件</th><th>触发</th><th>分支</th><th>最近运行</th><th>状态</th><th>成功率</th><th class="right">操作</th></tr></thead>
      <tbody>${DB.pipelines.map(p => `
        <tr class="clickable" data-q="${esc(p.name)} ${esc(p.app)} ${esc(p.comp)} ${esc(p.branch)}" data-status="${esc(p.status)}" onclick="location.hash='/cicd/${p.id}'">
          <td class="name">${esc(p.name)}</td>
          <td>${esc(p.app)}<div class="sub">${esc(p.comp)}</div></td>
          <td><span class="chip">${esc(p.trigger)}</span></td>
          <td class="mono" style="font-size:11px">${esc(p.branch)}</td>
          <td>${p.last}</td>
          <td>${pbadge(p.status)}</td>
          <td><div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:52px"><div class="${p.success > 95 ? 'ok' : 'warn'}" style="width:${p.success}%"></div></div><span class="num">${p.success}%</span></div></td>
          <td class="right"><button class="btn sm" onclick="event.stopPropagation();rerunPipeline('${p.id}')">运行</button></td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ---------- 流水线详情 ---------- */
/* ---------- 流水线详情：运行、审批、灰度 ---------- */
function latestRunNo(p) {
  const h = p.history && p.history[0];
  return h ? +String(h.no).replace('#', '') : (p.runs || 0);
}
function durStr(r) {
  const s = 8 + Math.floor(r() * 150);
  return s >= 60 ? `${Math.floor(s / 60)}m${pad2(s % 60)}s` : `${s}s`;
}
function genRun(p, h) {
  const r = mulberry32(wHash(p.id + h.no));
  const failed = h.status === '失败';
  const failAt = failed ? 2 + Math.floor(r() * 3) : -1;
  const stages = p.stages.map((s, i) => {
    if (failAt >= 0) {
      if (i < failAt) return { n: s.n, s: 'done', d: durStr(r) };
      if (i === failAt) return { n: s.n, s: 'fail', d: durStr(r) };
      return { n: s.n, s: 'skip', d: '跳过' };
    }
    return { n: s.n, s: 'done', d: durStr(r) };
  });
  const logs = [];
  const t0 = 9 * 60 + Math.floor(r() * 400);
  const stampOf = k => `${pad2(Math.floor((t0 + k) / 60) % 24)}:${pad2((t0 + k) % 60)}`;
  let clock = 0;
  logs.push([stampOf(clock), 'k', `#${String(h.no).replace('#', '')} ${p.comp}  pipeline start  trigger=${p.trigger}  branch=${h.branch}`]);
  logs.push([stampOf(clock), 't', `commit ${h.commit}  by ${h.by}`]);
  stages.forEach((s, i) => {
    clock += 2;
    const key = ['checkout', 'build', 'test', 'push', 'deploy', 'regress', 'approve', 'canary'][i] || 'stage';
    if (s.s === 'skip') return;
    logs.push([stampOf(clock), 'k', `stage: ${key}`]);
    if (key === 'build') logs.push([stampOf(clock), 't', `Step 6/14 : RUN mvn -B clean package -DskipTests`]);
    if (key === 'test') logs.push([stampOf(clock), 't', `mvn test  (312 cases)`]);
    clock += 20;
    if (s.s === 'fail') {
      logs.push([stampOf(clock), 'err', `stage ${key} ✗ ${s.d}  exitCode=1`]);
      logs.push([stampOf(clock), 'err', key === 'test' ? '2 tests failed: OrderSplitTest#shouldSplitByStore' : 'ERROR: failed to solve: process did not complete successfully']);
    } else {
      logs.push([stampOf(clock), 'ok', `stage ${key} ✓ ${s.d}`]);
    }
  });
  return {
    no: +String(h.no).replace('#', ''), isLatest: false, status: h.status,
    stages, logs, commit: h.commit, by: h.by, dur: h.dur, time: h.time, branch: h.branch
  };
}
function runFor(p, no) {
  const hist = (p.history || []).find(h => +String(h.no).replace('#', '') === +no);
  const latest = latestRunNo(p);
  if (+no === latest || !hist) {
    const h0 = p.history && p.history[0] || {};
    return {
      no: latest, isLatest: true, status: p.status,
      stages: p.stages, logs: p.logs,
      commit: h0.commit || '—', by: h0.by || DB.user.name, dur: h0.dur || '—',
      time: h0.time || '刚刚', branch: h0.branch || p.branch
    };
  }
  return genRun(p, hist);
}
function logsByStage(raw) {
  const blocks = [];
  let pending = [];
  for (const l of raw) {
    const m = String(l[2]).match(/stage:\s*([a-z]+)/i);
    if (m) {
      const blk = { key: m[1], lines: [] };
      // 首个阶段块带上阶段开始前的启动日志，避免块下标与阶段下标错位
      if (!blocks.length && pending.length) { blk.lines.push(...pending); pending = []; }
      blocks.push(blk);
    }
    if (!blocks.length) { pending.push(l); continue; }
    blocks[blocks.length - 1].lines.push(l);
  }
  if (!blocks.length) blocks.push({ key: 'start', lines: pending });
  return blocks;
}
const STAGE_ZH = {
  start: '启动', checkout: '代码检出', build: '编译构建', test: '单元测试', push: '镜像推送',
  deploy: '部署', regress: '自动化回归', approve: '人工审批', canary: '灰度发布',
  verify: '模型校验', compile: '交叉编译', sign: '签名校验', edge: '边缘灰度', full: '全量分发', health: '健康巡检'
};
function pipeTabSet(k) { S.pipeStage = k; route(); }

function viewPipeline(id, runNo) {
  const p = DB.pipelines.find(x => x.id === id) || DB.pipelines[0];
  const latest = latestRunNo(p);
  const no = runNo ? +runNo : latest;
  const run = runFor(p, no);
  setCrumb(p.name);

  const runKey = `${p.id}/${run.no}`;
  if (S.pipeRunKey !== runKey) { S.pipeRunKey = runKey; S.pipeStage = -1; }

  const blocks = logsByStage(run.logs);
  const shown = S.pipeStage >= 0 && blocks[S.pipeStage] ? blocks[S.pipeStage].lines : run.logs;

  const approveIdx = run.stages.findIndex(s => s.n === '人工审批');
  const pendingApproval = run.isLatest && approveIdx >= 0 && run.stages[approveIdx].s === 'wait'
    && run.stages.slice(0, approveIdx).every(s => s.s === 'done' || s.s === 'skip');
  const canaryIdx = run.stages.findIndex(s => s.n === '灰度发布');
  const canaryRunning = run.isLatest && canaryIdx >= 0 && run.stages[canaryIdx].s === 'run';
  const app = DB.apps.find(a => a.id === p.appId);

  return `
  <div class="page-head">
    <div>
      <div style="display:flex;align-items:center;gap:9px">
        <span class="link tiny" onclick="location.hash='/cicd'">流水线</span>
        <span class="muted">/</span>
        <span class="ttl" style="font-size:16px">${esc(p.name)}</span>
        ${pbadge(run.status)}
        ${run.isLatest ? '<span class="badge muted">最新</span>' : `<span class="badge muted">历史运行 #${run.no}</span>`}
      </div>
      <div class="sub">${esc(p.app)} · 组件 <b>${esc(p.comp)}</b> · 触发 <b>${esc(p.trigger)}</b> · 分支 <span class="mono">${esc(run.branch)}</span>
        · 提交 <span class="mono">${esc(run.commit)}</span>${run.isLatest ? '' : ` · <span class="link" onclick="location.hash='/cicd/${p.id}'">回到最新</span>`}</div>
    </div>
    <div class="acts">
      ${pendingApproval ? `<button class="btn" onclick="rejectPipeline('${p.id}')">驳回</button>
        <button class="btn primary" onclick="approvePipeline('${p.id}')">${icon('shield', '', 14)}通过审批</button>` : ''}
      ${canaryRunning ? `<button class="btn primary" onclick="promoteCanary('${p.id}')">${icon('send', '', 14)}推进灰度</button>` : ''}
      <button class="btn" onclick="rerunPipeline('${p.id}')">${icon('refresh', '', 14)}重新运行</button>
    </div>
  </div>

  ${pendingApproval ? `
  <div class="approve-banner">
    <div class="ic">${icon('shield', '', 18)}</div>
    <div class="tx">
      <b>等待发布审批</b>
      <p>构建与回归已通过，等待 <b>${esc(app ? app.owner : '应用负责人')}</b> 审批后进入 ${esc(p.env)} 灰度发布；驳回将终止本次变更。</p>
    </div>
    <span class="badge warn">待审批</span>
  </div>` : ''}
  ${canaryRunning ? `
  <div class="approve-banner ok">
    <div class="ic">${icon('send', '', 18)}</div>
    <div class="tx">
      <b>灰度发布进行中 · 当前权重 10%</b>
      <p>观察窗口 5 分钟，错误率 0.00%、P99 ${(38 + run.no % 12)}ms；确认无异常后可推进至 100%。</p>
    </div>
    <span class="badge info">灰度中</span>
  </div>` : ''}

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="t">阶段流程</div>
      <div class="r tiny muted">运行 #${run.no} · ${esc(run.time)} 开始 · 耗时 ${esc(run.dur)}</div></div>
    <div class="card-body">
      <div class="stage-flow">
        ${run.stages.map((s, i) => `
          <div class="stage ${s.s} ${S.pipeStage === i ? 'sel' : ''}" ${s.s === 'skip' ? '' : `onclick="pipeTabSet(${i})" title="查看该阶段日志"`}>
            <div class="box">
              <div class="h"><span class="stg-dot ${s.s}"></span><span class="nm">${esc(s.n)}</span></div>
              <div class="du">${s.s === 'run' ? '<span style="color:var(--primary)">执行中 ' + esc(s.d) + '</span>' : esc(s.d)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="grid g21">
    <div class="card logcard">
      <div class="card-head"><div class="t">运行日志</div>
        <div class="r">
          <span class="chip">#${run.no}</span>
          <button class="btn sm ghost" onclick="toast('日志已复制')">复制</button>
        </div>
      </div>
      <div class="log-filter">
        <button class="filter-pill ${S.pipeStage < 0 ? 'on' : ''}" onclick="pipeTabSet(-1)">全部</button>
        ${blocks.map((b, i) => `<button class="filter-pill ${S.pipeStage === i ? 'on' : ''}" onclick="pipeTabSet(${i})">${esc(STAGE_ZH[b.key] || b.key)}</button>`).join('')}
      </div>
      <div class="card-body" style="padding:12px">
        <div class="logbox">
          ${shown.map(([t, k, m]) => `<div><span class="t">${t}</span>  <span class="${k}">${esc(m)}</span></div>`).join('')}
          ${run.status === '运行中' && S.pipeStage < 0 ? '<div><span class="t">--:--:--</span>  <span class="k">▌</span></div>' : ''}
        </div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card">
        <div class="card-head"><div class="t">提交信息</div></div>
        <div class="card-body">
          <dl class="kv" style="grid-template-columns:74px 1fr">
            <dt>提交</dt><dd class="mono">${esc(run.commit)}</dd>
            <dt>分支</dt><dd class="mono">${esc(run.branch)}</dd>
            <dt>触发人</dt><dd>${esc(run.by)}</dd>
            <dt>耗时</dt><dd class="mono">${esc(run.dur)}</dd>
          </dl>
          <div class="divider"></div>
          <div class="tiny muted">制品</div>
          <div class="mono" style="font-size:10.5px;word-break:break-all;margin-top:3px">hub.corp.io/retail/${esc(p.comp === 'order-service' ? 'order-service' : p.comp)}:${esc((app && findComp(app, p.comp) || {}).version || 'v2.4.1')}</div>
          <div class="mono" style="font-size:10.5px;color:var(--text-3);margin-top:2px">sha256:${(wHash(p.id + run.no).toString(16) + '9f3c1a7bd2e84560').slice(0, 16)}…</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t">质量门禁</div></div>
        <div class="card-body">
          ${[['单元测试通过率', run.status === '失败' ? '99.4%' : '100%', run.status !== '失败'], ['代码覆盖率', '78.2% / ≥70%', true], ['镜像漏洞（高危）', '0 个', true], ['回归用例', run.status === '失败' ? '246 / 250' : '248 / 250', run.status !== '失败']]
            .map(([n, v, ok]) => `<div class="spread" style="padding:6px 0;font-size:12.3px">
              <span style="color:var(--text-2)">${n}</span>
              <span style="display:flex;align-items:center;gap:6px">
                <span class="mono" style="font-size:11.5px">${v}</span>
                <span class="badge ${ok ? 'ok' : 'warn'}">${ok ? '通过' : '警告'}</span>
              </span></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t">发布策略</div></div>
        <div class="card-body">
          <dl class="kv">
            <dt>目标环境</dt><dd>${esc(p.env)}</dd>
            <dt>策略</dt><dd>${esc(p.strategy || '灰度发布（10% → 50% → 100%）')}</dd>
            <dt>审批人</dt><dd>${esc(p.approvers || '应用负责人 + 运维值班')}</dd>
            <dt>回滚</dt><dd>自动回滚（错误率 &gt; 1%）</dd>
          </dl>
          ${app ? `<button class="btn sm" style="width:100%;justify-content:center;margin-top:10px" onclick="location.hash='/apps/${app.id}/releases'">查看发布记录</button>` : ''}
        </div>
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">构建历史</div><div class="r tiny muted">共 ${p.runs} 次 · 点任意一行查看该次运行</div></div>
    <table class="table">
      <thead><tr><th>编号</th><th>状态</th><th>提交</th><th>分支</th><th>触发人</th><th>耗时</th><th class="right">时间</th></tr></thead>
      <tbody>${(p.history || []).map(h => `<tr class="clickable ${String(h.no) === '#' + run.no ? 'sel' : ''}" onclick="location.hash='/cicd/${p.id}/${String(h.no).replace('#', '')}'">
          <td class="name mono">${h.no}</td>
          <td>${pbadge(h.status)}</td>
          <td class="mono" style="font-size:11px">${esc(h.commit)}</td>
          <td><span class="chip">${esc(h.branch)}</span></td>
          <td>${esc(h.by)}</td>
          <td class="num">${h.dur}</td>
          <td class="right tiny muted">${h.time}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* 审批 / 驳回 / 灰度推进 / 重新运行 */
function approvePipeline(id) {
  const p = DB.pipelines.find(x => x.id === id);
  if (!p) return;
  const i = p.stages.findIndex(s => s.n === '人工审批');
  if (i < 0) return;
  p.stages[i] = { n: '人工审批', s: 'done', d: '18s' };
  const next = p.stages[i + 1];
  if (next) next.s = 'run', next.d = '10%';
  p.status = '运行中';
  p.logs.push([clockNow(), 'k', 'stage: approve']);
  p.logs.push([clockNow(), 'ok', `stage approve ✓ 18s  by ${DB.user.name}`]);
  p.logs.push([clockNow(), 'k', 'stage: canary  →  权重 10%']);
  p.logs.push([clockNow(), 't', 'canary 10%  deployed  errorRate=0.00%  p99=' + (38 + p.runs % 12) + 'ms']);
  saveSnapshot();
  const app = DB.apps.find(a => a.id === p.appId);
  if (app) app.events.unshift({ t: clockNow(), k: 'ok', tx: `流水线 <b>${esc(p.name)}</b> 审批通过，进入 ${esc(p.env)} 灰度` });
  toast('已通过审批，灰度发布开始', 'ok');
  route();
}
function rejectPipeline(id) {
  const p = DB.pipelines.find(x => x.id === id);
  if (!p) return;
  const i = p.stages.findIndex(s => s.n === '人工审批');
  if (i >= 0) p.stages[i] = { n: '人工审批', s: 'fail', d: '已驳回' };
  p.status = '失败';
  p.logs.push([clockNow(), 'err', `stage approve ✗  rejected by ${DB.user.name}`]);
  p.history[0].status = '失败';
  saveSnapshot();
  toast('已驳回本次发布', 'warn');
  route();
}
function promoteCanary(id) {
  const p = DB.pipelines.find(x => x.id === id);
  if (!p) return;
  const i = p.stages.findIndex(s => s.n === '灰度发布');
  if (i >= 0) p.stages[i] = { n: '灰度发布', s: 'done', d: '4m12s' };
  p.status = '成功';
  applyRuntimeFromBuild(p);
  p.logs.push([clockNow(), 't', 'canary 50%  deployed  errorRate=0.00%']);
  p.logs.push([clockNow(), 'ok', 'stage canary ✓ 4m12s  权重推进至 100%']);
  const app = DB.apps.find(a => a.id === p.appId);
  const comp = app && findComp(app, p.comp);
  if (app) {
    app.updated = nowStamp();
    app.events.unshift({ t: clockNow(), k: 'ok', tx: `组件 <b>${esc(p.comp)}</b> 完成灰度发布${comp ? `，当前版本 ${esc(comp.version)}` : ''}` });
    DB.releases.unshift({
      id: `rel-${Date.now().toString(36)}`, appId: app.id, comp: p.comp,
      version: comp ? comp.version : 'v1.0.0', prev: bumpVersion(comp ? comp.version : 'v1.0.0', -1),
      env: p.env, strategy: '灰度 10% → 50% → 100%', status: '已发布',
      by: DB.user.name, approver: app.owner || DB.user.name,
      at: fmtDateTime(Date.now()), ts: Date.now(), note: `流水线 ${p.name} #${p.runs}`,
      configSnapshot: configOf(app, p.comp).map(c => ({
        key: c.key, scope: c.scope, secret: !!c.secret, value: c.secret ? '••••••' : c.value
      }))
    });
  }
  saveSnapshot();
  toast('灰度已推进至 100%，发布完成', 'ok');
  route();
}
function rerunPipeline(id) {
  const p = DB.pipelines.find(x => x.id === id);
  if (!p) return;
  const no = latestRunNo(p) + 1;
  p.runs = no;
  p.status = '运行中';
  p.history.unshift({ no: '#' + no, status: '运行中', by: DB.user.name, branch: p.branch, commit: Math.random().toString(16).slice(2, 9), dur: '—', time: clockNow() });
  p.stages = p.stages.map((s, i) => i === 0 ? { n: s.n, s: 'run', d: '0s' } : { n: s.n, s: 'wait', d: '—' });
  p.logs = [[clockNow(), 'k', `#${no} ${p.comp}  pipeline start  trigger=manual  branch=${p.branch}`],
            [clockNow(), 't', `queued on executor ci-runner-0${1 + no % 4}`]];
  saveSnapshot();
  goto(`/cicd/${p.id}/${no}`);
  toast('已触发新的运行', 'ok');
  simulateRun(p, 0);
}
function simulateRun(p, i) {
  setTimeout(() => {
    if (p.status !== '运行中') return;
    const s = p.stages[i];
    if (!s) { p.status = '成功'; p.history[0].status = '成功'; p.history[0].dur = '5m48s'; applyRuntimeFromBuild(p); saveSnapshot(); if (location.hash.startsWith(`#/cicd/${p.id}`)) route(); return; }
    s.s = 'done'; s.d = durStr(mulberry32(Date.now() & 0xffff));
    p.logs.push([clockNow(), 'ok', `stage ${s.n} ✓ ${s.d}`]);
    // 制品产出即可回填运行时（模拟构建环境自动识别）
    if (s.n === '编译构建') applyRuntimeFromBuild(p);
    const next = p.stages[i + 1];
    if (next) {
      if (next.n === '人工审批') {
        // 停在审批门禁，等人工放行，避免模拟推进把审批一起跳过
        next.s = 'wait'; next.d = '—';
        p.status = '运行中';
        saveSnapshot();
        if (location.hash.startsWith(`#/cicd/${p.id}`)) route();
        return;
      }
      next.s = 'run'; next.d = '0s';
    }
    saveSnapshot();
    if (location.hash.startsWith(`#/cicd/${p.id}`)) route();
    if (i + 1 < p.stages.length) simulateRun(p, i + 1);
    else setTimeout(() => {
      p.status = '成功'; p.history[0].status = '成功'; p.history[0].dur = '5m48s'; applyRuntimeFromBuild(p); saveSnapshot();
      if (location.hash.startsWith(`#/cicd/${p.id}`)) route();
    }, 900);
  }, i === 0 ? 900 : 1500);
}

/* ---------- 新建流水线向导 ---------- */
function newPipeline() {
  const targets = [];
  DB.apps.forEach(a => a.components.forEach(c => targets.push({ app: a, comp: c })));
  if (!targets.length) return toast('还没有可选的组件，请先创建应用与组件', 'warn');
  const first = targets[0];
  const groupOpts = DB.apps.filter(a => a.components.length).map(a =>
    `<optgroup label="${esc(a.name)}">${a.components.map(c =>
      `<option value="${a.id}|${c.name}">${esc(c.name)}${c.workloads.length ? ` · ${c.workloads.length} 个负载` : ' · 无负载'}</option>`).join('')}</optgroup>`).join('');

  wizard({
    title: '新建流水线',
    desc: '流水线绑定「应用 - 组件」，从代码提交一路编排到环境发布。',
    okText: '创建并运行',
    state: {
      target: `${first.app.id}|${first.comp.name}`,
      branch: 'main', trigger: 'Git Push', repo: 'ssh://git.corp.io/retail/',
      buildEnv: 'JDK 21 · Maven 3.9', dockerfile: 'Dockerfile',
      unit: true, regress: true, approval: true, autoRollback: true,
      env: '生产环境', strategy: '灰度发布（10% → 50% → 100%）'
    },
    steps: [
      {
        name: '归属与代码',
        render: s => `
          ${fField('归属组件', `<select class="input" data-k="target">${groupOpts}</select>`, '流水线以组件为构建单元', true)}
          <div class="form-row">
            ${fField('代码仓库', fInput('repo', s.repo, 'ssh://git.corp.io/...'))}
            ${fField('分支', fInput('branch', s.branch, 'main'))}
          </div>
          ${fField('触发方式', fSelect('trigger', ['Git Push', '定时触发', '手动触发', 'Tag 发布'], s.trigger), 'Git Push 会在分支有新提交时自动运行')}`,
        validate: s => s.target ? null : '请选择归属组件'
      },
      {
        name: '构建配置',
        render: s => `
          <div class="form-row">
            ${fField('构建环境', fSelect('buildEnv', ['JDK 21 · Maven 3.9', 'JDK 17 · Maven 3.9', 'Node 20 · pnpm 9', 'Go 1.22', 'Rust 1.77'], s.buildEnv))}
            ${fField('Dockerfile', fInput('dockerfile', s.dockerfile, 'Dockerfile'), '相对仓库根目录')}
          </div>
          <div class="divider"></div>
          <div class="tiny muted" style="margin-bottom:8px">可选阶段（代码检出、编译构建、镜像推送始终执行）</div>
          ${fCheck('unit', '单元测试', s.unit, '生成覆盖率报告，低于 70% 阻断')}
          ${fCheck('regress', '自动化回归', s.regress, '灰度阶段跑 250 条核心用例')}
          ${fCheck('approval', '人工审批', s.approval, '进入生产前需要应用负责人放行')}`,
      },
      {
        name: '发布策略',
        render: s => `
          <div class="form-row">
            ${fField('目标环境', fSelect('env', DB.envs.map(e => e.name), s.env))}
            ${fField('发布策略', fSelect('strategy', ['滚动更新', '灰度发布（10% → 50% → 100%）', '蓝绿切换'], s.strategy))}
          </div>
          ${fCheck('autoRollback', '失败自动回滚', s.autoRollback, '错误率超过 1% 或健康检查失败时自动退回上一版')}
          <div class="warn-box" style="margin-top:14px">生产环境的灰度发布会在「人工审批」阶段暂停，审批通过后才推进权重。</div>`,
      },
      {
        name: '确认',
        render: s => {
          const [appId, comp] = String(s.target).split('|');
          const app = DB.apps.find(a => a.id === appId);
          const c = app && findComp(app, comp);
          return `<div class="kv" style="grid-template-columns:92px 1fr;row-gap:11px">
            <dt>归属</dt><dd><b>${esc(app ? app.name : '')}</b> / <span class="mono">${esc(comp)}</span></dd>
            <dt>代码</dt><dd class="mono" style="font-size:11.5px">${esc(s.repo)}${esc(s.branch)} · ${esc(s.trigger)}</dd>
            <dt>构建</dt><dd>${esc(s.buildEnv)} · ${esc(s.dockerfile)}</dd>
            <dt>阶段</dt><dd>代码检出 → 编译构建${s.unit ? ' → 单元测试' : ''} → 镜像推送 → 部署${String(s.env).replace('环境', '')}${s.regress ? ' → 自动化回归' : ''}${s.approval ? ' → 人工审批' : ''} → 灰度发布</dd>
            <dt>发布</dt><dd>${esc(s.env)} · ${esc(s.strategy)}${s.autoRollback ? ' · 失败自动回滚' : ''}</dd>
            <dt>影响面</dt><dd>${c ? `${c.workloads.length} 个工作负载` : '该组件暂无工作负载'}</dd>
          </div>
          <div class="warn-box" style="margin-top:14px">创建后会立即触发一次运行（原型模拟，约 10 秒走完 6 个阶段）。</div>`;
        }
      }
    ],
    onSubmit: s => {
      const [appId, compName] = String(s.target).split('|');
      const app = DB.apps.find(a => a.id === appId);
      const comp = app && findComp(app, compName);
      if (!comp) return '找不到所选组件';
      const stages = [{ n: '代码检出', s: 'wait', d: '—' }, { n: '编译构建', s: 'wait', d: '—' }];
      if (s.unit) stages.push({ n: '单元测试', s: 'wait', d: '—' });
      stages.push({ n: '镜像推送', s: 'wait', d: '—' });
      stages.push({ n: `部署${String(s.env).replace('环境', '')}`, s: 'wait', d: '—' });
      if (s.regress) stages.push({ n: '自动化回归', s: 'wait', d: '—' });
      if (s.approval) stages.push({ n: '人工审批', s: 'wait', d: '—' });
      stages.push({ n: '灰度发布', s: 'wait', d: '—' });

      let id = `pl-${slugify(compName) || 'pipe'}`;
      let i = 2;
      while (DB.pipelines.some(x => x.id === id)) id = `pl-${slugify(compName) || 'pipe'}-${i++}`;

      const p = {
        id,
        name: `${compName} · ${String(s.env).includes('生产') ? '生产发布' : '主干发布'}`,
        app: app.name, appId: app.id, comp: compName,
        trigger: s.trigger, branch: s.branch || 'main',
        status: '已就绪', last: '尚未运行', success: 100, runs: 0,
        env: s.env, strategy: s.strategy,
        repo: s.repo || comp.repo || 'ssh://git.corp.io/retail/', dockerfile: s.dockerfile, buildEnv: s.buildEnv,
        approvers: `${app.owner || DB.user.name}（应用负责人）`,
        stages, logs: [], history: []
      };
      DB.pipelines.unshift(p);
      if (!app.pipelines.includes(id)) app.pipelines.push(id);
      app.events.unshift({ t: clockNow(), k: '', tx: `新建流水线 <b>${esc(p.name)}</b>，目标 ${esc(s.env)}` });
      saveSnapshot();
      toast('流水线已创建，正在触发首次运行', 'ok');
      rerunPipeline(id);
    }
  });
}

/* ---------- 制品仓库 ---------- */
function viewArtifacts() {
  setCrumb('制品仓库');
  const arts = [
    { n: 'hub.corp.io/retail/order-service', t: 'v2.4.1', s: '68.4 MB', arch: 'amd64', scan: '无高危', time: '3 分钟前', by: 'CI Robot' },
    { n: 'hub.corp.io/retail/inventory-service', t: 'v1.9.0', s: '42.1 MB', arch: 'amd64', scan: '无高危', time: '2 小时前', by: 'CI Robot' },
    { n: 'hub.corp.io/pay/pay-router', t: 'v4.0.7', s: '55.8 MB', arch: 'amd64', scan: '1 中危', time: '2 天前', by: '王磊' },
    { n: 'hub.corp.io/edge/infer-engine', t: 'v2.1.0', s: '1.82 GB', arch: 'arm64', scan: '无高危', time: '5 小时前', by: '陈曦' },
    { n: 'hub.corp.io/iot/proto-parser', t: 'v0.9.4', s: '24.6 MB', arch: 'arm64', scan: '无高危', time: '8 小时前', by: '陈曦' },
    { n: 'hub.corp.io/base/auth-service', t: 'v3.6.2', s: '71.2 MB', arch: 'amd64', scan: '无高危', time: '1 天前', by: '赵雪' }
  ];
  return `
  <div class="page-head">
    <div><div class="ttl">制品仓库</div><div class="sub">镜像与制品统一归档，带签名校验与漏洞扫描；边缘镜像额外标记 CPU 架构。</div></div>
    <div class="acts">
      <button class="btn" disabled title="扫描策略配置尚未开放">扫描策略</button>
      <button class="btn" disabled title="按仓库生成的拉取指令尚未开放">拉取指令</button>
    </div>
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:240px">${icon('search', '', 14)}<input placeholder="搜索镜像 / 版本" oninput="listFilter('#artTable', this.value)" /></div>
      <button class="filter-pill on" onclick="listStatus('#artTable','all',this)">全部</button>
      <button class="filter-pill" onclick="listStatus('#artTable','amd64',this)">云端 amd64</button>
      <button class="filter-pill" onclick="listStatus('#artTable','arm64',this)">边缘 arm64</button>
    </div>
    <table class="table" id="artTable">
      <thead><tr><th>镜像</th><th>版本</th><th>大小</th><th>架构</th><th>扫描</th><th>推送人</th><th class="right">推送时间</th></tr></thead>
      <tbody>${arts.map(a => `
        <tr data-q="${esc(a.n)} ${esc(a.t)} ${esc(a.by)}" data-status="${esc(a.arch)}">
          <td class="name mono" style="font-size:11.5px">${a.n}</td>
          <td><span class="chip">${a.t}</span></td>
          <td class="num">${a.s}</td>
          <td><span class="badge ${a.arch === 'arm64' ? 'teal' : 'muted'}">${a.arch}</span></td>
          <td>${a.scan === '无高危' ? badge(a.scan, 'ok') : badge(a.scan, 'warn')}</td>
          <td>${a.by}</td>
          <td class="right tiny muted">${a.time}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ---------- Service Mesh ---------- */
function meshTabs(active) {
  const t = [['/mesh', '服务治理'], ['/mesh/traffic', '流量规则'], ['/mesh/topology', '服务拓扑'], ['/mesh/tracing', '链路追踪']];
  return `<div class="tabs" style="margin-bottom:14px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:0 8px">
    ${t.map(([r, n]) => `<div class="tab ${active === r ? 'on' : ''}" onclick="location.hash='${r}'">${n}</div>`).join('')}
  </div>`;
}
function meshBanner() {
  return `<div class="mod-banner">
    <div class="ic">${icon('share', '', 17)}</div>
    <div class="tx">
      <b>Service Mesh</b>
      <p>可插拔模块 · 独立于平台内核，关闭后应用发布、工作负载调度等基础功能不受影响</p>
    </div>
    <span class="badge ok">已启用</span>
    <button class="btn sm" onclick="toggleModule('mesh',false)">关闭模块</button>
  </div>`;
}

function viewMesh() {
  setCrumb('服务治理');
  if (!S.modules.mesh) return moduleOffPage('mesh', 'Service Mesh', '服务治理能力依赖该模块。启用后可查看服务清单、Sidecar 注入状态与 mTLS 策略。');
  return `
  <div class="page-head">
    <div><div class="ttl">服务治理</div><div class="sub">服务清单、Sidecar 注入状态与通信安全策略。</div></div>
    <div class="acts"><button class="btn" onclick="toast('已刷新')">${icon('refresh', '', 14)}刷新</button></div>
  </div>
  ${meshBanner()}
  ${meshTabs('/mesh')}
  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">纳管服务</div><div class="val">8</div><div class="foot">7 已注入 · 1 跳过</div></div>
    <div class="stat"><div class="lab">Sidecar 注入率</div><div class="val">87.5<small>%</small></div><div class="foot">命名空间级自动注入</div></div>
    <div class="stat"><div class="lab">请求成功率</div><div class="val" style="color:var(--success)">99.94<small>%</small></div><div class="foot">近 1 小时 · 18.9k QPS</div></div>
    <div class="stat"><div class="lab">mTLS</div><div class="val" style="font-size:19px">严格模式</div><div class="foot">证书自动轮换 · 剩余 14 天</div></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索服务 / 命名空间" oninput="listFilter('#meshTable', this.value)" /></div>
      <button class="filter-pill on" onclick="listStatus('#meshTable','all',this)">全部</button>
      <button class="filter-pill" onclick="listStatus('#meshTable','告警',this)">异常</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">控制面 istiod v1.21.3 · 数据面 Envoy 1.29</span></div>
    </div>
    <table class="table" id="meshTable">
      <thead><tr><th>服务</th><th>命名空间</th><th>版本</th><th>Sidecar</th><th>QPS</th><th>成功率</th><th>P99</th><th>实例</th><th>状态</th></tr></thead>
      <tbody>${DB.mesh.services.map(s => `
        <tr class="clickable" data-q="${esc(s.name)} ${esc(s.ns)} ${esc(s.ver)}" data-status="${esc(s.status)}" onclick="openTraceBySvc('${esc(s.name)}')" title="查看该服务的链路">
          <td class="name">${esc(s.name)}</td>
          <td class="mono" style="font-size:11px">${esc(s.ns)}</td>
          <td class="mono" style="font-size:11px">${esc(s.ver)}</td>
          <td>${s.sidecar === '已注入' ? '<span class="badge info">已注入</span>' : '<span class="badge muted">未注入</span>'}</td>
          <td class="num">${s.rps}</td>
          <td class="num" style="${s.status === '告警' ? 'color:var(--danger);font-weight:600' : ''}">${s.success}</td>
          <td class="num" style="${s.status === '告警' ? 'color:var(--danger)' : ''}">${s.p99}</td>
          <td class="num">${s.inst}</td>
          <td>${badge(s.status)}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ==========================================================
   Service Mesh · 流量规则（虚拟服务 / 目标规则）
   ========================================================== */
const RULE_TYPES = ['虚拟服务', '目标规则'];
const RULE_ACTS = {
  '虚拟服务': [['split', '按版本权重路由'], ['mirror', '流量镜像']],
  '目标规则': [['retry', '超时与重试'], ['circuit', '熔断'], ['outlier', '异常点驱逐']]
};
const MATCH_KINDS = [['all', '所有请求'], ['header', '请求头匹配'], ['path', '路径前缀'], ['percent', '按比例采样']];
const JUDGE_KINDS = [['5xx', '连续 5xx'], ['5xx+timeout', '5xx 或超时'], ['conn', '连接失败']];

function ruleMatchText(r) {
  const m = r.match || {};
  if (m.kind === 'header') return `header[${m.key}]=${m.value}`;
  if (m.kind === 'path') return `路径前缀 ${m.value}`;
  if (m.kind === 'percent') return `${m.value}% 采样`;
  return '所有请求';
}
function ruleActionText(r) {
  const a = r.act || {};
  if (a.kind === 'split') return `权重 → ${(a.splits || []).map(x => `${x.ver} ${x.weight}%`).join(' · ')}`;
  if (a.kind === 'mirror') return `镜像 → ${a.target}（${a.pct}% 采样）`;
  if (a.kind === 'retry') return `重试 ${a.times} 次 · 超时 ${a.timeout}ms`;
  if (a.kind === 'circuit') return `连续 ${a.fails} 次${a.judge === 'conn' ? '连接失败' : a.judge === '5xx+timeout' ? '5xx/超时' : ' 5xx'} → 隔离 ${a.isolate}s`;
  if (a.kind === 'outlier') return `异常点驱逐 上限 ${a.pct}% · 基线 ${a.base}s`;
  return '—';
}
function ruleFiltered() {
  const q = String(S.ruleQ || '').trim().toLowerCase();
  return DB.mesh.rules.filter(r => {
    if (S.ruleType !== 'all' && r.type !== S.ruleType) return false;
    if (!q) return true;
    return [r.name, r.host, r.type, ruleMatchText(r), ruleActionText(r)].join(' ').toLowerCase().includes(q);
  });
}
function ruleRows() {
  const list = ruleFiltered();
  if (!list.length) {
    return `<tr><td colspan="6"><div class="empty" style="padding:30px 16px">
      <h3>没有匹配的规则</h3><p>换个关键字或类型，或者新建一条。</p></div></td></tr>`;
  }
  return list.map(r => `<tr class="clickable" onclick="ruleModal('${r.id}')">
    <td class="name" style="white-space:normal">
      <div style="display:flex;align-items:center;gap:6px;min-width:0">
        <span class="chip ${r.type === '虚拟服务' ? 'blue' : 'purple'}" style="flex:none">${esc(r.type)}</span>
        <span class="mono" style="font-size:11.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.name)} · ${esc(r.ns)}">${esc(r.name)}</span>
      </div>
      <div class="sub">${esc(r.host)} · 命中 ${esc(r.hits || '—')}</div>
    </td>
    <td class="mono" style="font-size:11px;white-space:nowrap">${esc(ruleMatchText(r))}</td>
    <td class="tiny">${esc(ruleActionText(r))}</td>
    <td>${badge(r.status)}</td>
    <td class="right" onclick="event.stopPropagation()">
      <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
        <button class="mini-act" title="${r.status === '生效中' ? '停用规则' : '启用规则'}" onclick="ruleToggle('${r.id}')">${icon('power', '', 13)}</button>
        <button class="mini-act danger" title="删除规则" onclick="ruleDelete('${r.id}')">${icon('archive', '', 13)}</button>
      </div>
    </td>
  </tr>`).join('');
}
function ruleSet(k, v) {
  if (k === 'q') S.ruleQ = v; else S.ruleType = v;
  const box = $('#rule-rows');
  if (box) box.innerHTML = ruleRows();
  const cnt = $('#rule-count');
  if (cnt) {
    const on = DB.mesh.rules.filter(r => r.status === '生效中').length;
    cnt.textContent = `${ruleFiltered().length} / ${DB.mesh.rules.length} 条 · ${on} 条生效中`;
  }
  if (k === 'type') {
    document.querySelectorAll('.toolbar .filter-pill').forEach(b => b.classList.remove('on'));
    const btn = [...document.querySelectorAll('.toolbar .filter-pill')].find(b => b.textContent.trim() === ({ all: '全部', '虚拟服务': '虚拟服务', '目标规则': '目标规则' })[v]);
    if (btn) btn.classList.add('on');
  }
}

/* 灰度权重卡：读当前生效的权重路由规则，不写死 */
function canaryCard() {
  const hitsNum = r => {
    const m = String(r.hits || '').match(/([\d.]+)\s*([km])?/i);
    if (!m) return 0;
    return parseFloat(m[1]) * (m[2] && m[2].toLowerCase() === 'k' ? 1000 : m[2] && m[2].toLowerCase() === 'm' ? 1e6 : 1);
  };
  const splitRules = DB.mesh.rules
    .filter(r => r.act && r.act.kind === 'split')
    .sort((a, b) => (a.status === '生效中' ? 0 : 1) - (b.status === '生效中' ? 0 : 1) || hitsNum(b) - hitsNum(a));
  const rule = splitRules[0];
  if (!rule) {
    return `<div class="card">
      <div class="card-head"><div class="t">灰度权重</div></div>
      <div class="empty" style="padding:30px 16px">
        <h3>还没有权重路由</h3>
        <p>新建一条虚拟服务规则，即可按版本权重分流。</p>
        <button class="btn sm primary" onclick="ruleModal(null)">新建规则</button>
      </div>
    </div>`;
  }
  const splits = rule.act.splits || [];
  const on = DB.mesh.rules.filter(r => r.status === '生效中').length;
  return `<div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-head"><div class="t">灰度权重</div><div class="r tiny muted">${esc(rule.name)}</div></div>
      <div class="card-body">
        <div style="font-size:11.5px;color:var(--text-3);margin-bottom:12px">${esc(rule.host)} 按版本分流${rule.status === '生效中' ? '' : '（规则已停用，权重不生效）'}</div>
        ${splits.map(s => `<div style="margin-bottom:13px">
          <div class="spread" style="font-size:12px;margin-bottom:5px"><span>${esc(s.ver)}${s.cur ? '（当前）' : '（灰度）'}</span><span class="mono">${s.weight}%</span></div>
          <div class="progress"><div style="width:${s.weight}%;background:${s.cur ? 'var(--primary)' : 'var(--warning)'}"></div></div>
        </div>`).join('')}
        <div class="divider"></div>
        <dl class="kv" style="grid-template-columns:80px 1fr">
          <dt>匹配条件</dt><dd class="mono" style="font-size:11px">${esc(ruleMatchText(rule))}</dd>
          <dt>命中流量</dt><dd class="mono" style="font-size:11px">${esc(rule.hits || '—')}</dd>
          <dt>最近变更</dt><dd style="font-size:11.5px">${esc(rule.updated)} · ${esc(rule.by || '—')}</dd>
        </dl>
        <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px" onclick="ruleModal('${rule.id}')">调整权重</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div class="t">规则生效情况</div><div class="r"><span class="badge ok">${on} 生效中</span></div></div>
      <div class="card-body">
        <dl class="kv" style="grid-template-columns:80px 1fr">
          <dt>虚拟服务</dt><dd>${DB.mesh.rules.filter(r => r.type === '虚拟服务').length} 条</dd>
          <dt>目标规则</dt><dd>${DB.mesh.rules.filter(r => r.type === '目标规则').length} 条</dd>
          <dt>已停用</dt><dd>${DB.mesh.rules.filter(r => r.status === '已停用').length} 条</dd>
          <dt>覆盖服务</dt><dd>${new Set(DB.mesh.rules.map(r => r.host)).size} 个</dd>
        </dl>
        <div class="tiny muted" style="margin-top:10px;line-height:1.6">虚拟服务决定「请求怎么走」，目标规则决定「失败怎么办」。同名规则以创建时间较晚者生效。</div>
      </div>
    </div>
  </div>`;
}

function viewMeshTraffic() {
  setCrumb('流量规则');
  if (!S.modules.mesh) return moduleOffPage('mesh', 'Service Mesh', '流量规则依赖 Service Mesh 提供的数据面能力。');
  const on = DB.mesh.rules.filter(r => r.status === '生效中').length;
  return `
  <div class="page-head">
    <div><div class="ttl">流量规则</div><div class="sub">虚拟服务与目标规则统一编排，支持灰度、超时重试、熔断与流量镜像。</div></div>
    <div class="acts"><button class="btn primary" onclick="ruleModal(null)">${icon('plus', '', 14)}新建规则</button></div>
  </div>
  ${meshBanner()}
  ${meshTabs('/mesh/traffic')}

  <div class="grid g21">
    <div class="card">
      <div class="toolbar">
        <div class="search" style="margin:0;width:210px">${icon('search', '', 14)}
          <input id="rule-q" placeholder="搜索规则 / 服务 / 动作" value="${esc(S.ruleQ)}" oninput="ruleSet('q', this.value)" />
        </div>
        ${[['all', '全部'], ['虚拟服务', '虚拟服务'], ['目标规则', '目标规则']].map(([k, n]) =>
          `<button class="filter-pill ${S.ruleType === k ? 'on' : ''}" onclick="ruleSet('type','${k}')">${n}</button>`).join('')}
        <div class="grow"><span class="tiny muted" style="align-self:center" id="rule-count">${ruleFiltered().length} / ${DB.mesh.rules.length} 条 · ${on} 条生效中</span></div>
      </div>
      <table class="table">
        <thead><tr><th style="width:34%">规则名</th><th style="width:17%">匹配条件</th><th style="width:33%">动作</th><th>状态</th><th class="right">操作</th></tr></thead>
        <tbody id="rule-rows">${ruleRows()}</tbody>
      </table>
    </div>
    ${canaryCard()}
  </div>`;
}

/* ---------- 规则表单：类型 / 动作切换时局部重绘 ---------- */
function ruleDyn(d) {
  const type = d.type || '虚拟服务';
  const acts = RULE_ACTS[type] || [];
  const act = acts.some(([k]) => k === d.act) ? d.act : acts[0][0];
  const mKind = d.mKind || 'all';
  const val = (k, dv) => (d[k] === undefined || d[k] === '' ? String(dv) : String(d[k]));

  let matchExtra = '';
  if (mKind === 'header') {
    matchExtra = `<div class="form-row">
      ${fField('请求头', fInput('mKey', d.mKey || 'x-version', 'x-version'), '区分大小写')}
      ${fField('期望值', fInput('mValue', d.mValue || 'v2', 'v2'))}
    </div>`;
  } else if (mKind === 'path') {
    matchExtra = fField('路径前缀', fInput('mValue', d.mValue || '/api/', '/api/order'), '以 / 开头，前缀匹配');
  } else if (mKind === 'percent') {
    matchExtra = fField('采样比例', fInput('mValue', d.mValue || '10', '10', 'number'), '1 - 100，按请求百分比');
  }

  let actBody = '';
  if (act === 'split') {
    actBody = `<div class="form-row">
        ${fField('主版本', fInput('s1ver', d.s1ver || '', 'v2.4.1'), '承接剩余权重的稳定版本')}
        ${fField('主版本权重', fInput('s1w', val('s1w', 90), '90', 'number'))}
      </div>
      <div class="form-row">
        ${fField('灰度版本', fInput('s2ver', d.s2ver || '', 'v2.5.0'))}
        ${fField('灰度权重', fInput('s2w', val('s2w', 10), '10', 'number'))}
      </div>
      <div class="hint">两侧权重合计需为 100，未命中的请求走主版本。</div>`;
  } else if (act === 'mirror') {
    actBody = `<div class="form-row">
        ${fField('镜像目标', fInput('mTarget', d.mTarget || '', 'inventory-shadow'), '通常是同名服务的 shadow 版本')}
        ${fField('采样比例', fInput('mPct', val('mPct', 10), '10', 'number'), '按百分比复制请求，响应被丢弃')}
      </div>`;
  } else if (act === 'retry') {
    actBody = `<div class="form-row">
        ${fField('重试次数', fInput('rTimes', val('rTimes', 3), '3', 'number'))}
        ${fField('单次超时 (ms)', fInput('rTimeout', val('rTimeout', 800), '800', 'number'))}
      </div>
      <div class="form-row">
        ${fField('退避间隔 (ms)', fInput('rBackoff', val('rBackoff', 25), '25', 'number'))}
        ${fField('重试条件', fSelect('rOn', [['5xx', '仅 5xx'], ['5xx+timeout', '5xx 或超时'], ['conn', '仅连接失败']], d.rOn || '5xx'))}
      </div>`;
  } else if (act === 'circuit') {
    actBody = `<div class="form-row">
        ${fField('连续失败次数', fInput('cFails', val('cFails', 5), '5', 'number'))}
        ${fField('隔离时长 (s)', fInput('cIsolate', val('cIsolate', 30), '30', 'number'))}
      </div>
      <div class="form-row">
        ${fField('失败判定', fSelect('cJudge', JUDGE_KINDS, d.cJudge || '5xx'))}
        ${fField('半开探测数', fInput('cHalf', val('cHalf', 3), '3', 'number'), '隔离结束后放行的探测请求')}
      </div>`;
  } else if (act === 'outlier') {
    actBody = `<div class="form-row">
        ${fField('最大驱逐比例 (%)', fInput('oPct', val('oPct', 50), '50', 'number'), '避免一次性摘除全部实例')}
        ${fField('驱逐时长 (s)', fInput('oBase', val('oBase', 30), '30', 'number'))}
      </div>
      <div class="form-row">
        ${fField('检查间隔 (s)', fInput('oInterval', val('oInterval', 10), '10', 'number'))}
        ${fField('连续错误次数', fInput('oFails', val('oFails', 5), '5', 'number'))}
      </div>`;
  }

  return `<div class="form-sec">匹配条件</div>
    <div class="form-row">${fField('匹配方式', fSelect('mKind', MATCH_KINDS, mKind, ' onchange="ruleRerender()"'))}</div>
    ${matchExtra}
    <div class="form-sec">动作</div>
    <div class="form-row">${fField('动作类型', fSelect('act', acts, act, ' onchange="ruleRerender()"'))}</div>
    ${actBody}`;
}
function ruleHostChange() {
  const mask = document.querySelector('.modal-mask:last-child');
  if (!mask) return;
  const d = readForm(mask);
  const svc = DB.mesh.services.find(x => x.name === d.host) || {};
  const s1 = mask.querySelector('[data-k=s1ver]');
  if (s1 && svc.ver) s1.value = svc.ver;
}
function ruleRerender() {
  const mask = document.querySelector('.modal-mask:last-child');
  const box = mask && mask.querySelector('#rule-dyn');
  if (!box) return;
  box.innerHTML = ruleDyn(readForm(mask));
}
function ruleModal(id) {
  const list = DB.mesh.rules;
  const item = id ? list.find(r => r.id === id) : null;
  const svcOpts = DB.mesh.services.filter(s => s.status !== '跳过').map(s => [s.name, `${s.name} · ${s.ns}`]);
  if (!svcOpts.length) return toast('还没有可用的 Mesh 服务', 'warn');
  const svc = (name) => DB.mesh.services.find(s => s.name === name) || {};
  const sp = (item && item.act.splits) || [{}, {}];
  const d = item ? {
    name: item.name, type: item.type, host: item.host,
    mKind: item.match.kind, mKey: item.match.key, mValue: item.match.value,
    act: item.act.kind,
    s1ver: sp[0] && sp[0].ver, s1w: sp[0] && sp[0].weight,
    s2ver: sp[1] && sp[1].ver, s2w: sp[1] && sp[1].weight,
    mTarget: item.act.target, mPct: item.act.pct,
    rTimes: item.act.times, rTimeout: item.act.timeout, rBackoff: item.act.backoff, rOn: item.act.on,
    cFails: item.act.fails, cIsolate: item.act.isolate, cJudge: item.act.judge, cHalf: item.act.half,
    oPct: item.act.pct, oBase: item.act.base, oInterval: item.act.interval, oFails: item.act.fails
  } : { name: '', type: '虚拟服务', host: svcOpts[0][0], mKind: 'all', act: 'split', s1w: 90, s2w: 10, s1ver: (svc(svcOpts[0][0]).ver || '') };

  formModal({
    title: item ? `编辑规则 · ${item.name}` : '新建流量规则',
    desc: '虚拟服务决定请求怎么走，目标规则决定失败怎么办。保存后立即下发到数据面。',
    okText: item ? '保存并下发' : '创建并下发',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('规则名', fInput('name', d.name, 'order-service-canary'), '小写字母、数字与连字符', true)}
        ${fField('类型', fSelect('type', RULE_TYPES, d.type, ' onchange="ruleRerender()"'))}
      </div>
      ${fField('目标服务', fSelect('host', svcOpts, d.host, ' onchange="ruleHostChange()"'), '规则作用于该服务的入站流量', true)}
      <div id="rule-dyn">${ruleDyn(d)}</div>
      ${item ? fCheck('enable', '启用该规则', item.status === '生效中', '关闭后规则保留但不参与路由') : ''}`,
    onSubmit: st => {
      const name = String(st.name || '').trim();
      if (!NAME_RE.test(name)) return '规则名只能是小写字母、数字与连字符，且以字母或数字开头';
      if (list.some(r => r.name === name && r.id !== id)) return `规则名 ${name} 已存在`;
      const target = DB.mesh.services.find(s => s.name === st.host);
      if (!target) return '请选择目标服务';

      const match = { kind: st.mKind || 'all' };
      if (match.kind === 'header') {
        if (!st.mKey) return '请填写请求头名称';
        if (!st.mValue) return '请填写期望值';
        match.key = st.mKey; match.value = st.mValue;
      } else if (match.kind === 'path') {
        if (!String(st.mValue || '').startsWith('/')) return '路径前缀需以 / 开头';
        match.value = st.mValue;
      } else if (match.kind === 'percent') {
        match.value = String(clampInt(st.mValue, 1, 100, 10));
      }

      let act;
      if (st.act === 'split') {
        const w1 = clampInt(st.s1w, 0, 100, 90), w2 = clampInt(st.s2w, 0, 100, 10);
        if (!st.s1ver || !st.s2ver) return '请填写主版本与灰度版本号';
        if (st.s1ver === st.s2ver) return '主版本与灰度版本不能相同';
        if (w1 + w2 !== 100) return `权重合计需为 100，当前 ${w1 + w2}`;
        act = { kind: 'split', splits: [{ ver: st.s1ver, weight: w1, cur: true }, { ver: st.s2ver, weight: w2 }] };
      } else if (st.act === 'mirror') {
        if (!st.mTarget) return '请填写镜像目标服务';
        if (st.mTarget === st.host) return '镜像目标不能是目标服务本身，否则会无限回环';
        act = { kind: 'mirror', target: st.mTarget, pct: clampInt(st.mPct, 1, 100, 10) };
      } else if (st.act === 'retry') {
        act = {
          kind: 'retry', times: clampInt(st.rTimes, 1, 10, 3),
          timeout: clampInt(st.rTimeout, 50, 60000, 800),
          backoff: clampInt(st.rBackoff, 0, 5000, 25), on: st.rOn || '5xx'
        };
      } else if (st.act === 'circuit') {
        act = {
          kind: 'circuit', fails: clampInt(st.cFails, 1, 100, 5),
          isolate: clampInt(st.cIsolate, 1, 3600, 30), judge: st.cJudge || '5xx',
          half: clampInt(st.cHalf, 1, 20, 3)
        };
      } else if (st.act === 'outlier') {
        act = {
          kind: 'outlier', pct: clampInt(st.oPct, 1, 100, 50),
          base: clampInt(st.oBase, 1, 3600, 30), interval: clampInt(st.oInterval, 1, 600, 10),
          fails: clampInt(st.oFails, 1, 100, 5)
        };
      } else {
        return '请选择动作类型';
      }

      if (item) {
        Object.assign(item, {
          name, type: st.type, host: st.host, ns: target.ns, match, act,
          status: st.enable === false ? '已停用' : '生效中',
          updated: '刚刚', by: DB.user.name
        });
      } else {
        list.unshift({
          id: `rule-${Date.now().toString(36)}`,
          name, type: st.type, host: st.host, ns: target.ns, match, act,
          status: '生效中', hits: '0/s', updated: '刚刚', by: DB.user.name
        });
      }
      saveSnapshot();
      route();
      toast(item ? `规则 ${name} 已下发` : `规则 ${name} 已创建并生效`, 'ok');
    }
  });
}
function ruleToggle(id) {
  const r = DB.mesh.rules.find(x => x.id === id);
  if (!r) return;
  r.status = r.status === '生效中' ? '已停用' : '生效中';
  r.updated = '刚刚';
  r.by = DB.user.name;
  saveSnapshot();
  route();
  toast(`规则 ${r.name} 已${r.status === '生效中' ? '启用' : '停用'}`, 'ok');
}
function ruleDelete(id) {
  const r = DB.mesh.rules.find(x => x.id === id);
  if (!r) return;
  openModal({
    title: '删除流量规则',
    desc: `${r.name} · ${r.type} · ${r.host}`,
    danger: true,
    okText: '确认删除',
    body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">删除后该规则立即从数据面移除，命中它的流量回到默认路由——灰度、重试与熔断保护同时失效。</p>`,
    onOk: () => {
      DB.mesh.rules = DB.mesh.rules.filter(x => x.id !== id);
      saveSnapshot();
      route();
      toast('规则已删除', 'warn');
    }
  });
}

function viewMeshTopology() {
  setCrumb('服务拓扑');
  if (!S.modules.mesh) return moduleOffPage('mesh', 'Service Mesh', '服务拓扑基于 Sidecar 采集的调用链数据生成。');
  const N = {
    gw: { x: 20, y: 34, n: 'api-gateway', s: 'Ingress · 2.4k rps', k: 'ext' },
    auth: { x: 20, y: 150, n: 'auth-service', s: 'v3.6.2 · 3 inst', k: 'svc' },
    order: { x: 250, y: 34, n: 'order-service', s: 'v2.4.1 · 6 inst', k: 'svc' },
    pay: { x: 250, y: 150, n: 'pay-router', s: 'v4.0.7 · 5 inst', k: 'svc' },
    inv: { x: 250, y: 266, n: 'inventory-service', s: 'v1.9.0 · 3 inst', k: 'svc' },
    db: { x: 490, y: 34, n: 'order-db', s: 'MySQL · 未注入', k: 'data' },
    chan: { x: 490, y: 150, n: 'channel-adapter', s: '96.2% · 降级', k: 'bad' },
    sync: { x: 490, y: 266, n: 'inventory-sync', s: 'CronJob', k: 'job' },
    bank: { x: 720, y: 150, n: '外部渠道', s: '银行 / 三方支付', k: 'out' }
  };
  const W = 148, H = 44;
  const edges = [
    ['gw', 'order', '1.2k · 48ms', ''],
    ['order', 'db', '— · 12ms', 'dash'],
    ['auth', 'pay', '860 · 76ms', ''],
    ['pay', 'chan', '420 · 1.4s', 'slow'],
    ['chan', 'bank', '— · 超时', 'slow'],
    ['inv', 'sync', '—', 'dash'],
    ['gw', 'auth', '3.6k · 9ms', 'v'],
    ['order', 'pay', '调用', 'v'],
    ['pay', 'inv', '调用', 'v']
  ];
  const col = { svc: '#eef4ff', ext: '#f4efff', data: '#f4f6fb', bad: '#fdeef1', job: '#f4f6fb', out: '#fafbfd' };
  const str = { svc: '#cddcff', ext: '#ddd0fb', data: '#dfe5f1', bad: '#f6ccd5', job: '#e4e9f2', out: '#e4e9f2' };
  const tc = { svc: '#1d4ed8', ext: '#6d28d9', data: '#334155', bad: '#b91c3c', job: '#475569', out: '#64748b' };

  let svg = `<svg viewBox="0 0 900 350" style="width:100%;height:auto;display:block">`;
  svg += `<defs><marker id="ar" markerWidth="7" markerHeight="7" refX="6" refY="3.2" orient="auto">
    <path d="M0,0 L6,3.2 L0,6.4 z" fill="#9bacc7"/></marker></defs>`;

  edges.forEach(([a, b, lab, ty]) => {
    if (ty === 'v') {
      const x = N[a].x + W / 2;
      const y1 = N[a].y + H, y2 = N[b].y;
      if (y2 - y1 < 6) return;
      svg += `<path d="M${x} ${y1} L${x} ${y2 - 2}" stroke="#c3cee0" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#ar)" fill="none"/>`;
      if (lab) svg += `<text x="${x + 6}" y="${(y1 + y2) / 2 + 3}" font-size="9.5" fill="#8b97ad" font-family="ui-monospace,monospace">${lab}</text>`;
      return;
    }
    const x1 = N[a].x + W, y1 = N[a].y + H / 2, x2 = N[b].x, y2 = N[b].y + H / 2;
    const dash = ty === 'dash' ? '4 3' : '';
    const st = ty === 'slow' ? '#e0a3ad' : '#c3cee0';
    svg += `<path d="M${x1} ${y1} C${x1 + 38} ${y1}, ${x2 - 38} ${y2}, ${x2 - 2} ${y2}" stroke="${st}" stroke-width="1.4" ${dash ? `stroke-dasharray="${dash}"` : ''} fill="none" marker-end="url(#ar)"/>`;
    if (lab) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 5;
      svg += `<text x="${mx}" y="${my}" font-size="9.5" fill="#8b97ad" text-anchor="middle" font-family="ui-monospace,monospace">${lab}</text>`;
    }
  });

  Object.values(N).forEach(n => {
    const clickable = n.k === 'svc' || n.k === 'ext';
    svg += `<g class="topo-node"${clickable ? ` style="cursor:pointer" onclick="openTraceBySvc('${n.n}')"` : ''}>
      <title>${n.n}${clickable ? ' · 查看链路' : ''}</title>
      <rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="9" fill="${col[n.k]}" stroke="${str[n.k]}" stroke-width="1.2"/>
      <circle cx="${n.x + 14}" cy="${n.y + 15}" r="3.4" fill="${tc[n.k]}"/>
      <text x="${n.x + 25}" y="${n.y + 19}" font-size="11.5" font-weight="600" fill="#0e1729" font-family="ui-sans-serif,system-ui">${n.n}</text>
      <text x="${n.x + 14}" y="${n.y + 34}" font-size="9.5" fill="#7b8aa3" font-family="ui-monospace,monospace">${n.s}</text>
    </g>`;
  });
  svg += `</svg>`;

  return `
  <div class="page-head">
    <div><div class="ttl">服务拓扑</div><div class="sub">基于 Sidecar 东西向流量自动发现，虚线表示异步或跨层调用。</div></div>
    <div class="acts">
      <div class="seg"><button class="on">1 小时</button><button>6 小时</button><button>24 小时</button></div>
      <button class="btn" onclick="openTraceBySvc('all')">${icon('trace', '', 14)}链路追踪</button>
    </div>
  </div>
  ${meshBanner()}
  ${meshTabs('/mesh/topology')}
  <div class="card">
    <div class="card-body" style="padding:10px 12px 4px">${svg}</div>
    <div style="padding:0 16px 14px">
      <div class="legend">
        <span><i style="background:#eef4ff;border:1px solid #cddcff"></i>内部服务</span>
        <span><i style="background:#f4efff;border:1px solid #ddd0fb"></i>入口/网关</span>
        <span><i style="background:#fdeef1;border:1px solid #f6ccd5"></i>异常</span>
        <span><i style="background:#f4f6fb;border:1px solid #dfe5f1"></i>数据/任务</span>
        <span><i style="background:#fafbfd;border:1px solid #e4e9f2"></i>外部依赖</span>
        <span style="margin-left:auto;color:var(--text-3)">节点口径：QPS · P99 延迟</span>
      </div>
    </div>
  </div>`;
}

/* ---------- 链路追踪 ---------- */
const SVC_PALETTE = ['#2563eb', '#0d9488', '#7c3aed', '#0891b2', '#4f46e5', '#c2760a', '#b91c3c', '#0f766e', '#64748b', '#be185d'];
const SVC_FIXED = {
  'api-gateway': '#7c3aed', 'order-service': '#2563eb', 'auth-service': '#0d9488',
  'inventory-service': '#0891b2', 'pay-router': '#4f46e5', 'channel-adapter': '#c2760a',
  'order-db': '#64748b', 'mqtt-broker': '#0f766e', 'bank-gateway': '#b91c3c',
  'profile-service': '#be185d'
};
function svcColor(s) {
  if (SVC_FIXED[s]) return SVC_FIXED[s];
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SVC_PALETTE[h % SVC_PALETTE.length];
}
function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms'; }
function spanDepth(spans, i) {
  let d = 0, p = spans[i].p;
  while (p != null && p >= 0 && p < spans.length && d < 24) { d++; p = spans[p].p; }
  return d;
}
function traceServices() {
  const set = new Set();
  (DB.mesh.traces || []).forEach(t => t.spans.forEach(s => set.add(s.svc)));
  return [...set].sort();
}
function traceFiltered() {
  const q = (S.traceQ || '').trim().toLowerCase();
  return (DB.mesh.traces || []).filter(t => {
    if (S.traceSvc !== 'all' && !t.spans.some(s => s.svc === S.traceSvc)) return false;
    if (S.traceSt !== 'all' && t.status !== S.traceSt) return false;
    if (!q) return true;
    return t.id.includes(q) || t.root.toLowerCase().includes(q) ||
      t.spans.some(s => s.svc.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  });
}

function viewMeshTracing() {
  setCrumb('链路追踪');
  if (!S.modules.mesh) return moduleOffPage('mesh', 'Service Mesh', '链路追踪依赖 Sidecar 上报的调用链数据。');
  const list = traceFiltered();
  if (!S.traceSel || !list.some(t => t.id === S.traceSel)) {
    S.traceSel = list.length ? list[0].id : '';
    S.traceSpan = 0;
  }
  const errCount = (DB.mesh.traces || []).filter(t => t.status === '错误' || t.status === '超时').length;

  return `
  <div class="page-head">
    <div><div class="ttl">链路追踪</div><div class="sub">基于 Sidecar 上报的 OpenTelemetry 链路，按 TraceID 还原跨服务调用路径。</div></div>
    <div class="acts">
      <div class="seg">
        ${[['1h', '1 小时'], ['6h', '6 小时'], ['24h', '24 小时']].map(([k, n]) =>
          `<button class="${S.traceRange === k ? 'on' : ''}" onclick="traceRange('${k}')">${n}</button>`).join('')}
      </div>
      <button class="btn" onclick="toast('已刷新，最新链路 12 秒前上报')">${icon('refresh', '', 14)}刷新</button>
    </div>
  </div>
  ${meshBanner()}
  ${meshTabs('/mesh/tracing')}

  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">采样链路</div><div class="val">128.4<small>k</small></div><div class="foot">近 1 小时 · 采样率 <b>12.5%</b></div></div>
    <div class="stat"><div class="lab">平均链路耗时</div><div class="val">86<small>ms</small></div><div class="foot"><span class="up">-4ms</span> 较昨日同时段</div></div>
    <div class="stat"><div class="lab">P99 链路耗时</div><div class="val">1.42<small>s</small></div><div class="foot">主要来自支付渠道出口</div></div>
    <div class="stat"><div class="lab">异常链路</div><div class="val" style="color:var(--danger)">0.03<small>%</small></div><div class="foot">${errCount} 条样本 · 含 5xx 与超时</div></div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="toolbar">
      <div class="search" style="margin:0;width:250px">${icon('search', '', 14)}
        <input placeholder="TraceID / 接口 / 服务" value="${esc(S.traceQ)}" oninput="traceQuery(this.value)" />
      </div>
      <select class="input" style="width:170px;height:30px;padding:0 8px;font-size:12px" onchange="traceService(this.value)">
        <option value="all"${S.traceSvc === 'all' ? ' selected' : ''}>全部服务</option>
        ${traceServices().map(s => `<option value="${esc(s)}"${S.traceSvc === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
      ${['all', '正常', '慢调用', '错误', '超时'].map(k =>
        `<button class="filter-pill ${S.traceSt === k ? 'on' : ''}" onclick="traceStatus('${k}')">${k === 'all' ? '全部' : k}</button>`).join('')}
      <div class="grow"><span class="tiny muted" style="align-self:center" id="trace-count">${list.length} 条链路</span></div>
    </div>
    <table class="table">
      <thead><tr><th>状态</th><th>TraceID</th><th>入口接口</th><th>根服务</th><th style="width:190px">耗时</th><th class="right">Span</th><th>开始时间</th></tr></thead>
      <tbody id="trace-rows">${traceRows(list)}</tbody>
    </table>
  </div>

  <div id="trace-panel">${tracePanel()}</div>`;
}

function traceRows(list) {
  if (!list.length) {
    return `<tr><td colspan="7"><div class="empty" style="padding:34px 16px">
      <h3>没有匹配的链路</h3><p>换一个服务或状态筛选，或清空搜索关键词。</p></div></td></tr>`;
  }
  const max = Math.max(...list.map(t => t.dur));
  return list.map(t => {
    const on = t.id === S.traceSel;
    const bar = t.status === '错误' || t.status === '超时'
      ? 'var(--danger)' : t.status === '慢调用' ? 'var(--warning)' : 'var(--primary)';
    return `<tr class="clickable ${on ? 'sel' : ''}" onclick="selectTrace('${t.id}')">
      <td>${badge(t.status)}</td>
      <td class="mono" style="font-size:11px;color:${on ? 'var(--primary)' : 'var(--text-2)'}">${t.id}</td>
      <td class="name" style="font-weight:550">${esc(t.root)}</td>
      <td class="mono" style="font-size:11px">${esc(t.spans[0].svc)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="progress" style="width:104px;height:5px;flex:none"><div style="width:${(t.dur / max) * 100}%;background:${bar}"></div></div>
          <span class="mono" style="font-size:11px;color:var(--text)">${fmtMs(t.dur)}</span>
        </div>
      </td>
      <td class="right num">${t.spans.length}</td>
      <td class="mono" style="font-size:11px;color:var(--text-3)">${t.at}</td>
    </tr>`;
  }).join('');
}

function tracePanel() {
  const t = (DB.mesh.traces || []).find(x => x.id === S.traceSel);
  if (!t) {
    const filtered = S.traceQ || S.traceSvc !== 'all' || S.traceSt !== 'all';
    return `<div class="card"><div class="empty" style="padding:40px 16px">
      <h3>${filtered ? '当前筛选下没有链路' : '选择一条链路查看瀑布图'}</h3>
      <p>${filtered ? '调整上方的搜索关键词或筛选条件后再试。' : '上方列表中的每条 Trace 都可展开为跨服务的 Span 时序。'}</p></div></div>`;
  }
  const sp = t.spans[S.traceSpan] || t.spans[0];
  const svcs = new Set(t.spans.map(s => s.svc));
  return `<div class="card">
    <div class="card-head">
      <span style="color:var(--primary)">${icon('trace', '', 15)}</span>
      <div class="t">${esc(t.root)}</div>
      ${badge(t.status)}
      <div class="r">
        <span class="mono tiny muted">${t.id}</span>
        <button class="btn sm" onclick="copyTrace('${t.id}')">${icon('copy', '', 12)}复制</button>
        <button class="btn sm" onclick="location.hash='/mesh/topology'">查看拓扑</button>
      </div>
    </div>
    <div class="wf-meta">
      <span>耗时 <b>${fmtMs(t.dur)}</b></span>
      <span>Span <b>${t.spans.length}</b></span>
      <span>服务 <b>${svcs.size}</b></span>
      <span>开始 <b>${t.at}</b></span>
      <span style="margin-left:auto">点击任意 Span 查看标签与事件</span>
    </div>
    <div class="trace-wrap">
      <div class="wf">
        <div class="wf-head">
          <div>服务 / 操作</div>
          <div class="wf-axis">
            ${[0, 25, 50, 75, 100].map(p => `<span style="left:${p}%">${p === 100 ? fmtMs(t.dur) : p + '%'}</span>`).join('')}
          </div>
          <div style="text-align:right">耗时</div>
        </div>
        ${t.spans.map((s, i) => {
          const depth = spanDepth(t.spans, i);
          const c = s.status === 'err' ? 'var(--danger)' : svcColor(s.svc);
          return `<div class="sp ${S.traceSpan === i ? 'on' : ''}" onclick="selectSpan(${i})">
            <div class="sp-l" style="padding-left:${6 + depth * 14}px">
              <i class="sp-dot" style="background:${c}"></i>
              <span class="sp-name">${esc(s.name)}</span>
              <span class="sp-svc">${esc(s.svc)}</span>
            </div>
            <div class="sp-t">
              <div class="sp-bar" style="left:${(s.start / t.dur) * 100}%;width:${Math.max((s.dur / t.dur) * 100, 0.5)}%;background:${c}"></div>
            </div>
            <div class="sp-d">${fmtMs(s.dur)}</div>
          </div>`;
        }).join('')}
        ${selfTimeBlock(t)}
      </div>
      ${spanDetail(t, sp)}
    </div>
  </div>`;
}

function spanDetail(t, sp) {
  const idx = t.spans.indexOf(sp);
  const share = (sp.dur / t.dur) * 100;
  const kindMap = { server: '服务端', client: '客户端', producer: '生产者', consumer: '消费者', db: '数据库' };
  return `<div class="sd">
    <div class="sd-h">
      <div style="min-width:0">
        <div class="sd-name">${esc(sp.name)}</div>
        <div class="sd-sub mono">${esc(sp.svc)} · ${kindMap[sp.kind] || sp.kind}</div>
      </div>
      ${badge(sp.status === 'err' ? '错误' : '正常')}
    </div>
    <dl class="kv" style="grid-template-columns:70px 1fr">
      <dt>耗时</dt><dd class="mono">${fmtMs(sp.dur)}</dd>
      <dt>起始偏移</dt><dd class="mono">+${sp.start}ms</dd>
      <dt>链路占比</dt><dd class="mono">${share.toFixed(1)}%</dd>
      <dt>序号</dt><dd class="mono">#${idx + 1} / ${t.spans.length}</dd>
      <dt>Pod</dt><dd class="mono" style="font-size:10.5px;word-break:break-all">${esc(sp.pod)}</dd>
    </dl>
    <div class="sd-sec">Span 标签</div>
    <div class="sd-tags">
      <div class="sd-tag"><b>span.kind</b><span>${esc(sp.kind)}</span></div>
      ${Object.entries(sp.tags || {}).map(([k, v]) =>
        `<div class="sd-tag"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}
    </div>
    ${(sp.events || []).length ? `
      <div class="sd-sec">事件</div>
      <div class="ev-list">
        ${sp.events.map(e => `<div class="ev"><i></i><div><div class="ev-t mono">${esc(e.t)}</div><div class="ev-x">${esc(e.tx)}</div></div></div>`).join('')}
      </div>` : ''}
    <div class="sd-note">相对链路起点偏移 ${sp.start}ms · 自身耗时 ${fmtMs(selfTime(t.spans, idx))}</div>
  </div>`;
}

/* 自身耗时：总时长减去直接子 span 时长，按服务聚合后用于耗时分布 */
function selfTime(spans, i) {
  const children = spans.filter(s => s.p === i).reduce((a, s) => a + s.dur, 0);
  return Math.max(0, spans[i].dur - children);
}
function selfTimeBlock(t) {
  const agg = {};
  t.spans.forEach((s, i) => { agg[s.svc] = (agg[s.svc] || 0) + selfTime(t.spans, i); });
  const rows = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  return `<div class="wf-dist">
    <div class="wf-dist-h">耗时分布 <span>按服务统计自身耗时（已剔除子调用）</span></div>
    ${rows.map(([svc, ms]) => `<div class="wf-dist-row">
      <span class="wf-dist-n"><i style="background:${svcColor(svc)}"></i>${esc(svc)}</span>
      <div class="wf-dist-t"><div style="width:${(ms / max) * 100}%;background:${svcColor(svc)}"></div></div>
      <span class="wf-dist-v mono">${fmtMs(ms)}</span>
      <span class="wf-dist-p mono">${((ms / t.dur) * 100).toFixed(1)}%</span>
    </div>`).join('')}
  </div>`;
}

function paintTrace() {
  const list = traceFiltered();
  if (!list.some(t => t.id === S.traceSel)) {
    S.traceSel = list.length ? list[0].id : '';
    S.traceSpan = 0;
  }
  const rows = $('#trace-rows');
  if (rows) rows.innerHTML = traceRows(list);
  const cnt = $('#trace-count');
  if (cnt) cnt.textContent = `${list.length} 条链路`;
  const panel = $('#trace-panel');
  if (panel) panel.innerHTML = tracePanel();
}
function selectTrace(id) { S.traceSel = id; S.traceSpan = 0; paintTrace(); }
function selectSpan(i) { S.traceSpan = i; paintTrace(); }
function traceQuery(v) { S.traceQ = v; paintTrace(); }
function traceService(v) { S.traceSvc = v; paintTrace(); }
function traceStatus(v) {
  S.traceSt = v;
  document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('on'));
  const btn = [...document.querySelectorAll('.filter-pill')].find(b => b.textContent.trim() === (v === 'all' ? '全部' : v));
  if (btn) btn.classList.add('on');
  paintTrace();
}
function traceRange(k) {
  S.traceRange = k;
  document.querySelectorAll('.seg button').forEach(b => b.classList.remove('on'));
  const i = ['1h', '6h', '24h'].indexOf(k);
  const btn = document.querySelectorAll('.page-head .seg button')[i];
  if (btn) btn.classList.add('on');
  toast(`时间范围已切换至 ${k === '1h' ? '1 小时' : k === '6h' ? '6 小时' : '24 小时'}（原型演示数据不变）`);
}
function copyTrace(id) {
  const done = () => toast('TraceID 已复制：' + id, 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(done).catch(done);
  else done();
}
/* 从服务治理 / 拓扑跳转到按服务过滤的链路列表 */
function openTraceBySvc(svc) {
  S.traceSvc = svc || 'all';
  S.traceSt = 'all';
  S.traceQ = '';
  S.traceSel = '';
  goto('/mesh/tracing');
}

/* ---------- 云边端 ---------- */
function edgeTabs(active) {
  const t = [['/edge/nodes', '边缘节点'], ['/edge/distribute', '应用分发'], ['/edge/devices', '端设备']];
  return `<div class="tabs" style="margin-bottom:14px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:0 8px">
    ${t.map(([r, n]) => `<div class="tab ${active === r ? 'on' : ''}" onclick="location.hash='${r}'">${n}</div>`).join('')}
  </div>`;
}
function edgeBanner() {
  return `<div class="mod-banner teal">
    <div class="ic">${icon('cloud', '', 17)}</div>
    <div class="tx">
      <b>云边端协同</b>
      <p>可插拔模块 · 边缘节点、边缘分发与端设备管理相对平台内核解耦，关闭后云端调度与发布链路照常运行</p>
    </div>
    <span class="badge teal">已启用</span>
    <button class="btn sm" onclick="toggleModule('edge',false)">关闭模块</button>
  </div>`;
}

/* ==========================================================
   云边端 · 边缘节点纳管
   ========================================================== */
/* 节点字段补齐：历史数据与新建节点共用同一套派生逻辑 */
function normalizeEdge() {
  DB.edge.nodes.forEach((n, i) => {
    if (!n.id) n.id = `edge-${i + 1}`;
    if (!n.cluster) n.cluster = /cd-|成都|西南/.test(n.region) ? 'edge-cd-store' : 'edge-sh-store';
    if (!n.ip) n.ip = `10.${62 + (i % 6)}.${12 + (i * 3) % 240}.${21 + (i * 7) % 200}`;
    if (!n.cores) n.cores = n.type === '边缘服务器' ? 8 : n.type === '边缘网关' ? 2 : 4;
    if (!n.disk) n.disk = 28 + ((i * 17) % 58);
    if (!n.labels) {
      const city = String(n.region).split('·')[0].trim();
      n.labels = ['env=store', `city=${city}`, `node=${n.name}`];
    }
    if (typeof n.cordoned !== 'boolean') n.cordoned = false;
    if (!n.joinedAt) n.joinedAt = `2026-0${1 + (i % 8)}-${pad2(3 + (i * 2) % 24)}`;
    if (!n.agent) n.agent = n.ver && n.ver !== '—' ? n.ver : 'v1.8.2';
    if (!n.runtime) n.runtime = 'containerd 1.7.11';
    if (!n.note) n.note = '';
    n.wl = edgeWorkloadsOn(n).length;
  });
}
/* 全平台所有调度位置为「边缘」的工作负载 */
function edgeWorkloadPool() {
  const out = [];
  DB.apps.forEach(a => a.components.forEach(c => c.workloads.forEach(w => {
    if (w.where !== '边缘') return;
    out.push({
      appId: a.id, app: a.name, comp: c.name, name: w.name,
      kind: w.kind, image: imgRef(c, w), cpu: w.cpu, mem: w.mem, w
    });
  })));
  return out;
}
/* 某节点上运行的工作负载：按节点序号轮转分配，保证同一份数据前后一致 */
function edgeWorkloadsOn(n) {
  if (!n || n.status === '离线' || n.status === '待激活') return [];
  const pool = edgeWorkloadPool();
  const idx = Math.max(0, DB.edge.nodes.indexOf(n));
  return pool.filter((w, i) => (i + idx) % 3 !== 0);
}
function nodeShare(n) {
  const list = edgeWorkloadsOn(n);
  const pool = Math.max(1, edgeWorkloadPool().length);
  return Math.round(list.length / pool * 100);
}
function nodeMetrics(n) {
  const r = mulberry32(wHash(n.name + 'nm'));
  const lat = parseInt(n.latency, 10) || 16;
  const cpuBase = n.cpu || 40, memBase = n.mem || 50, diskBase = n.disk || 40;
  const band = (base, spread, lo, hi) => [Math.max(lo, base - spread), Math.min(hi, base + spread)];
  const rd = a => a.map(v => Math.round(v));
  const cpu = rd(anchor(walk(r, 60, cpuBase, 7, ...band(cpuBase, 24, 2, 99), true), cpuBase));
  const mem = rd(anchor(walk(r, 60, memBase, 4, ...band(memBase, 14, 4, 99)), memBase));
  const latS = rd(anchor(walk(r, 60, lat, lat * 0.3, Math.max(2, lat * 0.55), lat * 2.2, true), lat));
  const disk = rd(anchor(walk(r, 60, diskBase, 1.2, ...band(diskBase, 5, 5, 99)), diskBase));
  return { cpu, mem, lat: latS, disk };
}
function nodeEvents(n) {
  if (n.status === '待激活') {
    return [{ t: '—', type: 'Warning', reason: 'AwaitingAgent', msg: '等待门店侧执行接入命令完成注册，接入令牌 24 小时内有效' }];
  }
  if (n.status === '离线') {
    return [
      { t: '2 小时前', type: 'Warning', reason: 'HeartbeatLost', msg: `与云端心跳中断超过 90s，节点标记 NotReady；本地工作负载仍按离线策略运行` },
      { t: '2 小时前', type: 'Normal', reason: 'NodeNotReady', msg: 'kubelet 未上报状态，调度器已停止向该节点分配新实例' }
    ];
  }
  const list = [
    { t: '今天 08:04', type: 'Normal', reason: 'NodeReady', msg: `kubelet 上报就绪，容器运行时 ${n.runtime}` },
    { t: '今天 08:06', type: 'Normal', reason: 'ImagePreloaded', msg: `镜像预热完成，本地缓存 ${3 + (n.wl % 4)} 个边缘镜像` },
    { t: '今天 09:20', type: 'Normal', reason: 'SyncSucceeded', msg: '增量同步完成，期望状态与云端一致' }
  ];
  if (n.status === '告警') {
    list.unshift({ t: '12 分钟前', type: 'Warning', reason: 'HighCPUUsage', msg: `节点 CPU 使用率 ${n.cpu}%，超过 85% 阈值，边缘推理实例可能被限流` });
    list.unshift({ t: '6 分钟前', type: 'Warning', reason: 'HeartbeatDelay', msg: '心跳延迟 8.4s，云边链路出现抖动' });
  }
  return list;
}

function viewEdgeNodes() {
  setCrumb('边缘节点');
  if (!S.modules.edge) return moduleOffPage('edge', '云边端协同', '边缘节点纳管依赖该模块。启用后可纳管门店边缘节点并下发边缘工作负载。');
  const nodes = DB.edge.nodes;
  const on = nodes.filter(n => n.status === '在线').length;
  const warn = nodes.filter(n => n.status === '告警').length;
  const off = nodes.filter(n => n.status === '离线').length;
  const pend = nodes.filter(n => n.status === '待激活').length;
  const cities = new Set(nodes.map(n => String(n.region).split('·')[0].trim())).size;
  const wlSum = nodes.reduce((s, n) => s + (n.wl || 0), 0);
  const feeding = nodes.filter(n => (n.wl || 0) > 0).length;
  const lats = nodes.map(n => parseInt(n.latency, 10)).filter(v => !isNaN(v));
  const latAvg = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0;
  return `
  <div class="page-head">
    <div><div class="ttl">边缘节点</div><div class="sub">门店边缘侧算力纳管，支持离线自治与联网后增量同步。</div></div>
    <div class="acts">
      <button class="btn" onclick="toast('接入指引：门店侧安装 Agent → 执行接入命令 → 云端自动纳管')">接入指引</button>
      <button class="btn primary" onclick="addEdgeNode()">${icon('plus', '', 14)}添加节点</button>
    </div>
  </div>
  ${edgeBanner()}
  ${edgeTabs('/edge/nodes')}
  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">边缘节点</div><div class="val">${nodes.length}</div><div class="foot">覆盖 ${cities} 个城市</div></div>
    <div class="stat"><div class="lab">在线率</div><div class="val">${nodes.length ? (on / nodes.length * 100).toFixed(1) : '0.0'}<small>%</small></div>
      <div class="foot"><span class="down">${off}</span> 离线 · <span style="color:var(--warning);font-weight:600">${warn}</span> 告警${pend ? ` · ${pend} 待激活` : ''}</div></div>
    <div class="stat"><div class="lab">边缘工作负载</div><div class="val">${wlSum}</div><div class="foot">跨 ${feeding} 个节点调度</div></div>
    <div class="stat"><div class="lab">平均回源延迟</div><div class="val">${latAvg}<small>ms</small></div><div class="foot">${off ? '<span style="color:var(--danger)">含离线节点，仅统计在线</span>' : '云边链路健康'}</div></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索节点 / 区域" oninput="listFilter('#nodeTable', this.value)" /></div>
      <button class="filter-pill on" onclick="listStatus('#nodeTable','all',this)">全部</button>
      <button class="filter-pill" onclick="listStatus('#nodeTable','在线',this)">在线</button>
      <button class="filter-pill" onclick="listStatus('#nodeTable','告警',this)">告警</button>
      <button class="filter-pill" onclick="listStatus('#nodeTable','离线',this)">离线</button>
      ${pend ? `<button class="filter-pill" onclick="listStatus('#nodeTable','待激活',this)">待激活</button>` : ''}
      <div class="grow"><span class="tiny muted" style="align-self:center">Agent 版本 v1.8.2 统一</span></div>
    </div>
    <table class="table" id="nodeTable">
      <thead><tr><th>节点</th><th>位置</th><th>类型</th><th>CPU</th><th>内存</th><th>回源延迟</th><th>工作负载</th><th>最近同步</th><th>状态</th></tr></thead>
      <tbody>${nodes.map(n => `
        <tr class="clickable" data-q="${esc(n.name)} ${esc(n.region)} ${esc(n.type)}" data-status="${esc(n.status)}" onclick="goto('#/edge/nodes/${encodeURIComponent(n.name)}')">
          <td class="name mono" style="font-size:11.5px">${esc(n.name)}<div class="sub">${esc(n.agent)} · ${esc(n.cluster)}</div></td>
          <td>${esc(n.region)}</td>
          <td><span class="chip">${esc(n.type)}</span></td>
          <td>${n.cpu ? `<div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:56px"><div class="${n.cpu > 80 ? 'bad' : n.cpu > 65 ? 'warn' : 'ok'}" style="width:${n.cpu}%"></div></div><span class="num">${n.cpu}%</span></div>` : '<span class="muted">—</span>'}</td>
          <td>${n.mem ? `<div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:56px"><div class="${n.mem > 85 ? 'bad' : n.mem > 70 ? 'warn' : 'ok'}" style="width:${n.mem}%"></div></div><span class="num">${n.mem}%</span></div>` : '<span class="muted">—</span>'}</td>
          <td class="num">${esc(n.latency)}</td>
          <td class="num">${n.wl || 0}</td>
          <td class="tiny muted">${esc(n.sync)}</td>
          <td>${badge(n.status)}${n.cordoned ? ' <span class="badge muted">已封锁</span>' : ''}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function nodeMetricsBlock(n) {
  if (n.status === '离线' || n.status === '待激活') {
    return `<div class="card"><div class="empty" style="padding:34px 16px">
      <h3>${n.status === '离线' ? '节点离线，暂无实时指标' : '节点尚未激活'}</h3>
      <p>${n.status === '离线' ? '最后上报时间 ' + esc(n.sync) + '。节点恢复联网后会自动续传指标与事件。' : '门店侧完成注册后开始上报 CPU、内存与回源延迟。'}</p>
    </div></div>`;
  }
  const m = nodeMetrics(n);
  return `<div class="grid g3" style="margin-bottom:14px">
    ${chartCard('CPU 使用率', `${n.cores} 核 · 近 1 小时`, m.cpu, { unit: '%', color: '#2563eb', labels: axisLabels('1h'), fmt: v => Math.round(v) })}
    ${chartCard('内存使用率', '含边缘缓存 · 近 1 小时', m.mem, { unit: '%', color: '#0d9488', labels: axisLabels('1h'), fmt: v => Math.round(v) })}
    ${chartCard('回源延迟', '边缘节点 → 云端网关', m.lat, { unit: 'ms', color: '#c2760a', labels: axisLabels('1h'), fmt: v => Math.round(v) })}
  </div>`;
}

function viewEdgeNode(name) {
  if (!S.modules.edge) return moduleOffPage('edge', '云边端协同', '边缘节点纳管依赖该模块。');
  const n = DB.edge.nodes.find(x => x.name === name);
  setCrumb('边缘节点');
  if (!n) {
    return `<div class="card"><div class="empty" style="padding:60px 20px">
      <h3>找不到节点 ${esc(name)}</h3>
      <p>它可能已被移除，或者链接里的节点名不匹配。</p>
      <button class="btn primary" onclick="goto('#/edge/nodes')">返回节点列表</button>
    </div></div>`;
  }
  const wls = edgeWorkloadsOn(n);
  const devs = (DB.edge.devices || []).filter(d => d.node === n.name);
  const evs = nodeEvents(n);
  const live = n.status === '在线' || n.status === '告警';
  return `
  <div class="page-head">
    <div>
      <div style="display:flex;align-items:center;gap:9px">
        <span class="link tiny" onclick="goto('#/edge/nodes')">边缘节点</span>
        <span class="muted">/</span>
        <span class="ttl" style="font-size:16px">${esc(n.name)}</span>
        ${badge(n.status)}
        ${n.cordoned ? '<span class="badge muted">已封锁调度</span>' : ''}
      </div>
      <div class="sub">${esc(n.region)} · <b>${esc(n.type)}</b> · 集群 <span class="mono">${esc(n.cluster)}</span> · Agent <span class="mono">${esc(n.agent)}</span></div>
    </div>
    <div class="acts">
      ${n.status === '待激活' ? `<button class="btn primary" onclick="nodeActivate('${esc(n.name)}')">${icon('refresh', '', 14)}模拟上线</button>
        <button class="btn" onclick="joinModal('${esc(n.name)}')">查看接入命令</button>` : `
        <button class="btn" onclick="nodeSync('${esc(n.name)}')">${icon('refresh', '', 14)}立即同步</button>
        <button class="btn" onclick="nodeCordon('${esc(n.name)}')">${n.cordoned ? '解除封锁' : '封锁调度'}</button>`}
      <button class="btn danger" onclick="nodeRemove('${esc(n.name)}')">移除节点</button>
    </div>
  </div>
  ${edgeBanner()}
  ${edgeTabs('/edge/nodes')}

  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">CPU</div><div class="val">${n.cpu || 0}<small>%</small></div>
      <div class="foot"><div style="display:flex;align-items:center;gap:8px;width:100%"><div class="progress thin" style="flex:1"><div class="${n.cpu > 80 ? 'bad' : n.cpu > 65 ? 'warn' : 'ok'}" style="width:${n.cpu || 0}%"></div></div><span class="tiny muted" style="white-space:nowrap">${n.cores} 核</span></div></div></div>
    <div class="stat"><div class="lab">内存</div><div class="val">${n.mem || 0}<small>%</small></div>
      <div class="foot"><div style="display:flex;align-items:center;gap:8px;width:100%"><div class="progress thin" style="flex:1"><div class="${n.mem > 85 ? 'bad' : n.mem > 70 ? 'warn' : 'ok'}" style="width:${n.mem || 0}%"></div></div><span class="tiny muted" style="white-space:nowrap">含缓存</span></div></div></div>
    <div class="stat"><div class="lab">本地磁盘</div><div class="val">${n.disk || 0}<small>%</small></div>
      <div class="foot"><div style="display:flex;align-items:center;gap:8px;width:100%"><div class="progress thin" style="flex:1"><div class="${n.disk > 85 ? 'bad' : n.disk > 70 ? 'warn' : 'ok'}" style="width:${n.disk || 0}%"></div></div><span class="tiny muted" style="white-space:nowrap">镜像与日志</span></div></div></div>
    <div class="stat"><div class="lab">本节点工作负载</div><div class="val">${wls.length}<small>个</small></div>
      <div class="foot">端设备 <b>${devs.length}</b> 台 · 回源 ${esc(n.latency)}</div></div>
  </div>

  ${nodeMetricsBlock(n)}

  <div class="grid g21" style="align-items:start">
    <div class="card">
      <div class="card-head"><div class="t">本节点工作负载</div><div class="r tiny muted">按节点标签 env=store 调度</div></div>
      ${wls.length ? `<table class="table">
        <thead><tr><th style="width:27%">工作负载</th><th style="width:19%">应用 / 组件</th><th style="width:31%">镜像</th><th class="right" style="width:9%">CPU</th><th class="right" style="width:9%">内存</th><th>状态</th></tr></thead>
        <tbody>${wls.map((w, i) => `<tr class="clickable" onclick="goto('${wlUrl(w.appId, w.comp, w.name)}')">
          <td class="name mono" style="font-size:11.5px">${esc(w.name)}<div class="sub">${esc(w.kind)}</div></td>
          <td class="tiny">${esc(w.app)}<div class="sub">${esc(w.comp)}</div></td>
          <td class="mono" style="font-size:10.5px;word-break:break-all" title="${esc(w.image)}">${esc(String(w.image).replace(/^[^/]+\//, ''))}</td>
          <td class="num" style="white-space:nowrap">${esc(w.cpu)}</td>
          <td class="num" style="white-space:nowrap">${esc(w.mem)}</td>
          <td>${badge(n.status === '告警' && i === 0 ? '降级' : '运行中')}</td>
        </tr>`).join('')}</tbody>
      </table>` : `<div class="empty" style="padding:30px 16px">
        <h3>该节点没有运行工作负载</h3><p>${n.status === '待激活' ? '节点激活后才会接收调度。' : '可以在「应用分发」里把边缘工作负载下发到该节点。'}</p>
      </div>`}
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card">
        <div class="card-head"><div class="t">节点信息</div></div>
        <div class="card-body">
          <dl class="kv">
            <dt>内网 IP</dt><dd class="mono" style="font-size:11.5px">${esc(n.ip)}</dd>
            <dt>归属集群</dt><dd class="mono" style="font-size:11.5px">${esc(n.cluster)}</dd>
            <dt>容器运行时</dt><dd class="mono" style="font-size:11.5px">${esc(n.runtime)}</dd>
            <dt>接入时间</dt><dd>${esc(n.joinedAt)}</dd>
            <dt>最近同步</dt><dd>${esc(n.sync)}</dd>
            <dt>调度状态</dt><dd>${n.cordoned ? '<span class="badge muted">已封锁</span>' : '<span class="badge ok">可调度</span>'}</dd>
          </dl>
          <div class="sd-sec">节点标签</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">${(n.labels || []).map(l => `<span class="chip">${esc(l)}</span>`).join('')}</div>
          ${n.note ? `<div class="tiny muted" style="margin-top:10px;line-height:1.6">${esc(n.note)}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t">端设备</div><div class="r tiny muted">${devs.length} 台</div></div>
        ${devs.length ? `<table class="table">
          <thead><tr><th>设备</th><th>协议</th><th>状态</th></tr></thead>
          <tbody>${devs.map(d => `<tr class="clickable" onclick="goto('#/edge/devices')">
            <td class="name mono" style="font-size:11px">${esc(d.id)}<div class="sub">${esc(d.type)} · ${esc(d.fw)}</div></td>
            <td><span class="badge outline">${esc(d.proto)}</span></td>
            <td>${badge(d.status)}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<div class="empty" style="padding:22px 16px"><p style="margin:0" class="tiny">该节点还没有接入终端设备。</p></div>'}
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">节点事件</div><div class="r tiny muted">最近 24 小时</div></div>
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

function joinCommand(n) {
  return `curl -sSL https://console.cloudpaas.io/edge/join | sh -s -- --token ${n.token || 'edge-tk-pending'} --node ${n.name} --cluster ${n.cluster}`;
}
function joinModal(name) {
  const n = DB.edge.nodes.find(x => x.name === name);
  if (!n) return;
  openModal({
    title: `接入命令 · ${n.name}`,
    desc: '在门店边缘设备上以 root 执行，Agent 会自动注册并从云端拉取离线包。',
    okText: '复制命令',
    cancelText: '关闭',
    body: `<div class="cmd-box"><code>${esc(joinCommand(n))}</code></div>
      <div class="tiny muted" style="margin-top:12px;line-height:1.8">
        1. 设备需可访问 <span class="mono">console.cloudpaas.io:443</span>；<br>
        2. 首次注册会上报 CPU / 内存 / 磁盘与已装容器运行时；<br>
        3. 令牌 24 小时内有效，过期可在节点详情重新生成。
      </div>`,
    onOk: () => copyText(joinCommand(n))
  });
}
function addEdgeNode() {
  if (!S.modules.edge) return toast('请先启用「云边端协同」模块', 'warn');
  const clusters = DB.clusters.filter(c => c.type.includes('边缘')).map(c => [c.name, c.name]);
  formModal({
    title: '添加边缘节点',
    desc: '登记门店侧设备后生成接入令牌，Agent 执行接入命令即可完成注册。',
    okText: '生成接入令牌',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('节点名称', fInput('name', '', 'edge-sh-031'), '小写字母、数字与连字符，建议 edge-<城市>-<序号>', true)}
        ${fField('设备类型', fSelect('type', ['边缘一体机', '边缘服务器', '边缘网关', '轻量工控机'], '边缘一体机'))}
      </div>
      <div class="form-row">
        ${fField('部署位置', fInput('region', '', '上海 · 静安嘉里中心店'), '「城市 · 门店」，用于区域调度', true)}
        ${fField('归属集群', fSelect('cluster', clusters.length ? clusters : [['edge-sh-store', 'edge-sh-store']], clusters.length ? clusters[0][0] : 'edge-sh-store'))}
      </div>
      ${fField('节点标签', fInput('labels', 'env=store', 'env=store,city=上海'), '逗号分隔，调度与分发策略按标签匹配')}
      ${fField('备注', fInput('note', '', '可选，例如设备 SN 或机房位置'))}`,
    onSubmit: st => {
      const name = String(st.name || '').trim();
      if (!NAME_RE.test(name)) return '节点名称只能是小写字母、数字与连字符';
      if (DB.edge.nodes.some(n => n.name === name)) return `节点 ${name} 已存在`;
      if (!st.region) return '请填写部署位置，例如「上海 · 静安嘉里中心店」';
      const labels = String(st.labels || '').split(',').map(s => s.trim()).filter(Boolean);
      const node = {
        id: `edge-${Date.now().toString(36)}`,
        name,
        region: st.region,
        type: st.type,
        cluster: st.cluster,
        cpu: 0, mem: 0, disk: 0,
        latency: '—',
        status: '待激活',
        wl: 0,
        ver: '—',
        agent: 'v1.8.2',
        sync: '—',
        ip: '—',
        cores: st.type === '边缘服务器' ? 8 : st.type === '边缘网关' ? 2 : 4,
        labels: labels.length ? labels : ['env=store'],
        cordoned: false,
        joinedAt: nowStamp().slice(0, 10),
        runtime: 'containerd 1.7.11',
        note: st.note || '',
        token: `edge-tk-${wHash(name).toString(36)}`
      };
      DB.edge.nodes.push(node);
      saveSnapshot();
      if (location.hash.startsWith('#/edge')) route();
      toast(`节点 ${name} 已登记，等待 Agent 接入`, 'ok');
      setTimeout(() => joinModal(name), 60);
    }
  });
}
function nodeSync(name) {
  const n = DB.edge.nodes.find(x => x.name === name);
  if (!n) return;
  if (n.status === '离线') return toast('节点离线，恢复联网后会自动续传', 'warn');
  n.sync = '刚刚';
  saveSnapshot();
  route();
  toast('已下发增量同步，期望状态与云端一致', 'ok');
}
function nodeCordon(name) {
  const n = DB.edge.nodes.find(x => x.name === name);
  if (!n) return;
  n.cordoned = !n.cordoned;
  saveSnapshot();
  route();
  toast(n.cordoned ? '已封锁调度：不再向该节点分配新实例，存量实例继续运行' : '已解除封锁，节点恢复接收调度', n.cordoned ? 'warn' : 'ok');
}
function nodeActivate(name) {
  const n = DB.edge.nodes.find(x => x.name === name);
  if (!n) return;
  const r = mulberry32(wHash(n.name + 'act'));
  n.status = '在线';
  n.cpu = 18 + Math.floor(r() * 24);
  n.mem = 32 + Math.floor(r() * 26);
  n.disk = 26 + Math.floor(r() * 20);
  n.latency = `${8 + Math.floor(r() * 12)}ms`;
  n.ver = 'v1.8.2';
  n.sync = '刚刚';
  n.ip = `10.${62 + Math.floor(r() * 6)}.${12 + Math.floor(r() * 200)}.${21 + Math.floor(r() * 200)}`;
  normalizeEdge();
  saveSnapshot();
  route();
  toast(`节点 ${name} 已激活，开始接收调度`, 'ok');
}
function nodeRemove(name) {
  const n = DB.edge.nodes.find(x => x.name === name);
  if (!n) return;
  const wl = edgeWorkloadsOn(n).length;
  const devs = (DB.edge.devices || []).filter(d => d.node === name).length;
  openModal({
    title: '移除边缘节点',
    desc: `${n.name} · ${n.region}`,
    danger: true,
    okText: '确认移除',
    body: `<div class="danger-box">
        该节点上的 <b>${wl}</b> 个工作负载实例会被重新调度到其他在线节点${devs ? `，<b>${devs}</b> 台端设备会回到「未绑定」状态` : ''}。
        门店侧 Agent 需要手动卸载后才会停止上报。
      </div>`,
    onOk: () => {
      DB.edge.devices.forEach(d => { if (d.node === name) d.node = '未绑定'; });
      DB.edge.nodes = DB.edge.nodes.filter(x => x.name !== name);
      saveSnapshot();
      goto('#/edge/nodes');
      toast('节点已移除', 'warn');
    }
  });
}

function viewEdgeDistribute() {
  setCrumb('应用分发');
  if (!S.modules.edge) return moduleOffPage('edge', '云边端协同', '边缘应用分发依赖该模块。');
  return `
  <div class="page-head">
    <div><div class="ttl">应用分发</div><div class="sub">把「应用 - 组件 - 工作负载」按策略下发到边缘节点，支持灰度、分批与离线自治。</div></div>
    <div class="acts"><button class="btn primary" onclick="newDist()">${icon('send', '', 14)}新建分发</button></div>
  </div>
  ${edgeBanner()}
  ${edgeTabs('/edge/distribute')}

  <div class="grid g12" style="align-items:start">
    <div class="card">
      <div class="card-head"><div class="t">分发策略</div></div>
      <div class="card-body">
        <div class="section-title">选择器</div>
        <dl class="kv" style="grid-template-columns:78px 1fr">
          <dt>应用</dt><dd>边缘视频分析</dd>
          <dt>组件</dt><dd>infer-engine</dd>
          <dt>工作负载</dt><dd class="mono" style="font-size:11.5px">infer-engine-edge</dd>
        </dl>
        <div class="divider"></div>
        <div class="section-title">目标节点</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <span class="chip teal">区域 = 华东</span><span class="chip teal">节点标签 env=store</span>
        </div>
        <div class="section-title">发布策略</div>
        <dl class="kv" style="grid-template-columns:78px 1fr">
          <dt>分批</dt><dd>先 2 节点灰度 → 全量</dd>
          <dt>窗口</dt><dd>02:00 - 05:00</dd>
          <dt>失败处理</dt><dd>自动回滚上一版本</dd>
          <dt>离线策略</dt><dd>断网保持运行，联网后同步</dd>
        </dl>
        <div class="divider"></div>
        <div class="spread tiny"><span class="muted">镜像预热</span><span class="badge ok">已开启</span></div>
        <div class="spread tiny mt8" style="margin-top:7px"><span class="muted">边缘自治时长</span><span class="mono">最长 72 小时</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="t">分发记录</div><div class="r"><span class="badge ok">3 已完成</span><span class="badge info">1 进行中</span></div></div>
      <table class="table">
        <thead><tr><th>应用 / 组件</th><th>工作负载</th><th>版本</th><th>目标</th><th>策略</th><th>进度</th><th>状态</th><th class="right">时间</th></tr></thead>
        <tbody>${DB.edge.dist.map(d => `
          <tr class="clickable" onclick="distDetail('${d.id}')">
            <td class="name">${esc(d.app)}<div class="sub">${esc(d.comp)}</div></td>
            <td class="mono" style="font-size:11px">${esc(d.wl)}</td>
            <td><span class="chip">${esc(d.ver)}</span></td>
            <td class="tiny">${esc(d.target)}</td>
            <td class="tiny muted">${esc(d.strategy)}</td>
            <td style="min-width:96px"><div style="display:flex;align-items:center;gap:7px">
              <div class="progress thin" style="width:52px"><div class="${d.progress === 100 ? 'ok' : ''}" style="width:${d.progress}%"></div></div>
              <span class="num">${d.progress}%</span></div></td>
            <td>${badge(d.status)}</td>
            <td class="right tiny muted">${d.time}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

function viewEdgeDevices() {
  setCrumb('端设备');
  if (!S.modules.edge) return moduleOffPage('edge', '云边端协同', '端设备管理依赖该模块。');
  return `
  <div class="page-head">
    <div><div class="ttl">端设备</div><div class="sub">门店 POS、电子价签、摄像头等终端接入状态与固件版本。</div></div>
    <div class="acts"><button class="btn" disabled title="批量固件升级尚未开放">批量固件升级</button></div>
  </div>
  ${edgeBanner()}
  ${edgeTabs('/edge/devices')}
  <div class="grid g4" style="margin-bottom:14px">
    ${(() => {
      const ds = DB.edge.devices;
      const on = ds.filter(d => d.status === '在线').length;
      const warn = ds.filter(d => d.status === '告警').length;
      const off = ds.filter(d => d.status === '离线').length;
      const protos = [...new Set(ds.map(d => d.proto))];
      const offNodes = [...new Set(ds.filter(d => d.status === '离线').map(d => d.node))].filter(n => n !== '未绑定');
      return `<div class="stat"><div class="lab">接入设备</div><div class="val">${ds.length}</div><div class="foot">${protos.length} 类协议 · ${protos.join(' / ') || '—'}</div></div>
        <div class="stat"><div class="lab">在线</div><div class="val" style="color:var(--success)">${on}</div><div class="foot">在线率 ${ds.length ? (on / ds.length * 100).toFixed(1) : '0.0'}%</div></div>
        <div class="stat"><div class="lab">告警</div><div class="val" style="color:var(--warning)">${warn}</div><div class="foot">${warn ? '心跳抖动或固件异常' : '无告警设备'}</div></div>
        <div class="stat"><div class="lab">离线</div><div class="val" style="color:var(--danger)">${off}</div><div class="foot">${off ? (offNodes.length ? '所属节点 ' + offNodes.join('、') + ' 异常' : '设备未绑定节点') : '全部在线'}</div></div>`;
    })()}
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索设备 ID / 节点" oninput="listFilter('#devTable', this.value)" /></div>
      <button class="filter-pill on" onclick="listStatus('#devTable','all',this)">全部</button>
      <button class="filter-pill" onclick="listStatus('#devTable','POS',this)">POS</button>
      <button class="filter-pill" onclick="listStatus('#devTable','摄像头',this)">摄像头</button>
      <button class="filter-pill" onclick="listStatus('#devTable','价签',this)">价签</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">心跳周期 30s</span></div>
    </div>
    <table class="table" id="devTable">
      <thead><tr><th>设备 ID</th><th>类型</th><th>协议</th><th>所属边缘节点</th><th>固件</th><th>最近心跳</th><th>状态</th></tr></thead>
      <tbody>${DB.edge.devices.map(d => `
        <tr class="clickable" data-q="${esc(d.id)} ${esc(d.type)} ${esc(d.node)}" data-status="${esc(d.type)}" onclick="deviceDetail('${d.id}')">
          <td class="name mono" style="font-size:11.5px">${esc(d.id)}</td>
          <td><span class="chip">${esc(d.type)}</span></td>
          <td><span class="badge outline">${esc(d.proto)}</span></td>
          <td class="mono" style="font-size:11px">${esc(d.node)}</td>
          <td class="mono" style="font-size:11px">${esc(d.fw)}</td>
          <td class="tiny muted">${d.last}</td>
          <td>${badge(d.status)}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ---------- 模块未启用占位 ---------- */
function moduleOffPage(key, name, why) {
  return `<div class="page-head"><div><div class="ttl">${name}</div></div></div>
  <div class="card"><div class="empty">
    <div class="eic">${icon(key === 'mesh' ? 'share' : 'cloud', '', 22)}</div>
    <h3>${name} 模块未启用</h3>
    <p>${why}<br>该模块为可插拔能力，未启用时不占用任何资源，平台基础功能完整可用。</p>
    <button class="btn primary" onclick="toggleModule('${key}',true)">启用${name}</button>
    <button class="btn" style="margin-left:8px" onclick="location.hash='/admin/modules'">查看模块管理</button>
  </div></div>`;
}

/* ---------- 集群 ---------- */
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
      <button class="btn" onclick="toast('已刷新集群状态')">${icon('refresh', '', 14)}刷新</button>
      <button class="btn primary" onclick="connectCluster()">${icon('plus', '', 14)}接入集群</button>
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
        <tr class="clickable" onclick="goto('#/ops/clusters/${encodeURIComponent(c.name)}')">
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
      <button class="btn primary" onclick="goto('#/ops/clusters')">返回集群列表</button>
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
        <span class="link tiny" onclick="goto('#/ops/clusters')">集群管理</span>
        <span class="muted">/</span>
        <span class="ttl" style="font-size:16px">${esc(c.name)}</span>
        ${badge(c.status)}
      </div>
      <div class="sub">${esc(c.type)} · ${esc(c.region)} · <span class="mono">${esc(c.ver)}</span> · 纳管于 ${esc(c.createdAt)}</div>
    </div>
    <div class="acts">
      ${c.status === '接入中' ? `<button class="btn primary" onclick="clusterVerify('${esc(c.name)}')">${icon('refresh', '', 14)}完成接入校验</button>` : `
        <button class="btn" onclick="clusterMaintain('${esc(c.name)}')">${c.status === '维护中' ? '结束维护' : '设为维护'}</button>`}
      <button class="btn danger" onclick="clusterRemove('${esc(c.name)}')">移除集群</button>
    </div>
  </div>

  ${c.status === '接入中' ? `<div class="approve-banner">
    <div class="ic">${icon('cloud', '', 16)}</div>
    <div class="tx">
      <b>正在接入：Agent 清单已下发</b>
      <p>目标集群执行安装命令后回报 CSR；校验通过即可接管调度。当前节点与容量数据尚未采集。</p>
    </div>
    <button class="btn sm primary" onclick="clusterVerify('${esc(c.name)}')">完成校验</button>
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
          <tbody>${workloads.slice().sort((a, b) => b.replicas - a.replicas).slice(0, 7).map(w => `<tr class="clickable" onclick="goto('${wlUrl(w.appId, w.comp, w.name)}')">
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
        `<button class="filter-pill ${(S.alertSt || 'all') === k ? 'on' : ''}" onclick="alertFilter('${k}')">${n}</button>`).join('')}
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
      ? `<button class="btn sm ghost" onclick="alertAct(${i},'claim')">认领</button>
         <button class="btn sm" onclick="alertAct(${i},'ignore')">忽略</button>`
      : a.status === '处理中'
        ? `<button class="btn sm primary" onclick="alertAct(${i},'close')">关闭</button>`
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
   平台管理 · 环境与角色
   ========================================================== */
function newEnv() {
  const clusters = DB.clusters.map(c => [c.name, `${c.name} · ${c.region}`]);
  if (!clusters.length) return toast('请先接入至少一个集群', 'warn');
  const guards = ['严格模式', '标准模式', '宽松模式'];
  formModal({
    title: '新建环境',
    desc: '环境绑定一个集群与一套变更策略；应用在不同环境间按提升顺序发布。',
    okText: '创建环境',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('环境名称', fInput('name', '', '灰度环境'), '展示名，可中文', true)}
        ${fField('环境编码', fInput('code', '', 'gray'), '小写字母、数字与连字符，用于命名空间前缀', true)}
      </div>
      <div class="form-row">
        ${fField('绑定集群', fSelect('cluster', clusters, clusters[0][0]), '一个环境只绑定一个集群', true)}
        ${fField('变更策略', fSelect('guard', guards, '标准模式'), '严格模式需审批 + 灰度，宽松模式允许热更新')}
      </div>
      ${fField('说明', fInput('note', '', '例如：面向内部测试，每日 02:00 回收'), '发布页会展示这段说明')}`,
    onSubmit: st => {
      const name = String(st.name || '').trim();
      const code = String(st.code || '').trim();
      if (!name) return '请填写环境名称';
      if (!/^[a-z][a-z0-9-]*$/.test(code)) return '环境编码需以小写字母开头，只含小写字母、数字与连字符';
      if (DB.envs.some(e => e.name === name)) return `环境名称 ${name} 已存在`;
      if (DB.envs.some(e => e.code === code)) return `环境编码 ${code} 已存在`;
      const cl = DB.clusters.find(c => c.name === st.cluster) || {};
      DB.envs.push({
        name, code, cluster: st.cluster, region: cl.region || '—',
        status: '健康', workloads: 0, apps: 0, guard: st.guard,
        note: st.note || `${st.guard}：${st.guard === '严格模式' ? '变更需审批 + 灰度' : st.guard === '宽松模式' ? '允许热更新，每日回收' : '自动发布，允许热更新'}`
      });
      saveSnapshot();
      route();
      toast(`环境 ${name} 已创建`, 'ok');
    }
  });
}
function newRole() {
  const scopes = [['全部资源', '全部资源'], ['按环境', '按环境'], ['按应用', '按应用'], ['仅本人创建', '仅本人创建']];
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

/* ==========================================================
   云边端 · 应用分发与端设备
   ========================================================== */
function normalizeEdgeDist() {
  DB.edge.dist.forEach((d, i) => {
    if (!d.id) d.id = `dist-${i + 1}`;
    if (!d.by) d.by = '张明';
    if (!d.window) d.window = '02:00 - 05:00';
    if (!Array.isArray(d.nodes)) d.nodes = distTargets(d.target).map(n => ({
      name: n.name,
      region: n.region,
      status: d.progress >= 100 ? '已完成' : d.status === '待调度' ? '待执行' : d.progress > 0 ? '部署中' : '待执行',
      progress: d.progress >= 100 ? 100 : d.status === '待调度' ? 0 : d.progress
    }));
  });
}
function distTargets(target) {
  const t = String(target || '');
  if (/云端/.test(t)) {
    return DB.clusters.filter(c => !c.type.includes('边缘')).slice(0, 1).map(c => ({ name: c.name, region: c.region }));
  }
  const nodes = DB.edge.nodes;
  if (/华东/.test(t)) return nodes.filter(n => /上海|杭州|南京|苏州/.test(n.region));
  return nodes;
}
function distById(id) { return DB.edge.dist.find(d => d.id === id); }
function newDist() {
  if (!S.modules.edge) return toast('请先启用「云边端协同」模块', 'warn');
  const pool = edgeWorkloadPool();
  if (!pool.length) return toast('还没有调度位置为「边缘」的工作负载', 'warn');
  const opts = pool.map(w => [`${w.app}||${w.comp}||${w.name}`, `${w.app} / ${w.comp} / ${w.name}`]);
  formModal({
    title: '新建分发任务',
    desc: '把边缘工作负载按策略下发到目标节点；失败自动回滚上一版本。',
    okText: '创建并开始分发',
    wide: true,
    body: `
      ${fField('工作负载', fSelect('wl', opts, opts[0][0]), '仅列出调度位置为「边缘」的工作负载', true)}
      <div class="form-row">
        ${fField('目标版本', fInput('ver', '', 'v1.4.3'), '留空则取组件当前版本')}
        ${fField('目标范围', fSelect('scope', [['all', '全部在线节点'], ['region', '指定区域'], ['node', '单个节点']], 'all', ' onchange="distScopeChange()"'))}
      </div>
      <div id="dist-target">${fField('区域关键字', fInput('kw', '上海', '上海'), '按城市匹配节点位置，例如「上海」「成都」')}</div>
      <div class="form-row">
        ${fField('分发策略', fSelect('strategy', ['先灰度 2 节点 → 全量', '按区域分批', '断网自治，联网后同步', '低峰期窗口执行'], '先灰度 2 节点 → 全量'))}
        ${fField('执行窗口', fInput('window', '02:00 - 05:00', '02:00 - 05:00'))}
      </div>`,
    onSubmit: st => {
      const [app, comp, name] = String(st.wl).split('||');
      const appObj = DB.apps.find(a => a.name === app);
      const compObj = appObj && appObj.components.find(c => c.name === comp);
      if (!compObj) return '请选择工作负载';
      const scope = st.scope || 'all';
      let target = '全部门店（全部节点）';
      let matched = DB.edge.nodes.filter(n => n.status !== '离线');
      if (scope === 'region') {
        const kw = String(st.kw || '').trim();
        if (!kw) return '请填写区域关键字';
        matched = matched.filter(n => String(n.region).includes(kw) || String(n.cluster).includes(kw));
        if (!matched.length) return `没有匹配「${kw}」的在线节点`;
        target = `${kw}区（${matched.length} 节点）`;
      } else if (scope === 'node') {
        const kw = String(st.kw || '').trim();
        const node = DB.edge.nodes.find(n => n.name === kw);
        if (!node) return '请填写存在的节点名，例如 edge-sh-007';
        if (node.status === '离线') return `节点 ${kw} 离线，无法分发`;
        matched = [node];
        target = `单节点 ${kw}`;
      } else {
        target = `全部门店（${matched.length} 节点）`;
      }
      const rec = {
        id: `dist-${Date.now().toString(36)}`,
        app, comp, wl: name,
        ver: st.ver || compObj.version || 'v1.0.0',
        target, strategy: st.strategy, status: '进行中', progress: 0,
        time: clockNow(), by: DB.user.name, window: st.window || '02:00 - 05:00',
        nodes: matched.map(n => ({ name: n.name, region: n.region, status: '待执行', progress: 0 }))
      };
      DB.edge.dist.unshift(rec);
      saveSnapshot();
      route();
      toast(`分发任务已创建，目标 ${matched.length} 个节点`, 'ok');
      distRun(rec.id);
    }
  });
}
function distScopeChange() {
  const mask = document.querySelector('.modal-mask:last-child');
  if (!mask) return;
  const d = readForm(mask);
  const box = mask.querySelector('#dist-target');
  if (!box) return;
  box.innerHTML = d.scope === 'node'
    ? fField('节点名', fInput('kw', 'edge-sh-007', 'edge-sh-007'), '只向该节点下发')
    : fField('区域关键字', fInput('kw', d.kw || '上海', '上海'), '按城市匹配节点位置，例如「上海」「成都」');
}
function distRun(id) {
  const step = () => {
    const d = distById(id);
    if (!d || d.progress >= 100) return;
    d.progress = Math.min(100, d.progress + 17);
    (d.nodes || []).forEach((n, i) => {
      const want = Math.min(100, Math.max(0, d.progress - i * 6));
      n.progress = want;
      n.status = want >= 100 ? '已完成' : want > 0 ? '部署中' : '待执行';
    });
    if (d.progress >= 100) {
      d.status = '已完成';
      d.time = clockNow();
      (d.nodes || []).forEach(n => { n.progress = 100; n.status = '已完成'; });
    }
    saveSnapshot();
    if (location.hash.startsWith('#/edge/distribute')) route();
    if (d.progress < 100) setTimeout(step, 1300);
  };
  setTimeout(step, 1200);
}
function distDetail(id) {
  const d = distById(id);
  if (!d) return;
  const nodes = d.nodes || [];
  const done = nodes.filter(n => n.status === '已完成').length;
  openModal({
    title: `分发详情 · ${d.wl}`,
    desc: `${d.app} / ${d.comp} · ${d.ver} · ${d.target}`,
    okText: '重新分发失败节点',
    cancelText: '关闭',
    body: `
      <dl class="kv" style="grid-template-columns:88px 1fr">
        <dt>状态</dt><dd>${badge(d.status)} · ${d.progress}%</dd>
        <dt>策略</dt><dd>${esc(d.strategy)}</dd>
        <dt>执行窗口</dt><dd class="mono">${esc(d.window || '—')}</dd>
        <dt>发起人</dt><dd>${esc(d.by || '—')} · ${esc(d.time || '—')}</dd>
        <dt>节点进度</dt><dd>${done} / ${nodes.length} 已完成</dd>
      </dl>
      <div class="sd-sec">逐节点进度</div>
      ${nodes.length ? `<table class="table">
        <thead><tr><th>节点</th><th>位置</th><th>状态</th><th class="right">进度</th></tr></thead>
        <tbody>${nodes.map(n => `<tr>
          <td class="name mono" style="font-size:11.5px">${esc(n.name)}</td>
          <td class="tiny">${esc(n.region || '—')}</td>
          <td>${badge(n.status === '已完成' ? '已完成' : n.status === '部署中' ? '进行中' : '待调度')}</td>
          <td class="num">${n.progress}%</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="tiny muted">该任务没有可下发的节点。</div>'}`,
    onOk: () => {
      const pending = (d.nodes || []).filter(n => n.status !== '已完成');
      if (d.status === '已完成' || !pending.length) return toast('所有节点都已完成，无需重试', 'ok');
      d.status = '进行中';
      d.progress = 0;
      pending.forEach(n => { n.progress = 0; n.status = '待执行'; });
      saveSnapshot();
      if (location.hash.startsWith('#/edge/distribute')) route();
      toast(`已重新分发 ${pending.length} 个节点`, 'ok');
      distRun(d.id);
    }
  });
}
function deviceDetail(id) {
  const d = (DB.edge.devices || []).find(x => x.id === id);
  if (!d) return;
  const node = DB.edge.nodes.find(n => n.name === d.node);
  openModal({
    title: `设备详情 · ${d.id}`,
    desc: `${d.type} · 协议 ${d.proto}`,
    okText: '知道了',
    cancelText: '关闭',
    body: `
      <dl class="kv" style="grid-template-columns:88px 1fr">
        <dt>状态</dt><dd>${badge(d.status)}</dd>
        <dt>所属节点</dt><dd class="mono" style="font-size:11.5px">${esc(d.node)}${node ? ` · ${esc(node.region)}` : ''}</dd>
        <dt>协议</dt><dd>${esc(d.proto)}</dd>
        <dt>固件版本</dt><dd class="mono" style="font-size:11.5px">${esc(d.fw)}</dd>
        <dt>最近心跳</dt><dd>${esc(d.last)}</dd>
        <dt>心跳周期</dt><dd class="mono">30s</dd>
      </dl>
      <div class="sd-sec">可用操作</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn sm" onclick="devicePing('${esc(d.id)}')">下发探活</button>
        <button class="btn sm" onclick="deviceUpgrade('${esc(d.id)}')">固件升级</button>
        <button class="btn sm" onclick="deviceUnbind('${esc(d.id)}')">解绑设备</button>
      </div>
      <div class="tiny muted" style="margin-top:10px;line-height:1.6">固件升级会先下发到同型号的 5% 设备，观察 24 小时无异常再全量。</div>`
  });
}
function devicePing(id) {
  const d = DB.edge.devices.find(x => x.id === id);
  if (!d) return;
  d.last = '刚刚';
  saveSnapshot();
  closeTopModal();
  if (location.hash.startsWith('#/edge')) route();
  toast(`${d.id} 探活成功，心跳已更新`, 'ok');
}
function deviceUpgrade(id) {
  const d = DB.edge.devices.find(x => x.id === id);
  if (!d) return;
  const m = String(d.fw).match(/^v(\d+)\.(\d+)\.(\d+)$/);
  d.fw = m ? `v${m[1]}.${m[2]}.${+m[3] + 1}` : 'v1.0.1';
  saveSnapshot();
  closeTopModal();
  if (location.hash.startsWith('#/edge')) route();
  toast(`${d.id} 固件已升级到 ${d.fw}`, 'ok');
}
function deviceUnbind(id) {
  const d = DB.edge.devices.find(x => x.id === id);
  if (!d) return;
  d.node = '未绑定';
  d.status = '离线';
  d.last = '—';
  saveSnapshot();
  closeTopModal();
  if (location.hash.startsWith('#/edge')) route();
  toast(`${d.id} 已解绑，需重新配网后才能上线`, 'warn');
}

function viewModules() {
  setCrumb('模块管理');
  return `
  <div class="page-head">
    <div><div class="ttl">模块管理</div>
      <div class="sub">平台采用「稳定内核 + 可插拔模块」架构。Service Mesh 与云边端协同均为独立模块，可随时启用或关闭，关闭不影响基础平台功能。</div></div>
    <div class="acts"><span class="badge info">内核 v4.2.0</span></div>
  </div>

  <div class="card" style="margin-bottom:16px;border-color:#dbe7ff;background:linear-gradient(100deg,#f6f9ff,#fff)">
    <div class="card-body" style="display:flex;align-items:center;gap:14px">
      <div style="width:36px;height:36px;border-radius:10px;background:#fff;border:1px solid #dbe7ff;display:grid;place-items:center;color:var(--primary)">
        ${icon('shield', '', 18)}
      </div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:650">基础内核（始终启用）</div>
        <div class="tiny muted" style="margin-top:2px">应用 - 组件 - 工作负载模型 · 环境与命名空间 · 发布编排 · 集群与节点运维 · 告警与审计 · RBAC</div>
      </div>
      <span class="badge ok">不可关闭</span>
    </div>
  </div>

  <div class="grid g2">
    ${moduleCard({
      key: 'mesh', name: 'Service Mesh', icon: 'share', color: 'var(--primary)', soft: '#eef4ff',
      desc: '基于 Istio + Envoy 的东西向流量治理，提供 Sidecar 注入、mTLS、灰度路由、熔断与拓扑发现。',
      on: S.modules.mesh,
      deps: '依赖：基础内核 · 独立控制面',
      items: [['纳管服务', String(DB.mesh.services.length)],
        ['注入率', `${(DB.mesh.services.filter(x => x.sidecar === '已注入').length / Math.max(1, DB.mesh.services.length) * 100).toFixed(1)}%`],
        ['mTLS', (DB.moduleCfg && DB.moduleCfg.mesh && DB.moduleCfg.mesh.mtls) || '严格模式']],
      caps: ['Sidecar 自动注入', '虚拟服务 / 目标规则', '灰度与流量镜像', 'mTLS 与证书轮换', '服务拓扑与调用链'],
      off_impact: '关闭后服务间通信回归 Kubernetes Service 原生负载均衡，应用无需改造，仅失去精细化治理能力。'
    })}
    ${moduleCard({
      key: 'edge', name: '云边端协同', icon: 'cloud', color: 'var(--teal)', soft: '#e6f7f5',
      desc: '边缘节点纳管、边缘应用分发与端设备接入，支持断网自治、增量同步与多架构镜像分发。',
      on: S.modules.edge,
      deps: '依赖：基础内核 · 边缘 K3s 运行时',
      items: [['边缘节点', String(DB.edge.nodes.length)],
        ['在线率', `${(DB.edge.nodes.filter(x => x.status === '在线').length / Math.max(1, DB.edge.nodes.length) * 100).toFixed(1)}%`],
        ['端设备', String(DB.edge.devices.length)]],
      caps: ['边缘节点纳管', '应用/组件级分发', '按区域分批灰度', '断网自治 72h', '端设备与固件管理'],
      off_impact: '关闭后所有工作负载仅在云端调度，边缘与端侧菜单、分发任务入口自动隐藏，已有边缘工作负载保留运行。'
    })}
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">内置能力（不可关闭）</div><div class="r tiny muted">随内核版本提供</div></div>
    <table class="table">
      <thead><tr><th>能力</th><th>说明</th><th>版本</th><th>状态</th></tr></thead>
      <tbody>
        ${[
          ['应用模型', '应用 → 组件 → 工作负载 三层业务模型与资源树', 'v4.2.0'],
          ['发布编排', '滚动 / 蓝绿 / 灰度 / 分批，支持自动回滚', 'v4.2.0'],
          ['流水线引擎', '可视化阶段编排，内置质量门禁与审批', 'v4.2.0'],
          ['制品仓库', '镜像归档、签名校验、漏洞扫描', 'v3.8.1'],
          ['多环境管理', '环境隔离、配额与提升策略', 'v4.2.0'],
          ['可观测基础', '指标、日志、事件采集与告警', 'v4.2.0'],
          ['权限体系', 'RBAC + 应用级数据权限', 'v4.2.0']
        ].map(([n, d, v]) => `<tr>
          <td class="name">${n}</td><td class="tiny">${d}</td>
          <td class="mono" style="font-size:11px">${v}</td><td><span class="badge ok">启用</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function moduleCard(m) {
  return `
  <div class="card" style="${m.on ? '' : 'border-style:dashed;background:#fbfcfe'}">
    <div class="card-body">
      <div class="spread" style="align-items:flex-start">
        <div style="display:flex;gap:11px;min-width:0">
          <div style="width:34px;height:34px;border-radius:9px;background:${m.on ? m.soft : '#f0f3f9'};display:grid;place-items:center;color:${m.on ? m.color : '#9aa8bf'};flex:0 0 34px">
            ${icon(m.icon, '', 17)}
          </div>
          <div>
            <div style="font-size:13.5px;font-weight:660;display:flex;align-items:center;gap:7px">
              ${m.name} <span class="badge ${m.on ? 'ok' : 'muted'}">${m.on ? '已启用' : '已关闭'}</span>
            </div>
            <div class="tiny muted" style="margin-top:2px">${m.deps}</div>
          </div>
        </div>
        <button class="switch ${m.on ? 'on' : ''}" onclick="toggleModule('${m.key}',${!m.on})" title="${m.on ? '关闭' : '启用'}"></button>
      </div>

      <div style="font-size:12.3px;color:var(--text-2);margin-top:11px;line-height:1.7">${m.desc}</div>

      <div style="display:flex;gap:26px;margin-top:13px;padding:11px 13px;background:${m.on ? m.soft : '#f6f8fc'};border-radius:8px">
        ${m.items.map(([k, v]) => `<div><div class="tiny" style="color:var(--text-3)">${k}</div>
          <div style="font-size:15px;font-weight:660;color:${m.on ? 'var(--text)' : 'var(--text-3)'}">${v}</div></div>`).join('')}
      </div>

      <div style="margin-top:13px">
        <div class="tiny" style="font-weight:660;color:var(--text-3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:7px">模块能力</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${m.caps.map(c => `<span class="chip" style="${m.on ? '' : 'opacity:.55'}">${c}</span>`).join('')}
        </div>
      </div>

      <div class="tiny" style="margin-top:12px;color:${m.on ? 'var(--text-2)' : 'var(--text-3)'};line-height:1.65">
        <b>${m.on ? '关闭影响' : '重新启用'}：</b>${m.off_impact}
      </div>
    </div>
    <div style="padding:9px 16px;border-top:1px solid var(--border);display:flex;gap:7px" class="tiny">
      <button class="btn sm" onclick="location.hash='${m.key === 'mesh' ? '/mesh' : '/edge/nodes'}'" ${m.on ? '' : 'disabled'}>进入模块</button>
      <button class="btn sm ghost" onclick="moduleConfig('${m.key}')">配置</button>
      <button class="btn sm ghost" onclick="moduleDocs('${m.key}')">文档</button>
    </div>
  </div>`;
}

/* ---------- 环境 / 权限 ---------- */
function viewRbac() {
  setCrumb('角色权限');
  return `
  <div class="page-head">
    <div><div class="ttl">角色权限</div><div class="sub">RBAC 按环境与应用维度收敛权限，模块开关仅平台管理员可操作。</div></div>
    <div class="acts"><button class="btn primary" onclick="newRole()">${icon('plus', '', 14)}新建角色</button></div>
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
          <div style="display:flex;gap:9px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer" onclick="location.hash='${r}'">
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
      <button class="btn danger" onclick="resetSnapshot()">${icon('refresh', '', 14)}重置演示数据</button>
    </div>
  </div>`;
}

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
        if (s.createWl) comp.workloads.push(buildWorkload(s, comp));
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
          const b = String(x.backend || '');
          if (b.startsWith(oldName + ':')) x.backend = nextName + b.slice(oldName.length);
        });
        if (S.appComp === oldName) S.appComp = nextName;
        if (S.appWl && !findWl(comp, S.appWl)) S.appWl = null;
      }
      const apply = (k, v, label) => { if (comp[k] !== v) { comp[k] = v; changed.push(label); } };
      apply('role', st.role, '角色');
      apply('owner', st.owner, '负责人');
      apply('repo', st.repo, '代码仓库');
      apply('branch', st.branch || 'main', '分支');
      apply('buildMode', st.buildMode, '构建方式');
      apply('protocol', st.protocol, '协议');
      apply('port', port, '端口');
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
        comp.workloads.push(buildWorkload({
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
      if (!st.name) return '请填写工作负载名称';
      if (!NAME_RE.test(st.name)) return '工作负载名称只能包含小写字母、数字与短横线，并以字母或数字开头';
      if (comp.workloads.some(w => w.name === st.name)) return `组件内已存在工作负载「${st.name}」`;
      const wl = buildWorkload({
        wlName: st.name, wlKind: st.kind, wlReplicas: st.replicas,
        wlWhere: st.where, wlCpu: st.cpu, wlMem: st.mem, wlImage: st.image
      }, comp);
      comp.workloads.push(wl);
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
      comp.workloads = comp.workloads.filter(w => w.name !== wlName);
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
  formModal({
    title: '删除组件？',
    desc: `${app.name} / ${compName}`,
    danger: true,
    okText: '删除组件',
    body: `<div class="danger-box">
        该组件下辖 <b>${wlCount}</b> 个工作负载${boundPipes.length ? `、<b>${boundPipes.length}</b> 条流水线` : ''}，以及它的发布记录与组件作用域配置，将一并删除。
      </div>
      ${app.components.length === 1 ? '<div class="warn-box" style="margin-top:10px">这是应用内最后一个组件，删除后应用将没有任何可部署单元。</div>' : ''}`,
    onSubmit: () => {
      app.components = app.components.filter(c => c.name !== compName);
      DB.pipelines = DB.pipelines.filter(p => !(p.appId === appId && p.comp === compName));
      app.pipelines = app.pipelines.filter(pid => DB.pipelines.some(p => p.id === pid));
      DB.releases = DB.releases.filter(r => !(r.appId === appId && r.comp === compName));
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
      if (st.confirm !== app.name) return `请输入完整名称「${app.name}」以确认删除`;
      if (running.length && !st.force) return `仍有 ${running.length} 个工作负载在运行，请先停用应用，或勾选强制删除`;
      DB.apps = DB.apps.filter(a => a.id !== app.id);
      delete DB.access[app.id];
      delete DB.deps[app.id];
      delete DB.config[app.id];
      DB.pipelines = DB.pipelines.filter(p => p.appId !== app.id);
      DB.releases = DB.releases.filter(r => r.appId !== app.id);
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
function appMenu(app) {
  const stopped = appStatus(app) === '已停止';
  const mask = formModal({
    title: `管理「${app.name}」`,
    desc: '停用只影响调度与入口，不删除任何配置。',
    okText: '关闭',
    plain: true,
    hideCancel: true,
    body: `<div class="menu-list">
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


/* ==========================================================
   路由
   ========================================================== */
function route() {
  const path = location.hash.replace(/^#/, '') || '/overview';
  const seg = path.split('/').filter(Boolean);
  let html = '';

  if (seg[0] === 'overview' || seg.length === 0) html = viewOverview();
  else if (seg[0] === 'apps' && seg[1]) { S.appTab = seg[2] || 'components'; html = viewAppDetail(seg[1]); }
  else if (seg[0] === 'apps') html = viewApps();
  else if (seg[0] === 'workloads' && seg[1]) html = viewWorkloadDetail(
    decodeURIComponent(seg[1]), decodeURIComponent(seg[2] || ''), decodeURIComponent(seg[3] || ''));
  else if (seg[0] === 'components') html = viewComponents();
  else if (seg[0] === 'workloads') html = viewWorkloads();
  else if (seg[0] === 'access') html = viewAccessList();
  else if (seg[0] === 'cicd' && seg[1]) html = viewPipeline(seg[1], seg[2]);
  else if (seg[0] === 'cicd') html = viewCicd();
  else if (seg[0] === 'artifacts') html = viewArtifacts();
  else if (seg[0] === 'mesh' && seg[1] === 'traffic') html = viewMeshTraffic();
  else if (seg[0] === 'mesh' && seg[1] === 'topology') html = viewMeshTopology();
  else if (seg[0] === 'mesh' && seg[1] === 'tracing') html = viewMeshTracing();
  else if (seg[0] === 'mesh') html = viewMesh();
  else if (seg[0] === 'edge' && seg[1] === 'nodes' && seg[2]) html = viewEdgeNode(decodeURIComponent(seg[2]));
  else if (seg[0] === 'edge' && seg[1] === 'nodes') html = viewEdgeNodes();
  else if (seg[0] === 'edge' && seg[1] === 'distribute') html = viewEdgeDistribute();
  else if (seg[0] === 'edge' && seg[1] === 'devices') html = viewEdgeDevices();
  else if (seg[0] === 'edge') html = viewEdgeNodes();
  else if (seg[0] === 'storage') html = viewStorage();
  else if (seg[0] === 'ops' && seg[1] === 'clusters' && seg[2]) html = viewCluster(decodeURIComponent(seg[2]));
  else if (seg[0] === 'ops' && seg[1] === 'clusters') html = viewClusters();
  else if (seg[0] === 'ops' && seg[1] === 'alerts') html = viewAlerts();
  else if (seg[0] === 'ops') html = viewClusters();
  else if (seg[0] === 'admin' && seg[1] === 'modules') html = viewModules();
  else if (seg[0] === 'admin' && seg[1] === 'rbac') html = viewRbac();
  else if (seg[0] === 'design') html = viewDesign();
  else html = viewOverview();

  $('#view').innerHTML = html;
  renderSidebar();
  document.querySelectorAll('#view .chart').forEach(bindChart);
  if (LOG_TIMER) { clearInterval(LOG_TIMER); LOG_TIMER = null; }
  if (seg[0] === 'workloads' && seg[1]) mountWorkload();
  window.scrollTo({ top: 0 });
}

/* ---------------- 启动 ---------------- */
normalizeModel();
migrateRefs();
normalizeIO();
normalizeEdge();
normalizeClusters();
normalizeEdgeDist();
window.addEventListener('hashchange', route);
renderTopbar();
renderSidebar();
route();
