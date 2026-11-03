/* ==========================================================
   视图：概览、应用列表/详情、组件拓扑、访问入口、全局组件视图
   ========================================================== */

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
      <button class="btn" ${act('toast', '已刷新')}>${icon('refresh', '', 14)}刷新</button>
      <button class="btn primary" ${act('newApp')}>${icon('plus', '', 14)}新建应用</button>
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
        <div class="r"><span class="badge info">运行中</span><span class="link tiny" ${act('go', '/mesh')}>进入 →</span></div>
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
        <div class="r"><button class="btn sm" ${act('toggleModule', 'mesh', true)}>启用</button></div>
      </div>
      <div class="card-body tiny muted" style="padding-top:0">未启用时不占用任何资源，基础发布与负载均衡由 Kubernetes Service 原生承担。</div>
    </div>`}

    ${S.modules.edge ? `
    <div class="card">
      <div class="card-head">
        <span style="color:var(--teal)">${icon('cloud', '', 15)}</span>
        <div><div class="t">云边端协同</div><div class="d">可插拔模块 · 已启用</div></div>
        <div class="r"><span class="badge teal">运行中</span><span class="link tiny" ${act('go', '/edge/nodes')}>进入 →</span></div>
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
        <div class="r"><button class="btn sm" ${act('toggleModule', 'edge', true)}>启用</button></div>
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
        <div style="padding:10px 16px" class="tiny"><span class="link" ${act('go', '/ops/alerts')}>查看全部告警 →</span></div>
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">最近流水线</div><div class="r"><span class="link tiny" ${act('go', '/cicd')}>全部流水线 →</span></div></div>
    <table class="table">
      <thead><tr><th>流水线</th><th>所属应用</th><th>触发</th><th>最近运行</th><th>状态</th><th class="right">成功率</th></tr></thead>
      <tbody>
        ${DB.pipelines.slice(0, 5).map(p => `
          <tr class="clickable" ${act('go', `/cicd/${p.id}`)}>
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

/* ---------- 列表状态与 URL 同步 ---------- */
const LIST_DEFAULTS = {
  apps: { sort: { key: 'updated', dir: 'desc' } },
  comps: { sort: { key: 'name', dir: 'asc' } },
  wls: { sort: { key: 'name', dir: 'asc' } },
  access: { sort: { key: 'app', dir: 'asc' } }
};
function hydrateListState(seg, p) {
  let key = null;
  if (seg[0] === 'apps' && !seg[1]) key = 'apps';
  else if (seg[0] === 'components') key = 'comps';
  else if (seg[0] === 'workloads' && !seg[1]) key = 'wls';
  else if (seg[0] === 'access') key = 'access';
  if (!key) return;
  const d = LIST_DEFAULTS[key];
  const val = (name, fb) => p.has(name) ? p.get(name) : fb;
  S.page[key] = Math.max(1, Number(val('page', 1)) || 1);
  const sortKey = val('sort', d.sort.key);
  S.sort[key] = {
    key: (SORT_GETTERS[key] || {})[sortKey] ? sortKey : d.sort.key,
    dir: val('dir', d.sort.dir) === 'desc' ? 'desc' : 'asc'
  };
  if (key === 'apps') S.appQ = val('q', '');
  if (key === 'comps') { S.compQ = val('q', ''); S.compApp = val('app', 'all'); S.compFilter = val('filter', 'all'); }
  if (key === 'wls') { S.wlQ = val('q', ''); S.wlFilter = val('filter', 'all'); }
  if (key === 'access') { S.accessQ = val('q', ''); S.accessType = val('type', 'all'); S.accessStatus = val('status', 'all'); }
}
function syncListUrl(key, route) {
  const p = new URLSearchParams();
  if (key === 'apps' && S.appQ) p.set('q', S.appQ);
  if (key === 'comps') {
    if (S.compQ) p.set('q', S.compQ);
    if (S.compApp !== 'all') p.set('app', S.compApp);
    if (S.compFilter !== 'all') p.set('filter', S.compFilter);
  }
  if (key === 'wls') {
    if (S.wlQ) p.set('q', S.wlQ);
    if (S.wlFilter !== 'all') p.set('filter', S.wlFilter);
  }
  if (key === 'access') {
    if (S.accessQ) p.set('q', S.accessQ);
    if (S.accessType !== 'all') p.set('type', S.accessType);
    if (S.accessStatus !== 'all') p.set('status', S.accessStatus);
  }
  if (S.page[key] > 1) p.set('page', S.page[key]);
  const s = S.sort[key], d = LIST_DEFAULTS[key].sort;
  if (s.key !== d.key || s.dir !== d.dir) { p.set('sort', s.key); p.set('dir', s.dir); }
  const qs = p.toString();
  try { history.replaceState(null, '', `#${route}${qs ? '?' + qs : ''}`); }
  catch (err) { /* file:// 等受限环境下降级为不写 URL，列表功能仍可用 */ }
}
function syncAppsUrl() { syncListUrl('apps', '/apps'); }
function syncCompsUrl() { syncListUrl('comps', '/components'); }
function syncWlsUrl() { syncListUrl('wls', '/workloads'); }
function syncAccessUrl() { syncListUrl('access', '/access'); }

function appListData() {
  const q = S.appQ.trim().toLowerCase();
  const filtered = DB.apps.filter(a => !q || [a.name, a.domain, a.owner, a.desc].join(' ').toLowerCase().includes(q));
  return { filtered, meta: paginate(applySort(filtered, 'apps'), 'apps', PAGE_SIZE.apps) };
}
function appCards(list) {
  return list.map(a => {
    const wlCount = a.components.reduce((s, c) => s + c.workloads.length, 0);
    const pend = accessPending(a.id).count;
    return `<div class="card" style="cursor:pointer;transition:.16s" data-q="${esc(a.name)} ${esc(a.domain)} ${esc(a.owner)} ${esc(a.desc)}" ${act('go', `/apps/${a.id}`)}
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
          const p = (DB.access[a.id] || []).find(x => x.status === '已生效' && x.scope === '公网')
            || (DB.access[a.id] || []).find(x => x.status === '已生效');
          return p
            ? `<div style="display:flex;align-items:center;gap:5px;margin-top:7px;min-width:0">
                 <span style="color:var(--text-3);display:flex;flex:0 0 auto">${icon('globe', '', 12)}</span>
                 <span class="mono" style="font-size:11px;color:var(--primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.url)}</span>
               </div>`
            : `<div class="tiny muted" style="margin-top:7px">${(DB.access[a.id] || []).length ? '访问入口已停用' : '未配置访问入口'}</div>`;
        })()}
        <div style="display:flex;gap:18px;margin-top:12px">
          <div class="link" title="查看该应用的组件" ${act('openComponentsOf', `${a.id}`)} data-stop="1">
            <div class="tiny muted">组件</div><div style="font-size:16px;font-weight:660;color:inherit">${a.components.length}</div></div>
          <div class="link" title="查看该应用的工作负载" ${act('openWorkloadsOfApp', `${a.id}`)} data-stop="1">
            <div class="tiny muted">工作负载</div><div style="font-size:16px;font-weight:660;color:inherit">${wlCount}</div></div>
          <div><div class="tiny muted">健康度</div><div style="font-size:16px;font-weight:660;color:${healthText(a).color}">${healthText(a).v}${healthText(a).v === '—' ? '' : '<span style="font-size:10px">%</span>'}</div></div>
        </div>
      </div>
      <div style="padding:9px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px" class="tiny muted">
        <span class="chip">${esc(a.domain)}</span>
        ${pend ? `<span class="badge warn" title="访问入口有变更待发布">入口待发布 ${pend}</span>` : ''}
        <span style="margin-left:auto">${esc(a.owner)} · ${a.updated.slice(5, 16)}</span>
      </div>
    </div>`;
  }).join('');
}
function viewApps() {
  setCrumb('应用列表');
  if (!DB.apps.length) {
    return `<div class="page-head">
      <div><div class="ttl">应用</div>
        <div class="sub">应用是业务交付单元，下辖若干组件，组件进一步展开为工作负载。</div></div>
      <div class="acts"><button class="btn primary" ${act('newApp')}>${icon('plus', '', 14)}新建应用</button></div>
    </div>
    <div class="card"><div class="empty">
      <div class="eic">${icon('box', '', 22)}</div>
      <h3>还没有应用</h3>
      <p>新建第一个应用后，就能在它下面创建组件与工作负载，形成完整的三层模型。</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn primary" ${act('newApp')}>${icon('plus', '', 14)}新建应用</button>
        <button class="btn" ${act('resetSnapshot')}>重置演示数据</button>
      </div>
    </div></div>`;
  }
  const { filtered, meta } = appListData();
  const sortVal = `${S.sort.apps.key}:${S.sort.apps.dir}`;
  return `
  <div class="page-head">
    <div>
      <div class="ttl">应用</div>
      <div class="sub">应用是业务交付单元，下辖若干组件，组件进一步展开为工作负载。</div>
    </div>
    <div class="acts">
      <div class="search" style="margin:0;width:210px">${icon('search', '', 14)}<input id="app-q" placeholder="搜索应用 / 业务域 / 负责人" value="${esc(S.appQ)}" oninput="appQuery(this.value)" /></div>
      <select class="input" style="width:130px;height:30px;padding:0 8px;font-size:12px" onchange="appSortSet(this.value)">
        <option value="updated:desc"${sortVal === 'updated:desc' ? ' selected' : ''}>最近更新</option>
        <option value="name:asc"${sortVal === 'name:asc' ? ' selected' : ''}>名称 A-Z</option>
        <option value="health:desc"${sortVal === 'health:desc' ? ' selected' : ''}>健康度</option>
        <option value="wl:desc"${sortVal === 'wl:desc' ? ' selected' : ''}>工作负载数</option>
      </select>
      <span class="tiny muted" id="apps-count">${filtered.length} 个应用</span>
      <button class="btn primary" ${act('newApp')}>${icon('plus', '', 14)}新建应用</button>
    </div>
  </div>

  <div class="grid g3" id="appsGrid">${filtered.length ? appCards(meta.rows) : `
    <div class="card" style="grid-column:1/-1"><div class="empty" style="padding:34px 16px">
      <h3>没有匹配的应用</h3><p>换个关键词，或清空搜索查看全部应用。</p>
      <button class="btn" ${act('clearAppQ')}>清空搜索</button>
    </div></div>`}</div>
  <div id="apps-pager">${pager('apps', meta, '个应用')}</div>`;
}
function paintApps() {
  const grid = $('#appsGrid');
  if (!grid) return;
  const { filtered, meta } = appListData();
  grid.innerHTML = filtered.length ? appCards(meta.rows) : `
    <div class="card" style="grid-column:1/-1"><div class="empty" style="padding:34px 16px">
      <h3>没有匹配的应用</h3><p>换个关键词，或清空搜索查看全部应用。</p>
      <button class="btn" ${act('clearAppQ')}>清空搜索</button>
    </div></div>`;
  const pg = $('#apps-pager');
  if (pg) pg.innerHTML = pager('apps', meta, '个应用');
  const cnt = $('#apps-count');
  if (cnt) cnt.textContent = `${filtered.length} 个应用`;
}
function appQuery(v) { S.appQ = v; S.page.apps = 1; syncAppsUrl(); paintApps(); }
function clearAppQ() { S.appQ = ''; S.page.apps = 1; const i = $('#app-q'); if (i) i.value = ''; syncAppsUrl(); paintApps(); }
function appSortSet(v) {
  const [key, dir] = String(v).split(':');
  S.sort.apps = { key, dir: dir === 'desc' ? 'desc' : 'asc' };
  S.page.apps = 1;
  syncAppsUrl();
  paintApps();
}

/* ---------- 应用详情 ---------- */
/* 模型校验：组件、工作负载、依赖、入口与发布记录的引用一致性 */
function validateAppModel(app) {
  const issues = [];
  const add = (level, title, detail) => issues.push({ level, title, detail });
  if (!app.components.length) add('warn', '应用没有组件', '先创建组件，才能继续定义工作负载与访问入口。');

  const names = new Set();
  const keys = new Set();
  app.components.forEach(c => {
    if (names.has(c.name)) add('error', `组件名称重复：${c.name}`, '组件名称必须在一个应用内唯一。');
    names.add(c.name);
    keys.add(c.name);
    if (c.id) keys.add(c.id);
    if (!c.workloads.length) add('warn', `组件 ${c.name} 没有工作负载`, '该组件尚未关联可部署单元。');
    else if (!c.workloads.some(w => w.id === c.primaryWorkloadId)) add('error', `组件 ${c.name} 缺少主工作负载引用`, '请重新保存组件配置或创建负载，系统会补齐主负载。');
    if (!(Number(c.port) >= 1 && Number(c.port) <= 65535)) add('error', `组件 ${c.name} 端口非法`, `当前端口为 ${c.port || '—'}，应在 1-65535 之间。`);
  });

  (DB.deps[app.id] || []).forEach(([from, to]) => {
    if (!keys.has(from)) add('error', `依赖上游不存在：${from}`, '组件依赖引用了已删除的组件。');
    if (!keys.has(to)) add('error', `依赖下游不存在：${to}`, '组件依赖引用了已删除的组件。');
  });

  const urls = new Set();
  (DB.access[app.id] || []).forEach(e => {
    if (urls.has(e.url)) add('error', `入口地址重复：${e.url}`, '同一应用内不能有两条相同地址。');
    urls.add(e.url);
    const target = accessTarget(app, e);
    if (!target) add('error', `入口 ${e.url} 的目标组件不存在`, `当前指向 ${accessBackend(e)}，请改绑或删除入口。`);
    else if (!accessPorts(target).includes(Number(e.port))) add('error', `入口 ${e.url} 端口与组件不一致`, `组件 ${target.name} 声明端口为 ${accessPorts(target).join(' / ')}，入口为 ${e.port || '—'}。`);
  });
  const pending = accessPending(app.id);
  if (pending.count) add('warn', `${pending.count} 条访问入口变更待发布`, '当前展示的是期望配置，发布成功后才会切换为已生效版本。');

  DB.pipelines.filter(p => p.appId === app.id).forEach(p => {
    if (!names.has(p.comp)) add('error', `流水线 ${p.name} 绑定的组件不存在`, `当前绑定 ${p.comp}，请重新选择组件或删除流水线。`);
  });
  DB.releases.filter(r => r.appId === app.id && r.comp && !names.has(r.comp)).forEach(r => {
    add('warn', `历史发布关联的组件已删除`, `${r.comp} · ${r.version}，仅作为历史记录保留。`);
  });

  if (!issues.length) add('ok', '未发现模型问题', '组件、依赖、入口与流水线引用一致。');
  return issues;
}

function modelAudit(appId) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  const issues = validateAppModel(app);
  const color = { error: 'var(--danger)', warn: 'var(--warning)', ok: 'var(--success)' };
  openModal({
    title: `模型校验 · ${app.name}`,
    desc: '检查组件、工作负载、依赖、访问入口与流水线之间的引用一致性。',
    okText: '知道了',
    cancelText: '关闭',
    wide: true,
    body: `<div style="display:grid;gap:8px">${issues.map(x => `
      <div style="display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid var(--border);border-radius:8px">
        <span style="color:${color[x.level]};font-weight:700;flex:0 0 auto">${x.level === 'ok' ? '✓' : '!'}</span>
        <div><b style="font-size:12.5px">${esc(x.title)}</b><div class="tiny muted" style="margin-top:2px">${esc(x.detail)}</div></div>
      </div>`).join('')}</div>`
  });
}

function viewAppDetail(id) {
  const app = DB.apps.find(a => a.id === id) || DB.apps[0];
  if (!app) {
    setCrumb('应用');
    return `<div class="empty">
      <div class="eic">${icon('box', '', 22)}</div>
      <h3>没有可展示的应用</h3>
      <p>演示数据中的最后一条应用已被删除。可以新建一个应用，或重置演示数据。</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn primary" ${act('newApp')}>${icon('plus', '', 14)}新建应用</button>
        <button class="btn" ${act('resetSnapshot')}>重置演示数据</button>
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
          <button class="btn sm ghost" style="height:22px;padding:0 6px" ${act('copyText', `${esc(primary.url)}`)}>${icon('copy', '', 11)}复制</button>`
        : `<span class="tiny muted">未配置对外访问入口</span>`}
      </div>
    </div>
    <div class="acts">
      <button class="btn" ${act('modelAudit', `${app.id}`)}>校验</button>
      <button class="btn" ${act('releaseApp', `${app.id}`)}>${icon('send', '', 14)}发布</button>
      <button class="btn" ${act('scaleAppById', `${app.id}`)}>扩缩容</button>
      <button class="btn" ${act('appMenuById', `${app.id}`)}>···</button>
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
      ${tabs.map(t => `<div class="tab ${S.appTab === t.k ? 'on' : ''}" ${act('setAppTab', `${t.k}`)}>
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
              return `<tr class="clickable" ${act('gotoComp', `${c.name}`)}>
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
        <button class="btn primary" ${act('newComponent', `${app.id}`)}>${icon('plus', '', 14)}新建组件</button>
      </div>`;
    }
    const wl = findWl(comp, S.appWl);

    return `
    <div class="grid g12" style="align-items:start">
      <div class="card" style="box-shadow:none">
        <div class="card-head" style="padding:11px 14px">
          <div class="t" style="font-size:12px">资源树</div>
          <div class="r">
            <button class="mini-act" title="新建组件" ${act('newComponent', `${app.id}`)}>${icon('plus', '', 13)}</button>
          </div>
        </div>
        <div class="card-body" style="padding:8px">
          <div class="tree">
            <div class="tree-node" style="font-weight:600;color:var(--text);cursor:default">
              ${icon('box', '', 14)}<span class="nm">${esc(app.name)}</span>
            </div>
            <div class="tree-lead">组件 · ${app.components.length}</div>
            ${app.components.map(c => `
              <div class="tree-node lvl2 ${c.name === comp.name ? 'on' : ''}" ${act('selectComp', `${c.name}`)}>
                ${icon('layers', '', 13)}<span class="nm">${esc(c.name)}</span><span class="ct">${c.workloads.length}</span>
              </div>
              ${c.name === comp.name ? c.workloads.map(w => `
                <div class="tree-node lvl3 ${w.name === S.appWl ? 'on' : ''}" ${act('selectWl', `${w.name}`)}>
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
              <span class="chip ver" title="查看版本历史" ${act('componentVersions', `${app.id}`, `${comp.name}`)}>${esc(comp.version)}</span>
              <span class="chip proto" title="对外协议">${esc(comp.protocol || 'HTTP')}</span>
              ${(() => {
                const d = compDeps(app.id, comp.name);
                return d.up.map(x => `<span class="chip" title="上游调用方 · ${esc(x.l || '')}">← ${esc(x.n)}</span>`).join('')
                  + d.down.map(x => `<span class="chip" title="下游依赖 · ${esc(x.l || '')}">→ ${esc(x.n)}</span>`).join('');
              })()}
            </div>
          </div>
          <div class="r">
            <button class="btn sm ghost" ${act('newWorkload', `${app.id}`, `${comp.name}`)}>${icon('plus', '', 12)}工作负载</button>
            <button class="btn sm" ${act('componentConfig', `${app.id}`, `${comp.name}`)}>配置</button>
            <button class="btn sm primary" ${act('releaseApp', `${app.id}`, `${comp.name}`)}>${icon('send', '', 12)}发布</button>
            <button class="mini-act danger" title="删除组件" ${act('deleteComponent', `${app.id}`, `${comp.name}`)}>${icon('archive', '', 13)}</button>
          </div>
        </div>
        <table class="table">
          <thead><tr>
            <th>工作负载</th><th>类型</th><th>副本</th><th>状态</th><th>调度</th>
            <th>CPU / 内存</th>${meshOn ? '<th>Mesh</th>' : ''}<th class="right">重启</th>
          </tr></thead>
          <tbody>
            ${comp.workloads.length ? comp.workloads.map(w => `
              <tr class="clickable" ${act('selectWl', `${w.name}`)}>
                <td class="name">${esc(w.name)}${w.id === comp.primaryWorkloadId ? '<span class="badge info" style="margin-left:6px">主负载</span>' : ''}<div class="sub mono">${esc(w.image)}</div></td>
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
                  <button class="btn sm primary" ${act('newWorkload', `${app.id}`, `${comp.name}`)}>${icon('plus', '', 12)}新建工作负载</button>
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
              <button class="btn sm primary" ${act('wlOpen', `${app.id}`, `${comp.name}`, `${wl.name}`, 'overview')}>打开详情</button>
              <button class="btn sm ghost" ${act('clearWl')}>收起</button>
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
            <button class="btn sm" ${act('wlOpen', `${app.id}`, `${comp.name}`, `${wl.name}`, 'logs')}>日志</button>
            <button class="btn sm" ${act('wlOpen', `${app.id}`, `${comp.name}`, `${wl.name}`, 'terminal')}>终端</button>
            <button class="btn sm" ${act('wlOpen', `${app.id}`, `${comp.name}`, `${wl.name}`, 'yaml')}>YAML</button>
            <button class="btn sm" ${act('wlRestart', `${app.id}`, `${comp.name}`, `${wl.name}`)}>${icon('refresh', '', 12)}重启</button>
            <button class="btn sm danger" style="margin-left:auto" ${act('deleteWorkload', `${app.id}`, `${comp.name}`, `${wl.name}`)}>删除</button>
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
          <tr class="clickable" ${act('go', `/cicd/${p.id}`)}>
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
        <button class="btn primary" ${act('toggleModule', 'mesh', true)}>启用 Service Mesh</button>
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
    svg += `<g style="cursor:pointer" ${act('gotoComp', `${c.name}`)}>
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
          <button class="mini-act danger" title="删除该依赖" ${act('removeDep', `${appId}`, (i))}>${icon('archive', '', 12)}</button>
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
      <button class="btn primary" ${act('newComponent', `${app.id}`)}>${icon('plus', '', 14)}新建组件</button>
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
        <button class="btn sm" ${act('editDeps', `${app.id}`)}>编辑依赖</button>
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
      <span class="link" ${act('go', `${S.modules.mesh ? '/mesh/topology' : '/admin/modules'}`)}>Service Mesh 服务拓扑</span>${S.modules.mesh ? '' : '（当前模块未启用）'}。
    </div>
  </div>`;
}

/* ==========================================================
   应用访问入口（独立域名 / 平台网关路径）
   ========================================================== */
/* 访问入口：新增 / 编辑 / 启停 / 删除 */
function accessHostOf(e) {
  try {
    const u = new URL(e.url);
    return e.type === '域名' ? u.hostname : (u.pathname || '/');
  } catch (err) {
    return '';
  }
}
function openAccessForm(app, existing) {
  const comps = app.components.map(c => c.name);
  const gw = DB.gateway;
  const first = app.components[0];
  const comp = existing && comps.includes(existing.comp) ? existing.comp : comps[0];
  const compObj = findComp(app, comp) || first;
  const tls = existing
    ? (existing.tls === '未启用' ? '不启用' : String(existing.tls).startsWith('平台') ? '平台泛域名' : '已签发（自有证书）')
    : '平台泛域名';
  const authOpts = ['无', 'OAuth2 登录', 'API Key', 'JWT 校验'];
  if (existing && existing.auth && !authOpts.includes(existing.auth)) authOpts.push(existing.auth);

  formModal({
    title: `${existing ? '编辑' : '新增'}访问入口 · ${app.name}`,
    desc: '域名入口需把 CNAME 指到平台网关；网关路径入口由平台统一签发，无需自备域名。',
    okText: existing ? '保存修改' : '创建入口',
    wide: true,
    body: `
      <div class="form-row">
        ${fField('类型', fSelect('type', ['网关路径', '域名'], existing ? existing.type : '网关路径'))}
        ${fField('访问范围', fSelect('scope', ['公网', '内网'], existing ? existing.scope : '公网'))}
      </div>
      ${fField('域名或路径', fInput('host', existing ? accessHostOf(existing) : '', `留空则用 ${gw.domain}/${app.id}/`), '域名填主机名；路径需以 / 开头')}
      <div class="form-row">
        ${fField('后端组件', fSelect('comp', comps, comp))}
        ${fField('端口', fInput('port', String(existing ? existing.port : (compObj.port || 8080)), '8080', 'number'), '需与组件声明的服务端口一致')}
      </div>
      <div class="form-row">
        ${fField('TLS', fSelect('tls', ['平台泛域名', '已签发（自有证书）', '不启用'], tls))}
        ${fField('认证', fSelect('auth', authOpts, existing ? existing.auth : '无'))}
      </div>
      ${fField('备注', fInput('note', existing ? (existing.note || '') : '', '可选'))}`,
    onSubmit: st => {
      const blocked = releaseLockReason(app, existing ? '编辑访问入口' : '新增访问入口');
      if (blocked) return blocked;
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
      const allowed = accessPorts(target);
      if (!allowed.includes(port)) return `端口需与组件服务端口一致（${allowed.join(' / ')}）`;
      const list = DB.access[app.id] || (DB.access[app.id] = []);
      if (list.some(x => x.url === url && (!existing || x.url !== existing.url))) return '该地址已存在，请换一个';
      const data = {
        type: st.type, url, comp: target.name, port,
        scope: st.scope, tls: st.tls === '不启用' ? '未启用' : st.tls,
        auth: st.auth, note: st.note || ''
      };
      if (existing) {
        Object.assign(existing, data);
        app.events.unshift({ t: clockNow(), k: 'ok', tx: `访问入口 <b>${esc(url)}</b> 已更新 → ${esc(target.name)}:${port}` });
      } else {
        list.unshift({ env: curEnv().name, ...data, status: '已生效', hits: '0 / 日' });
        app.events.unshift({ t: clockNow(), k: 'ok', tx: `新增访问入口 <b>${esc(url)}</b> → ${esc(target.name)}:${port}` });
      }
      app.updated = nowStamp();
      saveSnapshot();
      route();
      toast(`访问入口已${existing ? '更新' : '创建'}，发布后生效`, 'ok');
    }
  });
}
function newAccess(appId) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  if (!app.components.length) return toast('该应用还没有组件，无法绑定后端', 'warn');
  openAccessForm(app);
}
function editAccess(appId, url) {
  const app = DB.apps.find(a => a.id === appId);
  const e = app && (DB.access[appId] || []).find(x => x.url === url);
  if (!app || !e) return;
  openAccessForm(app, e);
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
function restoreAccess(appId, url) {
  const app = DB.apps.find(a => a.id === appId);
  const applied = ((DB.accessApplied && DB.accessApplied[appId]) || []).find(x => x.url === url);
  if (!app || !applied) return;
  const blocked = releaseLockReason(app, '恢复访问入口');
  if (blocked) return toast(blocked, 'warn');
  const list = DB.access[appId] || (DB.access[appId] = []);
  if (!list.some(x => x.url === url)) list.push(JSON.parse(JSON.stringify(applied)));
  app.updated = nowStamp();
  app.events.unshift({ t: clockNow(), k: 'ok', tx: `访问入口 <b>${esc(url)}</b> 已撤销删除` });
  saveSnapshot();
  route();
  toast('已撤销删除，入口继续生效', 'ok');
}
function toggleAccess(appId, url) {
  const e = (DB.access[appId] || []).find(x => x.url === url);
  if (!e) return;
  const app = DB.apps.find(a => a.id === appId);
  const blocked = app && releaseLockReason(app, '启停访问入口');
  if (blocked) return toast(blocked, 'warn');
  e.status = e.status === '已生效' ? '已停用' : '已生效';
  if (app) app.events.unshift({ t: clockNow(), k: e.status === '已生效' ? 'ok' : 'warn', tx: `访问入口 <b>${esc(url)}</b> 已${e.status === '已生效' ? '启用' : '停用'}` });
  saveSnapshot();
  route();
  toast(`入口已${e.status === '已生效' ? '启用' : '停用'}，发布后生效`, 'ok');
}
function deleteAccess(appId, url) {
  const app = DB.apps.find(a => a.id === appId);
  const blocked = app && releaseLockReason(app, '删除访问入口');
  if (blocked) return toast(blocked, 'warn');
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
      toast('访问入口已删除，发布后生效', 'warn');
    }
  });
}

function appAccessView(app) {
  const desired = DB.access[app.id] || [];
  const applied = (DB.accessApplied && DB.accessApplied[app.id]) || [];
  const desiredUrls = new Set(desired.map(e => e.url));
  const removed = applied.filter(e => !desiredUrls.has(e.url)).map(e => ({ ...e, pendingRemoved: true }));
  const list = [...desired, ...removed];
  const gw = DB.gateway;
  const live = applied.filter(x => x.status === '已生效');
  const desiredLive = desired.filter(x => x.status === '已生效');
  const primary = desiredLive.find(x => x.scope === '公网') || desiredLive[0]
    || live.find(x => x.scope === '公网') || live[0];
  const primaryRemoved = !!primary && removed.some(x => x.url === primary.url);
  const dCount = live.filter(x => x.type === '域名').length;
  const pCount = live.filter(x => x.type === '网关路径').length;
  const pending = accessPending(app.id);

  if (!list.length) {
    return `<div class="empty">
      <div class="eic">${icon('globe', '', 22)}</div>
      <h3>尚未配置访问入口</h3>
      <p>可以为应用绑定独立域名，或直接挂到平台网关路径下，无需单独申请域名。</p>
      ${pending.count ? `<p class="tiny" style="color:var(--warning)">有 ${pending.count} 条入口已从期望配置移除，将在下次发布后生效。</p>` : ''}
      <button class="btn primary" ${act('newAccess', `${app.id}`)}>新增入口</button>
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
          ${primaryRemoved ? '<span class="badge danger">待移除</span>' : pending.urls.has(primary.url) ? '<span class="badge warn">待发布</span>' : '<span class="badge ok">已生效</span>'}
        </div>
        <div class="mono" style="font-size:17px;font-weight:650;letter-spacing:-.3px;margin-top:3px;color:var(--text)">${esc(primary.url)}</div>
        <div class="tiny muted" style="margin-top:4px">
          ${primary.env} · ${primary.scope} · 转发至 <span class="mono">${esc(accessBackend(primary))}</span> · ${primary.tls} · ${primary.hits}
        </div>
      </div>
      <div style="display:flex;gap:7px">
        <button class="btn" ${act('copyText', `${esc(primary.url)}`)}>${icon('copy', '', 13)}复制</button>
        <button class="btn" ${act('openAccess', `${app.id}`, `${esc(primary.url)}`)}>访问链路</button>
        <button class="btn primary" ${act('newAccess', `${app.id}`)}>${icon('plus', '', 13)}新增入口</button>
      </div>
    </div>
  </div>` : ''}

  <div class="card" style="margin-bottom:14px">
    <div class="card-head">
      <div class="t">全部访问入口</div>
      <div class="r tiny muted" style="display:flex;align-items:center;gap:8px">
        ${pending.count ? `<span class="badge warn">${pending.count} 条变更待发布</span><span>发布后生效</span>` : '<span class="badge ok">配置已生效</span>'}
        <span>生效 ${live.length} 条 · 域名 ${dCount} · 网关路径 ${pCount}</span>
      </div>
    </div>
    ${list.map(e => `
      <div style="padding:13px 16px;border-bottom:1px solid #f0f3f9;display:flex;gap:12px;align-items:flex-start">
        <span class="badge ${e.type === '域名' ? 'purple' : 'info'}" style="margin-top:2px;flex:0 0 auto">${e.type}</span>
        <div style="flex:1;min-width:0">
          <div class="mono" style="font-size:12.5px;font-weight:600;color:${e.status === '已生效' ? 'var(--text)' : 'var(--text-3)'};word-break:break-all">${esc(e.url)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;align-items:center" class="tiny muted">
            <span class="chip">${e.env}</span>
            <span>${e.scope}</span><span>·</span>
            <span>后端 <b class="mono" style="color:var(--text-2)">${esc(accessBackend(e))}</b>${accessTarget(app, e) ? '' : ' <span class="badge bad">目标不存在</span>'}</span><span>·</span>
            <span>${e.tls}</span><span>·</span>
            <span>${e.auth}</span><span>·</span>
            <span>${e.hits}</span>
          </div>
          ${e.note ? `<div class="tiny muted" style="margin-top:3px">${esc(e.note)}</div>` : ''}
        </div>
        <div style="flex:0 0 auto;margin-top:1px;display:flex;gap:5px;align-items:center">${e.pendingRemoved ? '<span class="badge danger">待移除</span>' : pending.urls.has(e.url) ? '<span class="badge warn">待发布</span>' : ''}${badge(e.status)}</div>
        <div style="display:flex;gap:2px;flex:0 0 auto;align-items:center">
          <button class="btn sm ghost" ${act('copyText', `${esc(e.url)}`)}>复制</button>
          <button class="btn sm ghost" ${act('openAccess', `${app.id}`, `${esc(e.url)}`)}>链路</button>
          ${e.pendingRemoved
            ? `<button class="btn sm ghost" ${act('restoreAccess', `${app.id}`, `${esc(e.url)}`)}>撤销删除</button>`
            : `<button class="btn sm ghost" ${act('editAccess', `${app.id}`, `${esc(e.url)}`)}>编辑</button>
               <button class="btn sm ghost" ${act('toggleAccess', `${app.id}`, `${esc(e.url)}`)}>${e.status === '已生效' ? '停用' : '启用'}</button>
               <button class="mini-act danger" title="删除入口" ${act('deleteAccess', `${app.id}`, `${esc(e.url)}`)}>${icon('archive', '', 13)}</button>`}
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
  const host = e.comp || String(e.backend || '').split(':')[0];
  const comp = accessTarget(app, e)
    || findComp(app, host)
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
      ${step(3, '路由匹配', `${e.type}规则 → ${accessBackend(e)}（${e.auth}）`, '#7c3aed')}
      ${step(4, '转发到后端', comp ? `组件 ${comp.name} · ${comp.workloads.length} 个工作负载` : `${accessBackend(e)} · 目标组件已不存在`, '#2563eb')}
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
  const list = compRows().filter(c => {
    if (S.compApp !== 'all' && c.appId !== S.compApp) return false;
    if (S.compFilter === 'bad' && !c.bad) return false;
    if (S.compFilter === 'empty' && c.wl) return false;
    if (!q) return true;
    return c.name.includes(q) || c.app.toLowerCase().includes(q) || c.role.toLowerCase().includes(q) || c.runtime.toLowerCase().includes(q);
  });
  return applySort(list, 'comps');
}
function viewComponents() {
  setCrumb('组件');
  if (S.compApp !== 'all' && !DB.apps.some(a => a.id === S.compApp)) S.compApp = 'all';
  const all = compRows();
  const list = compFiltered();
  const meta = paginate(list, 'comps', PAGE_SIZE.comps);
  const badCount = all.filter(c => c.bad).length;
  const emptyCount = all.filter(c => !c.wl).length;
  return `
  <div class="page-head">
    <div>
      <div class="ttl">组件</div>
      <div class="sub">组件是构建与发布的边界：向上归属应用，向下展开为工作负载。此视图跨应用汇总全部组件。</div>
    </div>
    <div class="acts">
      <button class="btn" ${act('go', '/apps')}>${icon('box', '', 14)}按应用浏览</button>
      <button class="btn primary" ${act('newComponentGlobal')}>${icon('plus', '', 14)}新建组件</button>
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
        `<button class="filter-pill ${S.compFilter === k ? 'on' : ''}" ${act('compFilter', `${k}`)}>${n}</button>`).join('')}
      <div class="grow"><span class="tiny muted" style="align-self:center" id="comp-count">${list.length} 个组件</span></div>
    </div>
    <table class="table">
      <thead><tr>${sortTh('组件', 'comps', 'name')}${sortTh('所属应用', 'comps', 'app')}${sortTh('角色', 'comps', 'role')}<th>运行时</th>${sortTh('版本', 'comps', 'version')}${sortTh('工作负载', 'comps', 'wl', 'right')}${sortTh('实例', 'comps', 'ready', 'right')}${sortTh('状态', 'comps', 'bad')}</tr></thead>
      <tbody id="comp-rows">${compTableRows(meta.rows)}</tbody>
    </table>
    <div id="comp-pager">${pager('comps', meta, '个组件')}</div>
  </div>`;
}
function compTableRows(list) {
  if (!list.length) {
    return `<tr><td colspan="8"><div class="empty" style="padding:34px 16px">
      <h3>没有匹配的组件</h3><p>换个应用或筛选条件，或者清空搜索关键词。</p></div></td></tr>`;
  }
  return list.map(c => `<tr class="clickable" ${act('openComponent', `${c.appId}`, `${esc(c.name)}`)}>
    <td class="name">${esc(c.name)}<div class="sub mono">${esc(c.image)}</div></td>
    <td><span style="color:var(--text)">${esc(c.app)}</span> ${badge(c.appLevel)}</td>
    <td><span class="chip">${esc(c.role)}</span></td>
    <td class="tiny" style="color:var(--text-2)">${c.pending
      ? `<span class="muted" title="运行时由首次构建自动识别，创建时无需填写">待首次构建</span>`
      : esc(c.runtime)}${c.buildMode && c.pending ? `<div class="sub">${esc(c.buildMode)}</div>` : ''}</td>
    <td class="mono" style="font-size:11px">${esc(c.version)}</td>
    <td class="right num"><span class="link" ${act('openWorkloadsOfComp', `${c.appId}`, `${esc(c.name)}`)} data-stop="1" title="查看该组件的工作负载">${c.wl}</span></td>
    <td class="right num">${c.want ? `${c.ready}/${c.want}` : '—'}</td>
    <td>${c.bad ? `<span class="badge warn">${c.bad} 个异常</span>` : c.wl ? '<span class="badge ok"><i></i>健康</span>' : '<span class="badge muted">无负载</span>'}</td>
  </tr>`).join('');
}
function paintComps() {
  const list = compFiltered();
  const meta = paginate(list, 'comps', PAGE_SIZE.comps);
  const rows = $('#comp-rows');
  if (rows) rows.innerHTML = compTableRows(meta.rows);
  const pg = $('#comp-pager');
  if (pg) pg.innerHTML = pager('comps', meta, '个组件');
  const cnt = $('#comp-count');
  if (cnt) cnt.textContent = `${list.length} 个组件`;
}
function compQuery(v) { S.compQ = v; S.page.comps = 1; syncCompsUrl(); paintComps(); }
function compApp(v) { S.compApp = v; S.page.comps = 1; syncCompsUrl(); paintComps(); }
function compFilter(v) {
  S.compFilter = v;
  S.page.comps = 1;
  syncCompsUrl();
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
function openWorkloadsOfApp(appId) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  goto(`#/workloads?q=${encodeURIComponent(app.name)}`);
}
function openWorkloadsOfComp(appId, compName) {
  const app = DB.apps.find(a => a.id === appId);
  if (!app) return;
  goto(`#/workloads?q=${encodeURIComponent(compName)}`);
}
function openComponentsOf(appId) {
  goto(`#/components?app=${encodeURIComponent(appId)}`);
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
function accessListData() {
  const all = [];
  DB.apps.forEach(a => {
    const desired = DB.access[a.id] || [];
    const applied = (DB.accessApplied && DB.accessApplied[a.id]) || [];
    const desiredUrls = new Set(desired.map(e => e.url));
    const pendingUrls = accessPending(a.id).urls;
    const push = (e, pendingRemoved) => {
      const target = accessTarget(a, e);
      all.push({
        ...e, app: a.name, appId: a.id,
        dangling: !target, targetName: target ? target.name : '',
        pending: pendingRemoved || pendingUrls.has(e.url),
        pendingRemoved
      });
    };
    desired.forEach(e => push(e, false));
    applied.filter(e => !desiredUrls.has(e.url)).forEach(e => push(e, true));
  });
  const q = S.accessQ.trim().toLowerCase();
  const filtered = all.filter(r => {
    const okQ = !q || [r.app, r.url, r.comp, r.port, r.auth, r.type, r.note].join(' ').toLowerCase().includes(q);
    const okType = S.accessType === 'all' || r.type === S.accessType;
    const okStatus = S.accessStatus === 'all' || (S.accessStatus === '待发布'
      ? r.pending
      : !r.pendingRemoved && r.status === S.accessStatus);
    return okQ && okType && okStatus;
  });
  return { all, filtered, meta: paginate(applySort(filtered, 'access'), 'access', PAGE_SIZE.access) };
}
function accessRows(list) {
  if (!list.length) {
    return `<tr><td colspan="9"><div class="empty" style="padding:34px 16px">
      <h3>没有匹配的访问入口</h3><p>换个关键词或筛选条件，或者清空搜索。</p>
      <button class="btn" ${act('clearAccessQ')}>清空搜索</button>
    </div></td></tr>`;
  }
  return list.map(r => `<tr>
    <td class="name"><span class="link" ${act('go', `/apps/${r.appId}`)}>${esc(r.app)}</span></td>
    <td><span class="badge ${r.type === '域名' ? 'purple' : 'info'}">${r.type}</span></td>
    <td class="mono" style="font-size:11.5px;color:${r.status === '已生效' ? 'var(--text)' : 'var(--text-3)'}">${esc(r.url)}</td>
    <td class="mono" style="font-size:11px">${r.dangling
      ? `${esc(accessBackend(r))} <span class="badge bad">目标不存在</span>`
      : `<span class="link" ${act('openComponent', `${r.appId}`, `${esc(r.comp)}`)} data-stop="1">${esc(r.comp)}</span>:${r.port}`}</td>
    <td><span class="chip">${r.env}</span></td>
    <td>${r.scope === '公网' ? '<span class="badge warn">公网</span>' : '<span class="badge muted">内网</span>'}</td>
    <td class="tiny">${esc(r.auth)}</td>
    <td><div style="display:flex;gap:5px;align-items:center">${badge(r.status)}${r.pendingRemoved ? '<span class="badge danger">待移除</span>' : r.pending ? '<span class="badge warn">待发布</span>' : ''}</div></td>
    <td class="right" style="white-space:nowrap">
      <button class="btn sm ghost" ${act('copyText', `${esc(r.url)}`)}>复制</button>
      <button class="btn sm ghost" ${act('openAccess', `${r.appId}`, `${esc(r.url)}`)}>链路</button>
      ${r.pendingRemoved
        ? `<button class="btn sm ghost" ${act('restoreAccess', `${r.appId}`, `${esc(r.url)}`)}>撤销删除</button>`
        : `<button class="btn sm ghost" ${act('editAccess', `${r.appId}`, `${esc(r.url)}`)}>编辑</button>`}
    </td>
  </tr>`).join('');
}
function viewAccessList() {
  setCrumb('访问入口');
  const { all, filtered, meta } = accessListData();
  const gw = DB.gateway;
  const live = DB.apps.flatMap(a => ((DB.accessApplied && DB.accessApplied[a.id]) || []).filter(x => x.status === '已生效'));
  const dCount = live.filter(r => r.type === '域名').length;
  const pCount = live.filter(r => r.type === '网关路径').length;
  const pendingCount = all.filter(r => r.pending).length;

  return `
  <div class="page-head">
    <div><div class="ttl">访问入口</div>
      <div class="sub">所有应用对外暴露的统一路由视图。支持<b>独立域名</b>与<b>平台网关路径</b>两种形态，鉴权、限流与证书统一在网关层处理。</div></div>
    <div class="acts">
      ${pendingCount ? `<span class="badge warn">${pendingCount} 条待发布</span>` : ''}
      <button class="btn" disabled title="证书管理尚未开放，当前由访问入口的 TLS 配置承担">证书管理</button>
      <button class="btn primary" ${act('newAccessGlobal')}>${icon('plus', '', 14)}新增入口</button>
    </div>
  </div>

  <div class="grid g4" style="margin-bottom:14px">
    <div class="stat"><div class="lab">生效入口</div><div class="val">${live.length}</div><div class="foot">共 ${all.length} 条 · ${all.length - live.length} 条已停用</div></div>
    <div class="stat"><div class="lab">独立域名</div><div class="val">${dCount}</div><div class="foot">需自备证书或平台代签</div></div>
    <div class="stat"><div class="lab">网关路径</div><div class="val">${pCount}</div><div class="foot">平台统一签发，零配置</div></div>
    <div class="stat"><div class="lab">待发布变更</div><div class="val" style="${pendingCount ? 'color:var(--warning)' : ''}">${pendingCount}</div><div class="foot">发布成功后切换为已生效</div></div>
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
    <div class="toolbar">
      <div class="search" style="margin:0;width:240px">${icon('search', '', 14)}
        <input id="access-q" placeholder="应用 / 地址 / 后端 / 鉴权" value="${esc(S.accessQ)}" oninput="accessQuery(this.value)" />
      </div>
      <select class="input" style="width:130px;height:30px;padding:0 8px;font-size:12px" onchange="accessTypeSet(this.value)">
        <option value="all"${S.accessType === 'all' ? ' selected' : ''}>全部类型</option>
        <option value="域名"${S.accessType === '域名' ? ' selected' : ''}>域名</option>
        <option value="网关路径"${S.accessType === '网关路径' ? ' selected' : ''}>网关路径</option>
      </select>
      <select class="input" style="width:130px;height:30px;padding:0 8px;font-size:12px" onchange="accessStatusSet(this.value)">
        <option value="all"${S.accessStatus === 'all' ? ' selected' : ''}>全部状态</option>
        <option value="已生效"${S.accessStatus === '已生效' ? ' selected' : ''}>已生效</option>
        <option value="已停用"${S.accessStatus === '已停用' ? ' selected' : ''}>已停用</option>
        <option value="待发布"${S.accessStatus === '待发布' ? ' selected' : ''}>待发布</option>
      </select>
      <div class="grow"><span class="tiny muted" id="access-count">${filtered.length} 条入口</span></div>
    </div>
    <div style="overflow-x:auto">
    <table class="table">
      <thead><tr>${sortTh('应用', 'access', 'app')}${sortTh('类型', 'access', 'type')}${sortTh('访问地址', 'access', 'url')}${sortTh('后端', 'access', 'comp')}<th>环境</th><th>范围</th><th>鉴权</th>${sortTh('状态', 'access', 'status')}<th class="right">操作</th></tr></thead>
      <tbody id="access-rows">${accessRows(meta.rows)}</tbody>
    </table>
    </div>
    <div id="access-pager">${pager('access', meta, '条入口')}</div>
  </div>`;
}
function paintAccess() {
  const rows = $('#access-rows');
  if (!rows) return;
  const { filtered, meta } = accessListData();
  rows.innerHTML = accessRows(meta.rows);
  const pg = $('#access-pager');
  if (pg) pg.innerHTML = pager('access', meta, '条入口');
  const cnt = $('#access-count');
  if (cnt) cnt.textContent = `${filtered.length} 条入口`;
}
function accessQuery(v) { S.accessQ = v; S.page.access = 1; syncAccessUrl(); paintAccess(); }
function accessTypeSet(v) { S.accessType = v; S.page.access = 1; syncAccessUrl(); paintAccess(); }
function accessStatusSet(v) { S.accessStatus = v; S.page.access = 1; syncAccessUrl(); paintAccess(); }
function clearAccessQ() { S.accessQ = ''; S.page.access = 1; const i = $('#access-q'); if (i) i.value = ''; syncAccessUrl(); paintAccess(); }

function whereChip(w) {
  const m = { '云端': 'blue', '边缘': 'teal', '端侧': 'purple' };
  return `<span class="chip ${m[w] || ''}">${w}</span>`;
}
function selectComp(n) { S.appComp = n; S.appWl = null; route(); }
function selectWl(n) { S.appWl = S.appWl === n ? null : n; route(); }

/* ---------- 工作负载（全局） ---------- */
function wlListData() {
  const all = DB.apps.flatMap(a => a.components.flatMap(c =>
    c.workloads.map(w => ({ ...w, app: a.name, appId: a.id, comp: c.name, primary: w.id === c.primaryWorkloadId }))));
  const q = S.wlQ.trim().toLowerCase();
  const f = S.wlFilter;
  const filtered = all.filter(w => {
    const okFilter = f === 'all' ? true
      : (f === '云端' || f === '边缘' || f === '端侧') ? w.where === f
        : f === '异常' ? (w.status !== '运行中' && w.status !== '已完成') : true;
    const okQuery = !q || [w.name, w.app, w.comp, w.image, w.cluster, w.kind].join(' ').toLowerCase().includes(q);
    return okFilter && okQuery;
  });
  return { all, filtered, meta: paginate(applySort(filtered, 'wls'), 'wls', PAGE_SIZE.wls) };
}
function wlRows(list) {
  if (!list.length) {
    return `<tr><td colspan="9"><div class="empty" style="padding:34px 16px">
      <h3>没有匹配的工作负载</h3><p>换个关键词或筛选条件，或者清空搜索。</p>
      <button class="btn" ${act('clearWlQ')}>清空搜索</button>
    </div></td></tr>`;
  }
  return list.map(w => `<tr class="clickable" ${act('wlOpen', `${w.appId}`, `${esc(w.comp)}`, `${esc(w.name)}`, 'overview')}>
    <td class="name">${esc(w.name)}${w.primary ? '<span class="badge info" style="margin-left:6px">主负载</span>' : ''}<div class="sub mono">${esc(w.image)}</div></td>
    <td><span class="link" ${act('go', `/apps/${w.appId}`)} data-stop="1">${esc(w.app)}</span><div class="sub"><span class="link" ${act('openComponent', `${w.appId}`, `${esc(w.comp)}`)} data-stop="1">${esc(w.comp)}</span></div></td>
    <td><span class="chip">${esc(w.kind)}</span></td>
    <td class="num">${wReady(w)}</td>
    <td>${badge(w.status)}</td>
    <td>${whereChip(w.where)}</td>
    <td class="mono" style="font-size:11px">${esc(w.cluster)}</td>
    <td class="mono" style="font-size:11px">${esc(w.cpu)}</td>
    <td class="right num">${w.restarts}</td>
  </tr>`).join('');
}
function viewWorkloads() {
  setCrumb('工作负载');
  const { all, filtered, meta } = wlListData();
  const f = S.wlFilter;
  return `
  <div class="page-head">
    <div><div class="ttl">工作负载</div>
      <div class="sub">跨应用统一视图。工作负载是调度的最小单位，归属于某个组件，可调度至云端集群、边缘节点或端侧设备。</div></div>
    <div class="acts">
      <div class="search" style="margin:0;width:210px">${icon('search', '', 14)}
        <input id="wl-q" placeholder="负载 / 应用 / 组件 / 集群" value="${esc(S.wlQ)}" oninput="wlQuery(this.value)" />
      </div>
      <span class="tiny muted" id="wl-count">${filtered.length} 个工作负载</span>
      <button class="btn primary" ${act('newWorkloadGlobal')}>${icon('plus', '', 14)}新建工作负载</button>
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      ${[['all', '全部'], ['云端', '云端'], ['边缘', '边缘'], ['端侧', '端侧'], ['异常', '异常']].map(([k, n]) =>
        `<button class="filter-pill ${f === k ? 'on' : ''}" ${act('setWlFilter', `${k}`)}>${n}
         <span style="font-size:10px;color:var(--text-3)">${k === 'all' ? all.length : k === '异常' ? all.filter(w => w.status !== '运行中' && w.status !== '已完成').length : all.filter(w => w.where === k).length}</span>
        </button>`).join('')}
      <div class="grow"><button class="btn sm" ${act('exportWorkloadsCsv')}>${icon('archive', '', 12)}导出 CSV</button></div>
    </div>
    ${all.length ? `<div style="overflow-x:auto">
    <table class="table">
      <thead><tr>${sortTh('工作负载', 'wls', 'name')}${sortTh('所属应用 / 组件', 'wls', 'app')}${sortTh('类型', 'wls', 'kind')}${sortTh('副本', 'wls', 'replicas')}${sortTh('状态', 'wls', 'status')}${sortTh('调度', 'wls', 'where')}<th>集群</th><th>CPU</th>${sortTh('重启', 'wls', 'restarts', 'right')}</tr></thead>
      <tbody id="wl-rows">${wlRows(meta.rows)}</tbody>
    </table>
    </div><div id="wl-pager">${pager('wls', meta, '个工作负载')}</div>`
      : `<div class="empty" style="padding:40px 16px">
          <div class="eic">${icon('layers', '', 22)}</div>
          <h3>还没有工作负载</h3>
          <p>先在应用中创建组件，再为组件添加工作负载；主负载会作为发布与访问链路的默认运行单元。</p>
          <button class="btn primary" ${act('go', '/apps')}>去应用列表</button>
        </div>`}
  </div>`;
}
function paintWls() {
  const rows = $('#wl-rows');
  if (!rows) return;
  const { filtered, meta } = wlListData();
  rows.innerHTML = wlRows(meta.rows);
  const pg = $('#wl-pager');
  if (pg) pg.innerHTML = pager('wls', meta, '个工作负载');
  const cnt = $('#wl-count');
  if (cnt) cnt.textContent = `${filtered.length} 个工作负载`;
}
function wlQuery(v) { S.wlQ = v; S.page.wls = 1; syncWlsUrl(); paintWls(); }
function clearWlQ() { S.wlQ = ''; S.page.wls = 1; const i = $('#wl-q'); if (i) i.value = ''; syncWlsUrl(); paintWls(); }
function wlFilterSet(v) {
  S.wlFilter = v;
  S.page.wls = 1;
  syncWlsUrl();
  const btn = [...document.querySelectorAll('.filter-pill')].find(b => b.textContent.trim().startsWith({ all: '全部', '云端': '云端', '边缘': '边缘', '端侧': '端侧', '异常': '异常' }[v]));
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  paintWls();
}

