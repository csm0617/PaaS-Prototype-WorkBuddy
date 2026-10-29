/* ==========================================================
   CloudPaaS Console — 原型交互
   可插拔内核：Service Mesh / 云边端协同 均为独立模块，关闭后基础功能不受影响
   ========================================================== */

const DB = window.DB;
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
  pipelineTab: 'overview'
};

/* ---------------- 演示数据快照 ----------------
   原型里的新建/删除/扩缩容会写入 localStorage，刷新后依然保留；
   需要回到初始演示数据时，可在「设计说明」页重置。 */
function loadSnapshot() {
  try {
    const raw = localStorage.getItem(LS_DB);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && d.v === 1) {
      if (Array.isArray(d.apps)) DB.apps = d.apps;
      if (d.access && typeof d.access === 'object') DB.access = d.access;
    }
  } catch (e) { /* 快照损坏时退回 data.js 初始数据 */ }
}
function saveSnapshot() {
  try {
    localStorage.setItem(LS_DB, JSON.stringify({ v: 1, apps: DB.apps, access: DB.access }));
  } catch (e) { /* 存储不可用时降级为纯内存态 */ }
}
function resetSnapshot() {
  try { localStorage.removeItem(LS_DB); } catch (e) { /* 忽略 */ }
  location.reload();
}
loadSnapshot();

/* ---------------- 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function num(n) { return Number(n).toLocaleString('en-US'); }

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
  '警告': 'warn', '提示': 'muted', 'P0': 'bad', 'P1': 'warn', 'P2': 'muted'
};
function badge(t, k) { return `<span class="badge ${k || STK[t] || 'muted'}">${t === '运行中' || t === '健康' || t === '在线' ? '<i></i>' : ''}${esc(t)}</span>`; }
function pbadge(t) {
  const m = { '运行中': 'info', '成功': 'ok', '失败': 'bad', '已完成': 'ok', '进行中': 'info', '待调度': 'muted' };
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
  refresh: '<path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8"/><path d="M13.6 2.4v3.4h-3.4"/>',
  plus: '<path d="M8 3.4v9.2M3.4 8h9.2"/>',
  chev: '<path d="M6 4l4 4-4 4"/>'
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
      { label: '服务拓扑', icon: 'topo', route: '/mesh/topology' }
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
      { label: '告警中心', icon: 'bell', route: '/ops/alerts' }
    ]
  },
  {
    label: '平台管理', items: [
      { label: '模块管理', icon: 'puzzle', route: '/admin/modules' },
      { label: '环境管理', icon: 'layers', route: '/admin/envs' },
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
  const envMap = { prod: '生产', staging: '预发', dev: '测试' };
  $('#topbar').innerHTML = `
    <div class="crumb">控制台<span class="sep">/</span><b id="crumbCur">概览</b></div>
    <div class="seg" id="envSeg">
      ${Object.entries(envMap).map(([k, v]) => `<button class="${S.env === k ? 'on' : ''}" data-env="${k}">${v}</button>`).join('')}
    </div>
    <div class="search">
      ${icon('search', '', 14)}
      <input placeholder="搜索应用 / 组件 / 工作负载" />
      <kbd>F</kbd>
    </div>
    <button class="icon-btn" title="帮助">${icon('help', '', 16)}</button>
    <button class="icon-btn" title="告警" onclick="location.hash='/ops/alerts'">${icon('bell', '', 16)}<span class="dot-red"></span></button>
    <div class="avatar" title="${DB.user.name} · ${DB.user.role}">${DB.user.avatar}</div>`;

  $('#envSeg').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      S.env = b.dataset.env;
      localStorage.setItem(LS_ENV, S.env);
      renderTopbar(); route();
      toast(`已切换到${b.textContent}环境`);
    };
  });
}
function setCrumb(t) { const e = $('#crumbCur'); if (e) e.textContent = t; }

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
function fSelect(k, opts, value) {
  return `<select class="input" data-k="${k}">${opts.map(o => {
    const v = Array.isArray(o) ? o[0] : o, n = Array.isArray(o) ? o[1] : o;
    return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(n)}</option>`;
  }).join('')}</select>`;
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
    mesh: { name: 'Service Mesh', off: '服务治理、流量规则、服务拓扑、Sidecar 注入与 mTLS 将不可用；应用发布仍按原生 Service 负载均衡执行。' },
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
      <div class="sub">当前环境 <b>${env.name}</b> · 集群 <span class="mono">${env.cluster}</span> · 数据更新于 1 分钟前</div>
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
      <div class="search" style="margin:0;width:200px">${icon('search', '', 14)}<input placeholder="搜索应用" /></div>
      <button class="btn primary" onclick="newApp()">${icon('plus', '', 14)}新建应用</button>
    </div>
  </div>

  <div class="grid g3">
    ${DB.apps.map(a => {
      const wlCount = a.components.reduce((s, c) => s + c.workloads.length, 0);
      return `<div class="card" style="cursor:pointer;transition:.16s" onclick="location.hash='/apps/${a.id}'"
        onmouseover="this.style.boxShadow='var(--shadow)';this.style.transform='translateY(-1px)'"
        onmouseout="this.style.boxShadow='var(--shadow-sm)';this.style.transform='none'">
        <div class="card-body">
          <div class="spread">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span style="color:var(--primary)">${icon('box', '', 16)}</span>
              <span style="font-size:13.5px;font-weight:650">${esc(a.name)}</span>
              ${badge(a.level)}
            </div>
            ${badge(a.status)}
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
            <div><div class="tiny muted">组件</div><div style="font-size:16px;font-weight:660">${a.components.length}</div></div>
            <div><div class="tiny muted">工作负载</div><div style="font-size:16px;font-weight:660">${wlCount}</div></div>
            <div><div class="tiny muted">健康度</div><div style="font-size:16px;font-weight:660;color:${a.health > 97 ? 'var(--success)' : a.health > 90 ? 'var(--warning)' : a.health > 0 ? 'var(--danger)' : 'var(--text-3)'}">${a.health > 0 ? a.health + '<span style="font-size:10px">%</span>' : '—'}</div></div>
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
  if (!S.appComp || !app.components.find(c => c.name === S.appComp)) S.appComp = app.components[0] ? app.components[0].name : null;

  const wlCount = app.components.reduce((s, c) => s + c.workloads.length, 0);
  const meshOn = S.modules.mesh;

  const tabs = [
    { k: 'overview', n: '概览' },
    { k: 'components', n: '组件与工作负载', c: app.components.length },
    { k: 'topology', n: '组件拓扑' },
    { k: 'access', n: '访问入口', c: (DB.access[app.id] || []).filter(x => x.status === '已生效').length },
    { k: 'pipelines', n: '流水线', c: app.pipelines.length },
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
        ${badge(app.level)} ${badge(app.status)}
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
      <button class="btn" onclick="location.hash='/cicd'">${icon('flow', '', 14)}发布</button>
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
      <div><div class="tiny muted">健康度</div><div style="font-weight:600;margin-top:2px;color:var(--success)">${app.health || '—'}%</div></div>
      <div><div class="tiny muted">部署环境</div><div style="margin-top:2px;display:flex;gap:5px">${app.envs.map(e => `<span class="chip">${e}</span>`).join('')}</div></div>
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
    const comp = app.components.find(c => c.name === S.appComp) || app.components[0];
    if (!comp) {
      return `<div class="empty" style="padding:38px 20px">
        <div class="eic">${icon('layers', '', 22)}</div>
        <h3>这个应用还没有组件</h3>
        <p>组件是构建与发布的边界，对应一个镜像与版本；工作负载从组件派生。先创建第一个组件。</p>
        <button class="btn primary" onclick="newComponent('${app.id}')">${icon('plus', '', 14)}新建组件</button>
      </div>`;
    }
    const wl = comp.workloads.find(w => w.name === S.appWl);

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
            <div class="d mono" style="margin-top:2px">${esc(comp.image)}:${esc(comp.version)} · ${esc(comp.runtime)}</div>
          </div>
          <div class="r">
            <button class="btn sm ghost" onclick="newWorkload('${app.id}','${comp.name}')">${icon('plus', '', 12)}工作负载</button>
            <button class="btn sm" onclick="toast('组件配置（原型）')">配置</button>
            <button class="btn sm primary" onclick="toast('已触发组件发布')">${icon('send', '', 12)}发布</button>
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
                <td class="num">${esc(w.ready)}</td>
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
            <button class="btn sm ghost" onclick="S.appWl=null;route()">收起</button>
          </div>
          <div class="grid g2" style="gap:16px">
            <dl class="kv">
              <dt>镜像</dt><dd class="mono">${esc(wl.image)}</dd>
              <dt>副本</dt><dd>${esc(wl.ready)} 就绪</dd>
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
            <button class="btn sm" onclick="toast('查看日志（原型）')">日志</button>
            <button class="btn sm" onclick="toast('进入容器终端（原型）')">终端</button>
            <button class="btn sm" onclick="toast('工作负载 YAML（原型）')">YAML</button>
            <button class="btn sm" onclick="toast('已重启工作负载')">${icon('refresh', '', 12)}重启</button>
            <button class="btn sm danger" style="margin-left:auto" onclick="deleteWorkload('${app.id}','${comp.name}','${wl.name}')">删除</button>
          </div>
        </div>` : ''}
      </div>
    </div>`;
  }

  if (S.appTab === 'topology') return appTopologyView(app);
  if (S.appTab === 'access') return appAccessView(app);

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
    return `<div class="grid g2">
      <div class="card" style="box-shadow:none">
        <div class="card-head"><div class="t">配置项</div><div class="r"><button class="btn sm" onclick="toast('新增配置项（原型）')">${icon('plus', '', 12)}新增</button></div></div>
        <table class="table">
          <thead><tr><th>Key</th><th>Value</th><th>生效范围</th></tr></thead>
          <tbody>
            <tr><td class="name mono">ORDER_TIMEOUT_MS</td><td class="mono">800</td><td><span class="chip">全部组件</span></td></tr>
            <tr><td class="name mono">INVENTORY_ENDPOINT</td><td class="mono">http://inventory-service:8080</td><td><span class="chip">order-service</span></td></tr>
            <tr><td class="name mono">LOG_LEVEL</td><td class="mono">info</td><td><span class="chip">全部组件</span></td></tr>
            <tr><td class="name mono">FEATURE_SPLIT_ORDER</td><td class="mono">true</td><td><span class="chip">order-service</span></td></tr>
          </tbody>
        </table>
      </div>
      <div class="card" style="box-shadow:none">
        <div class="card-head"><div class="t">密钥引用</div><div class="r tiny muted">仅引用，不落地明文</div></div>
        <table class="table">
          <thead><tr><th>名称</th><th>类型</th><th>值</th><th>更新</th></tr></thead>
          <tbody>
            <tr><td class="name">order-db-secret</td><td><span class="chip">Opaque</span></td><td class="mono">••••••••</td><td class="tiny muted">12 天前</td></tr>
            <tr><td class="name">pay-sign-key</td><td><span class="chip">TLS</span></td><td class="mono">••••••••</td><td class="tiny muted">3 天前</td></tr>
            <tr><td class="name">registry-pull</td><td><span class="chip">DockerCfg</span></td><td class="mono">••••••••</td><td class="tiny muted">30 天前</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
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
  const names = app.components.map(c => c.name);
  const edges = (DB.deps[app.id] || []).filter(([a, b]) => names.includes(a) && names.includes(b));
  const { pos, width, height } = layoutGraph(names, edges);

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
    const p = pos[c.name];
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
        <button class="btn sm" onclick="toast('编辑依赖关系（原型）')">编辑依赖</button>
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
      <button class="btn primary" onclick="toast('新增访问入口（原型）')">新增入口</button>
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
        <button class="btn primary" onclick="toast('新增访问入口（原型）')">${icon('plus', '', 13)}新增入口</button>
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
        <div style="display:flex;gap:2px;flex:0 0 auto">
          <button class="btn sm ghost" onclick="copyText('${esc(e.url)}')">复制</button>
          <button class="btn sm ghost" onclick="openAccess('${app.id}','${esc(e.url)}')">链路</button>
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
  const comp = app.components.find(c => c.name === host)
    || app.components.find(c => c.workloads.some(w => w.name === host));
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
        ${wls.map(w => `<span class="chip" style="font-size:10.5px">${esc(w.name)} · ${w.ready}</span>`).join('')}
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
      <button class="btn">证书管理</button>
      <button class="btn primary" onclick="toast('新增访问入口（原型）')">${icon('plus', '', 14)}新增入口</button>
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
      <div class="grow"><button class="btn sm">导出</button></div>
    </div>
    <div style="overflow-x:auto">
    <table class="table">
      <thead><tr><th>工作负载</th><th>所属应用 / 组件</th><th>类型</th><th>副本</th><th>状态</th><th>调度</th><th>集群</th><th>CPU</th><th class="right">重启</th></tr></thead>
      <tbody>
        ${list.map(w => `<tr class="clickable" onclick="location.hash='/apps/${w.appId}'">
          <td class="name">${esc(w.name)}<div class="sub mono">${esc(w.image)}</div></td>
          <td>${esc(w.app)}<div class="sub">${esc(w.comp)}</div></td>
          <td><span class="chip">${esc(w.kind)}</span></td>
          <td class="num">${esc(w.ready)}</td>
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

/* ---------- 流水线列表 ---------- */
function viewCicd() {
  setCrumb('流水线');
  const total = DB.pipelines.length;
  return `
  <div class="page-head">
    <div><div class="ttl">持续交付</div>
      <div class="sub">流水线绑定「应用 - 组件」，构建产物推送至制品仓库后按环境策略发布。</div></div>
    <div class="acts">
      <button class="btn">模板</button>
      <button class="btn primary" onclick="toast('新建流水线向导（原型）')">${icon('plus', '', 14)}新建流水线</button>
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
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索流水线" /></div>
      <button class="filter-pill on">全部</button>
      <button class="filter-pill">运行中</button>
      <button class="filter-pill">失败</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">自动刷新 · 30s</span></div>
    </div>
    <table class="table">
      <thead><tr><th>流水线</th><th>应用 / 组件</th><th>触发</th><th>分支</th><th>最近运行</th><th>状态</th><th>成功率</th><th class="right">操作</th></tr></thead>
      <tbody>${DB.pipelines.map(p => `
        <tr class="clickable" onclick="location.hash='/cicd/${p.id}'">
          <td class="name">${esc(p.name)}</td>
          <td>${esc(p.app)}<div class="sub">${esc(p.comp)}</div></td>
          <td><span class="chip">${esc(p.trigger)}</span></td>
          <td class="mono" style="font-size:11px">${esc(p.branch)}</td>
          <td>${p.last}</td>
          <td>${pbadge(p.status)}</td>
          <td><div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:52px"><div class="${p.success > 95 ? 'ok' : 'warn'}" style="width:${p.success}%"></div></div><span class="num">${p.success}%</span></div></td>
          <td class="right"><button class="btn sm" onclick="event.stopPropagation();toast('已触发运行')">运行</button></td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ---------- 流水线详情 ---------- */
function viewPipeline(id) {
  const p = DB.pipelines.find(x => x.id === id) || DB.pipelines[0];
  setCrumb(p.name);
  return `
  <div class="page-head">
    <div>
      <div style="display:flex;align-items:center;gap:9px">
        <span class="link tiny" onclick="location.hash='/cicd'">流水线</span>
        <span class="muted">/</span>
        <span class="ttl" style="font-size:16px">${esc(p.name)}</span>
        ${pbadge(p.status)}
      </div>
      <div class="sub">${esc(p.app)} · 组件 <b>${esc(p.comp)}</b> · 触发 <b>${esc(p.trigger)}</b> · 分支 <span class="mono">${esc(p.branch)}</span></div>
    </div>
    <div class="acts">
      <button class="btn" onclick="toast('已终止运行')">终止</button>
      <button class="btn primary" onclick="toast('已重新运行')">${icon('refresh', '', 14)}重新运行</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="t">阶段流程</div><div class="r tiny muted">本次运行 #218 · 14:36 开始</div></div>
    <div class="card-body">
      <div class="stage-flow">
        ${p.stages.map(s => `
          <div class="stage ${s.s}">
            <div class="box">
              <div class="h"><span class="stg-dot ${s.s}"></span><span class="nm">${esc(s.n)}</span></div>
              <div class="du">${s.s === 'run' ? '<span style="color:var(--primary)">执行中 ' + s.d + '</span>' : s.d}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="grid g21">
    <div class="card">
      <div class="card-head"><div class="t">运行日志</div><div class="r"><span class="chip">#218</span><button class="btn sm ghost" onclick="toast('已复制日志')">复制</button></div></div>
      <div class="card-body" style="padding:12px">
        <div class="logbox">
          ${p.logs.map(([t, k, m]) => `<div><span class="t">${t}</span>  <span class="${k}">${esc(m)}</span></div>`).join('')}
          ${p.status === '运行中' ? '<div><span class="t">14:40:55</span>  <span class="k">▌</span></div>' : ''}
        </div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card">
        <div class="card-head"><div class="t">质量门禁</div></div>
        <div class="card-body">
          ${[['单元测试通过率', '100%', true], ['代码覆盖率', '78.2% / ≥70%', true], ['镜像漏洞（高危）', '0 个', true], ['回归用例', '248 / 250', false]]
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
            <dt>策略</dt><dd>灰度发布（10% → 50% → 100%）</dd>
            <dt>审批人</dt><dd>应用负责人 + 运维值班</dd>
            <dt>回滚</dt><dd>自动回滚（错误率 &gt; 1%）</dd>
          </dl>
        </div>
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">构建历史</div><div class="r tiny muted">共 ${p.runs} 次</div></div>
    <table class="table">
      <thead><tr><th>编号</th><th>状态</th><th>提交</th><th>分支</th><th>触发人</th><th>耗时</th><th class="right">时间</th></tr></thead>
      <tbody>${p.history.map(h => `
        <tr class="clickable" onclick="toast('查看构建 ${h.no} 详情（原型）')">
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
    <div class="acts"><button class="btn">扫描策略</button><button class="btn primary">拉取指令</button></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:240px">${icon('search', '', 14)}<input placeholder="搜索镜像" /></div>
      <button class="filter-pill on">全部</button><button class="filter-pill">云端 amd64</button><button class="filter-pill">边缘 arm64</button>
    </div>
    <table class="table">
      <thead><tr><th>镜像</th><th>版本</th><th>大小</th><th>架构</th><th>扫描</th><th>推送人</th><th class="right">推送时间</th></tr></thead>
      <tbody>${arts.map(a => `
        <tr>
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
  const t = [['/mesh', '服务治理'], ['/mesh/traffic', '流量规则'], ['/mesh/topology', '服务拓扑']];
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
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索服务" /></div>
      <button class="filter-pill on">全部</button><button class="filter-pill">异常</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">控制面 istiod v1.21.3 · 数据面 Envoy 1.29</span></div>
    </div>
    <table class="table">
      <thead><tr><th>服务</th><th>命名空间</th><th>版本</th><th>Sidecar</th><th>QPS</th><th>成功率</th><th>P99</th><th>实例</th><th>状态</th></tr></thead>
      <tbody>${DB.mesh.services.map(s => `
        <tr>
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

function viewMeshTraffic() {
  setCrumb('流量规则');
  if (!S.modules.mesh) return moduleOffPage('mesh', 'Service Mesh', '流量规则依赖 Service Mesh 提供的数据面能力。');
  return `
  <div class="page-head">
    <div><div class="ttl">流量规则</div><div class="sub">虚拟服务与目标规则统一编排，支持灰度、超时重试、熔断与流量镜像。</div></div>
    <div class="acts"><button class="btn primary" onclick="toast('新建流量规则（原型）')">${icon('plus', '', 14)}新建规则</button></div>
  </div>
  ${meshBanner()}
  ${meshTabs('/mesh/traffic')}

  <div class="grid g21">
    <div class="card">
      <div class="card-head"><div class="t">规则列表</div><div class="r"><span class="badge ok">4 生效中</span></div></div>
      <table class="table">
        <thead><tr><th>规则名</th><th>类型</th><th>目标服务</th><th>匹配条件</th><th>动作</th><th>状态</th></tr></thead>
        <tbody>${DB.mesh.rules.map(r => `
          <tr class="clickable" onclick="toast('编辑规则 ${r.name}（原型）')">
            <td class="name mono" style="font-size:11.5px">${esc(r.name)}</td>
            <td><span class="chip ${r.type === '虚拟服务' ? 'blue' : 'purple'}">${esc(r.type)}</span></td>
            <td>${esc(r.host)}</td>
            <td class="mono" style="font-size:11px">${esc(r.match)}</td>
            <td class="tiny">${esc(r.action)}</td>
            <td>${badge(r.status)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-head"><div class="t">灰度权重</div><div class="r tiny muted">order-service-canary</div></div>
      <div class="card-body">
        <div style="font-size:11.5px;color:var(--text-3);margin-bottom:12px">按权重在版本间分流</div>
        ${[['v2.4.1（当前）', 90, 'var(--primary)'], ['v2.5.0（灰度）', 10, 'var(--warning)']].map(([n, w, c]) => `
          <div style="margin-bottom:13px">
            <div class="spread" style="font-size:12px;margin-bottom:5px"><span>${n}</span><span class="mono">${w}%</span></div>
            <div class="progress"><div style="width:${w}%;background:${c}"></div></div>
          </div>`).join('')}
        <div class="divider"></div>
        <dl class="kv" style="grid-template-columns:88px 1fr">
          <dt>超时</dt><dd class="mono">800ms</dd>
          <dt>重试</dt><dd>3 次 / 退避 25ms</dd>
          <dt>熔断</dt><dd>连续 5 次 5xx 隔离 30s</dd>
          <dt>镜像</dt><dd>10% 采样至 shadow</dd>
        </dl>
        <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px" onclick="toast('权重已更新')">应用权重</button>
      </div>
    </div>
  </div>`;
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
    svg += `<g>
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

function viewEdgeNodes() {
  setCrumb('边缘节点');
  if (!S.modules.edge) return moduleOffPage('edge', '云边端协同', '边缘节点纳管依赖该模块。启用后可纳管门店边缘节点并下发边缘工作负载。');
  const on = DB.edge.nodes.filter(n => n.status === '在线').length;
  return `
  <div class="page-head">
    <div><div class="ttl">边缘节点</div><div class="sub">门店边缘侧算力纳管，支持离线自治与联网后增量同步。</div></div>
    <div class="acts"><button class="btn">接入指引</button><button class="btn primary" onclick="toast('添加边缘节点（原型）')">${icon('plus', '', 14)}添加节点</button></div>
  </div>
  ${edgeBanner()}
  ${edgeTabs('/edge/nodes')}
  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">边缘节点</div><div class="val">8</div><div class="foot">覆盖 5 个城市</div></div>
    <div class="stat"><div class="lab">在线率</div><div class="val">${(on / 8 * 100).toFixed(1)}<small>%</small></div><div class="foot"><span class="down">1</span> 离线 · <span class="warn" style="color:var(--warning);font-weight:600">1</span> 告警</div></div>
    <div class="stat"><div class="lab">边缘工作负载</div><div class="val">41</div><div class="foot">跨 8 个节点调度</div></div>
    <div class="stat"><div class="lab">平均回源延迟</div><div class="val">14<small>ms</small></div><div class="foot">云边链路健康</div></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索节点 / 区域" /></div>
      <button class="filter-pill on">全部</button><button class="filter-pill">在线</button><button class="filter-pill">离线</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">节点版本 v1.8.2 统一</span></div>
    </div>
    <table class="table">
      <thead><tr><th>节点</th><th>位置</th><th>类型</th><th>CPU</th><th>内存</th><th>回源延迟</th><th>工作负载</th><th>最近同步</th><th>状态</th></tr></thead>
      <tbody>${DB.edge.nodes.map(n => `
        <tr class="clickable" onclick="toast('节点详情 ${n.name}（原型）')">
          <td class="name mono" style="font-size:11.5px">${esc(n.name)}<div class="sub">${esc(n.ver)}</div></td>
          <td>${esc(n.region)}</td>
          <td><span class="chip">${esc(n.type)}</span></td>
          <td>${n.cpu ? `<div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:56px"><div class="${n.cpu > 80 ? 'bad' : n.cpu > 65 ? 'warn' : 'ok'}" style="width:${n.cpu}%"></div></div><span class="num">${n.cpu}%</span></div>` : '<span class="muted">—</span>'}</td>
          <td>${n.mem ? `<div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:56px"><div class="${n.mem > 85 ? 'bad' : n.mem > 70 ? 'warn' : 'ok'}" style="width:${n.mem}%"></div></div><span class="num">${n.mem}%</span></div>` : '<span class="muted">—</span>'}</td>
          <td class="num">${n.latency}</td>
          <td class="num">${n.wl}</td>
          <td class="tiny muted">${n.sync}</td>
          <td>${badge(n.status)}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function viewEdgeDistribute() {
  setCrumb('应用分发');
  if (!S.modules.edge) return moduleOffPage('edge', '云边端协同', '边缘应用分发依赖该模块。');
  return `
  <div class="page-head">
    <div><div class="ttl">应用分发</div><div class="sub">把「应用 - 组件 - 工作负载」按策略下发到边缘节点，支持灰度、分批与离线自治。</div></div>
    <div class="acts"><button class="btn primary" onclick="toast('新建分发任务（原型）')">${icon('send', '', 14)}新建分发</button></div>
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
          <tr class="clickable" onclick="toast('分发详情（原型）')">
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
    <div class="acts"><button class="btn">批量固件升级</button></div>
  </div>
  ${edgeBanner()}
  ${edgeTabs('/edge/devices')}
  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">接入设备</div><div class="val">150</div><div class="foot">4 类协议 · MQTT / BLE / RTSP / HTTP</div></div>
    <div class="stat"><div class="lab">在线</div><div class="val" style="color:var(--success)">146</div><div class="foot">在线率 97.3%</div></div>
    <div class="stat"><div class="lab">告警</div><div class="val" style="color:var(--warning)">1</div><div class="foot">POS 心跳抖动</div></div>
    <div class="stat"><div class="lab">离线</div><div class="val" style="color:var(--danger)">3</div><div class="foot">所属节点 edge-cd-011 离线</div></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <div class="search" style="margin:0;width:220px">${icon('search', '', 14)}<input placeholder="搜索设备 ID" /></div>
      <button class="filter-pill on">全部</button><button class="filter-pill">POS</button><button class="filter-pill">摄像头</button><button class="filter-pill">价签</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">心跳周期 30s</span></div>
    </div>
    <table class="table">
      <thead><tr><th>设备 ID</th><th>类型</th><th>协议</th><th>所属边缘节点</th><th>固件</th><th>最近心跳</th><th>状态</th></tr></thead>
      <tbody>${DB.edge.devices.map(d => `
        <tr class="clickable" onclick="toast('设备详情 ${d.id}（原型）')">
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
function viewClusters() {
  setCrumb('集群管理');
  return `
  <div class="page-head">
    <div><div class="ttl">集群管理</div><div class="sub">云端 Kubernetes 集群与边缘 K3s 集群统一纳管。</div></div>
    <div class="acts"><button class="btn primary" onclick="toast('接入集群（原型）')">${icon('plus', '', 14)}接入集群</button></div>
  </div>
  <div class="card">
    <table class="table">
      <thead><tr><th>集群</th><th>类型</th><th>区域</th><th>版本</th><th>节点</th><th>CPU</th><th>内存</th><th>Pod</th><th>状态</th></tr></thead>
      <tbody>${DB.clusters.map(c => `
        <tr class="clickable" onclick="toast('集群详情（原型）')">
          <td class="name mono" style="font-size:11.5px">${esc(c.name)}</td>
          <td><span class="chip ${c.type.includes('边缘') ? 'teal' : ''}">${esc(c.type)}</span></td>
          <td>${esc(c.region)}</td>
          <td class="mono" style="font-size:11px">${esc(c.ver)}</td>
          <td class="num">${c.nodes}</td>
          <td class="num">${c.cpu}%</td>
          <td class="num">${c.mem}%</td>
          <td class="num">${c.pods}</td>
          <td>${badge(c.status)}</td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function viewAlerts() {
  setCrumb('告警中心');
  return `
  <div class="page-head">
    <div><div class="ttl">告警中心</div><div class="sub">按严重程度聚合，支持静默、认领与升级通知。</div></div>
    <div class="acts"><button class="btn">告警规则</button><button class="btn">通知渠道</button></div>
  </div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="lab">严重</div><div class="val" style="color:var(--danger)">2</div><div class="foot">需立即处理</div></div>
    <div class="stat"><div class="lab">警告</div><div class="val" style="color:var(--warning)">3</div><div class="foot">2 处理中</div></div>
    <div class="stat"><div class="lab">今日已恢复</div><div class="val">11</div><div class="foot">平均恢复 8m</div></div>
    <div class="stat"><div class="lab">静默中</div><div class="val">1</div><div class="foot">证书到期提醒</div></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <button class="filter-pill on">全部</button><button class="filter-pill">未处理</button><button class="filter-pill">处理中</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">最近 24 小时</span></div>
    </div>
    <table class="table">
      <thead><tr><th>级别</th><th>告警内容</th><th>关联应用</th><th>资源</th><th>时间</th><th>状态</th><th class="right">操作</th></tr></thead>
      <tbody>${DB.alerts.map(a => `
        <tr>
          <td>${badge(a.level)}</td>
          <td class="name">${esc(a.title)}</td>
          <td>${esc(a.app)}</td>
          <td class="mono" style="font-size:11px">${esc(a.res)}</td>
          <td class="tiny muted">${a.time}</td>
          <td>${badge(a.status)}</td>
          <td class="right"><button class="btn sm ghost" onclick="toast('已认领')">认领</button></td>
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ---------- 模块管理（核心） ---------- */
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
      items: [['纳管服务', '8'], ['注入率', '87.5%'], ['mTLS', '严格模式']],
      caps: ['Sidecar 自动注入', '虚拟服务 / 目标规则', '灰度与流量镜像', 'mTLS 与证书轮换', '服务拓扑与调用链'],
      off_impact: '关闭后服务间通信回归 Kubernetes Service 原生负载均衡，应用无需改造，仅失去精细化治理能力。'
    })}
    ${moduleCard({
      key: 'edge', name: '云边端协同', icon: 'cloud', color: 'var(--teal)', soft: '#e6f7f5',
      desc: '边缘节点纳管、边缘应用分发与端设备接入，支持断网自治、增量同步与多架构镜像分发。',
      on: S.modules.edge,
      deps: '依赖：基础内核 · 边缘 K3s 运行时',
      items: [['边缘节点', '8'], ['在线率', '87.5%'], ['端设备', '150']],
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
      <button class="btn sm ghost" onclick="toast('模块配置（原型）')">配置</button>
      <button class="btn sm ghost" onclick="toast('查看模块文档（原型）')">文档</button>
    </div>
  </div>`;
}

/* ---------- 环境 / 权限 ---------- */
function viewEnvs() {
  setCrumb('环境管理');
  return `
  <div class="page-head">
    <div><div class="ttl">环境管理</div><div class="sub">环境绑定集群与配额，定义应用在环境间的提升策略。</div></div>
    <div class="acts"><button class="btn primary" onclick="toast('新建环境（原型）')">${icon('plus', '', 14)}新建环境</button></div>
  </div>
  <div class="grid g3">
    ${DB.envs.map(e => `
      <div class="card">
        <div class="card-body">
          <div class="spread"><div style="font-size:13.5px;font-weight:650">${e.name}</div>${badge(e.status)}</div>
          <div class="tiny mono muted" style="margin-top:2px">${e.code}</div>
          <div class="divider"></div>
          <dl class="kv" style="grid-template-columns:66px 1fr">
            <dt>集群</dt><dd class="mono" style="font-size:11px">${e.cluster}</dd>
            <dt>区域</dt><dd>${e.region}</dd>
            <dt>应用</dt><dd>${e.apps} 个</dd>
            <dt>工作负载</dt><dd>${e.workloads} 个</dd>
            <dt>策略</dt><dd>${e.guard}</dd>
          </dl>
          <div class="tiny muted" style="margin-top:10px;padding-top:9px;border-top:1px solid var(--border)">${e.note}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

function viewRbac() {
  setCrumb('角色权限');
  return `
  <div class="page-head">
    <div><div class="ttl">角色权限</div><div class="sub">RBAC 按环境与应用维度收敛权限，模块开关仅平台管理员可操作。</div></div>
    <div class="acts"><button class="btn primary" onclick="toast('新建角色（原型）')">${icon('plus', '', 14)}新建角色</button></div>
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
          ['组件拓扑', '应用详情 → 组件拓扑，按依赖分层，点节点可下钻', '/apps/retail-platform'],
          ['访问入口', '应用详情 → 访问入口，查看域名与网关路径两种形态', '/apps/retail-platform'],
          ['全局入口视图', '应用管理 → 访问入口，跨应用汇总所有对外地址', '/access'],
          ['流水线阶段', '选择一条运行中的流水线查看阶段流程与实时日志', '/cicd/pl-order'],
          ['跨端调度视图', '工作负载页按「边缘 / 端侧」筛选', '/workloads'],
          ['服务拓扑', 'Service Mesh → 服务拓扑，查看调用关系与异常链路', '/mesh/topology']
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
const RUNTIMES = ['Java 17 · Spring Boot 3.2', 'Go 1.22', 'Node.js 20', 'Python 3.12', 'Rust 1.77', 'Envoy 1.29', 'Nginx 1.25'];
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
    name: src.wlName,
    kind,
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
      compRuntime: 'Java 17 · Spring Boot 3.2', compVersion: 'v1.0.0',
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
            ${fField('部署环境', fSelect('env', ['生产环境', '预发环境', '测试环境'], s.env))}
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
              ${fField('运行时', fSelect('compRuntime', RUNTIMES, s.compRuntime))}
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
            <dt>组件</dt><dd>${s.createComp ? `<span class="mono">${esc(s.compName)}</span> · ${esc(s.compRole)} · ${esc(s.compVersion)}` : '<span class="muted">暂不创建</span>'}</dd>
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
        const comp = {
          name: s.compName,
          role: s.compRole,
          runtime: s.compRuntime,
          image: s.compImage || `hub.corp.io/demo/${s.compName}`,
          version: s.compVersion || 'v1.0.0',
          workloads: []
        };
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
        ${fField('运行时', fSelect('runtime', RUNTIMES, 'Java 17 · Spring Boot 3.2'))}
      </div>
      <div class="form-row">
        ${fField('镜像仓库', fInput('image', '', '默认 hub.corp.io/demo/<组件名>'))}
        ${fField('初始版本', fInput('version', 'v1.0.0'))}
      </div>
      ${fCheck('withWl', '同时创建默认工作负载', true, `Deployment · 2 副本 · ${clusterOf('云端')}`)}`,
    onSubmit: st => {
      if (!st.name) return '请填写组件名称';
      if (!NAME_RE.test(st.name)) return '组件名称只能包含小写字母、数字与短横线，并以字母或数字开头';
      if (app.components.some(c => c.name === st.name)) return `应用内已存在组件「${st.name}」`;
      const comp = {
        name: st.name,
        role: st.role,
        runtime: st.runtime,
        image: st.image || `hub.corp.io/demo/${st.name}`,
        version: st.version || 'v1.0.0',
        workloads: []
      };
      if (st.withWl) {
        comp.workloads.push(buildWorkload({
          wlName: `${st.name}-api`, wlKind: 'Deployment', wlReplicas: '2',
          wlWhere: '云端', wlCpu: '1 / 2c', wlMem: '2 / 4Gi'
        }, comp));
      }
      app.components.push(comp);
      app.updated = nowStamp();
      if (app.health === 0) app.health = 100;
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
  const comp = app && app.components.find(c => c.name === compName);
  if (!comp) return;
  formModal({
    title: '新建工作负载',
    desc: `归属于组件「${comp.name}」。工作负载是调度的最小单位，决定副本、资源与调度位置。`,
    okText: '创建工作负载',
    body: `
      ${fField('工作负载名称', fInput('name', '', `例如：${comp.name}-api`), '小写字母、数字与短横线', true)}
      <div class="form-row">
        ${fField('类型', fSelect('kind', WL_KINDS, 'Deployment'))}
        ${fField('副本数', fInput('replicas', '2', '2', 'number'), 'CronJob 无需副本')}
      </div>
      <div class="form-row">
        ${fField('调度位置', fSelect('where', wlSpots(), '云端'))}
        ${fField('镜像版本', fInput('image', comp.version))}
      </div>
      <div class="form-row">
        ${fField('CPU 规格', fSelect('cpu', ['0.2 / 1c', '0.5 / 2c', '1 / 2c', '2 / 4c', '4 / 8c'], '1 / 2c'))}
        ${fField('内存规格', fSelect('mem', ['512Mi / 1Gi', '1Gi / 2Gi', '2 / 4Gi', '4 / 8Gi', '8 / 16Gi'], '2 / 4Gi'))}
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
      app.events.unshift({ t: clockNow(), k: 'ok', tx: `工作负载 <b>${esc(wl.name)}</b> 已创建（${esc(wl.kind)} · ${esc(wl.ready)}）` });
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
  const comp = app && app.components.find(c => c.name === compName);
  const wl = comp && comp.workloads.find(w => w.name === wlName);
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
  const comp = app && app.components.find(c => c.name === compName);
  if (!comp) return;
  const wlCount = comp.workloads.length;
  formModal({
    title: '删除组件？',
    desc: `${app.name} / ${compName}`,
    danger: true,
    okText: '删除组件',
    body: `<div class="danger-box">
        该组件下辖 <b>${wlCount}</b> 个工作负载，将一并删除；绑定到该组件的流水线需要重新指定构建对象。
      </div>
      ${app.components.length === 1 ? '<div class="warn-box" style="margin-top:10px">这是应用内最后一个组件，删除后应用将没有任何可部署单元。</div>' : ''}`,
    onSubmit: () => {
      app.components = app.components.filter(c => c.name !== compName);
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
  formModal({
    title: '删除应用？',
    desc: `${app.name} · ${app.level}`,
    danger: true,
    okText: '删除应用',
    body: `<div class="danger-box">
        将级联删除 <b>${app.components.length}</b> 个组件、<b>${wlCount}</b> 个工作负载，以及该应用的访问入口与依赖声明。
      </div>
      ${fField('输入应用名称确认', fInput('confirm', '', app.name), `需完整输入「${app.name}」`)}`,
    onSubmit: st => {
      if (st.confirm !== app.name) return `请输入完整名称「${app.name}」以确认删除`;
      DB.apps = DB.apps.filter(a => a.id !== app.id);
      delete DB.access[app.id];
      delete DB.deps[app.id];
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
  const stopped = app.status === '已停止';
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
    app.status = stopped ? '运行中' : '已停止';
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
      const cur = parseInt(String(wl.ready).split('/')[0], 10);
      return `<div class="scale-row">
        <div class="nm"><b>${esc(wl.name)}</b><span>${esc(comp)} · ${esc(wl.kind)} · ${esc(wl.where)}</span></div>
        <span class="cur">当前 ${Number.isFinite(cur) ? cur : 0}</span>
        <input type="number" min="0" max="50" data-k="r${i}" value="${Number.isFinite(cur) ? cur : 0}" />
      </div>`;
    }).join(''),
    onSubmit: st => {
      const changes = [];
      rows.forEach(({ wl }, i) => {
        const before = parseInt(String(wl.ready).split('/')[0], 10) || 0;
        const n = clampInt(st['r' + i], 0, 50, before);
        if (n === before) return;
        wl.ready = `${n}/${n}`;
        wl.status = n === 0 ? '已停止' : '运行中';
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
  else if (seg[0] === 'workloads') html = viewWorkloads();
  else if (seg[0] === 'access') html = viewAccessList();
  else if (seg[0] === 'cicd' && seg[1]) html = viewPipeline(seg[1]);
  else if (seg[0] === 'cicd') html = viewCicd();
  else if (seg[0] === 'artifacts') html = viewArtifacts();
  else if (seg[0] === 'mesh' && seg[1] === 'traffic') html = viewMeshTraffic();
  else if (seg[0] === 'mesh' && seg[1] === 'topology') html = viewMeshTopology();
  else if (seg[0] === 'mesh') html = viewMesh();
  else if (seg[0] === 'edge' && seg[1] === 'distribute') html = viewEdgeDistribute();
  else if (seg[0] === 'edge' && seg[1] === 'devices') html = viewEdgeDevices();
  else if (seg[0] === 'edge') html = viewEdgeNodes();
  else if (seg[0] === 'ops' && seg[1] === 'alerts') html = viewAlerts();
  else if (seg[0] === 'ops') html = viewClusters();
  else if (seg[0] === 'admin' && seg[1] === 'modules') html = viewModules();
  else if (seg[0] === 'admin' && seg[1] === 'envs') html = viewEnvs();
  else if (seg[0] === 'admin' && seg[1] === 'rbac') html = viewRbac();
  else if (seg[0] === 'design') html = viewDesign();
  else html = viewOverview();

  $('#view').innerHTML = html;
  renderSidebar();
  window.scrollTo({ top: 0 });
}

/* ---------------- 启动 ---------------- */
window.addEventListener('hashchange', route);
renderTopbar();
renderSidebar();
route();
