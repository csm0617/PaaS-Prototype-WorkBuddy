/* ==========================================================
   视图：发布记录、流水线、制品仓库
   ========================================================== */

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

function accessSnapshotOf(app) {
  return JSON.parse(JSON.stringify(DB.access[app.id] || []));
}
function accessAppliedSnapshotOf(app) {
  return JSON.parse(JSON.stringify((DB.accessApplied && DB.accessApplied[app.id]) || []));
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
      const blocked = releaseLockReason(app, '发起新的发布');
      if (blocked) return blocked;
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
        })),
        accessSnapshot: accessSnapshotOf(app),
        accessAppliedSnapshot: accessAppliedSnapshotOf(app)
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
      const hadPending = accessPending(app.id).count;
      applyAccess(app);
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'ok', tx: `组件 <b>${esc(rec.comp)}</b> 发布完成，当前版本 ${esc(rec.version)}${hadPending ? '，访问入口配置已生效' : ''}` });
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
  const hasAccess = Array.isArray(rec.accessSnapshot);
  const hasApplied = Array.isArray(rec.accessAppliedSnapshot);
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
        <dt>访问入口</dt><dd>${hasAccess ? `恢复 ${rec.accessSnapshot.length} 条入口配置` : '无入口快照，保持当前入口'}</dd>
        <dt>生效版本</dt><dd>${hasApplied ? `恢复 ${rec.accessAppliedSnapshot.length} 条已生效入口` : '无生效快照，保持现状'}</dd>
      </dl>
      <div class="danger-box" style="margin-top:12px">回滚会替换正在运行的实例，期间可能出现短暂流量抖动，请确认已停止相关变更。${hasAccess ? '入口地址与后端绑定将一并恢复。' : ''}</div>`,
    onSubmit: () => {
      if (!rec.prev) return '该记录没有可回滚的历史版本';
      rec.status = '已回滚';
      const comp = app && findComp(app, rec.comp);
      if (comp) comp.version = rec.prev;
      if (app && hasAccess) DB.access[app.id] = JSON.parse(JSON.stringify(rec.accessSnapshot));
      if (app && hasApplied) {
        DB.accessApplied = DB.accessApplied || {};
        DB.accessApplied[app.id] = JSON.parse(JSON.stringify(rec.accessAppliedSnapshot));
      }
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
    <div class="grow"><button class="btn sm primary" ${act('releaseApp', `${app.id}`)}>${icon('send', '', 12)}发起发布</button></div>
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
        ? `<button class="btn sm primary" ${act('approveRelease', `${r.id}`)}>审批</button>`
        : r.status === '已发布' && r.prev
          ? `<button class="btn sm" ${act('rollbackRelease', `${r.id}`)}>回滚</button>`
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
      <div class="sub">流水线绑定「应用 - 组件」，构建产物推送至制品仓库后按发布策略上线。</div></div>
    <div class="acts">
      <button class="btn" ${act('go', '/artifacts')}>${icon('archive', '', 14)}制品仓库</button>
      <button class="btn primary" ${act('newPipeline')}>${icon('plus', '', 14)}新建流水线</button>
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
      <button class="filter-pill on" ${act('statusFilter', '#pipeTable','all')}>全部</button>
      <button class="filter-pill" ${act('statusFilter', '#pipeTable','运行中')}>运行中</button>
      <button class="filter-pill" ${act('statusFilter', '#pipeTable','失败')}>失败</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">自动刷新 · 30s</span></div>
    </div>
    <table class="table" id="pipeTable">
      <thead><tr><th>流水线</th><th>应用 / 组件</th><th>触发</th><th>分支</th><th>最近运行</th><th>状态</th><th>成功率</th><th class="right">操作</th></tr></thead>
      <tbody>${DB.pipelines.map(p => `
        <tr class="clickable" data-q="${esc(p.name)} ${esc(p.app)} ${esc(p.comp)} ${esc(p.branch)}" data-status="${esc(p.status)}" ${act('go', `/cicd/${p.id}`)}>
          <td class="name">${esc(p.name)}</td>
          <td>${esc(p.app)}<div class="sub">${esc(p.comp)}</div></td>
          <td><span class="chip">${esc(p.trigger)}</span></td>
          <td class="mono" style="font-size:11px">${esc(p.branch)}</td>
          <td>${p.last}</td>
          <td>${pbadge(p.status)}</td>
          <td><div style="display:flex;align-items:center;gap:7px"><div class="progress thin" style="width:52px"><div class="${p.success > 95 ? 'ok' : 'warn'}" style="width:${p.success}%"></div></div><span class="num">${p.success}%</span></div></td>
          <td class="right"><button class="btn sm" ${act('rerunPipeline', `${p.id}`)} data-stop="1">运行</button></td>
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
        <span class="link tiny" ${act('go', '/cicd')}>流水线</span>
        <span class="muted">/</span>
        <span class="ttl" style="font-size:16px">${esc(p.name)}</span>
        ${pbadge(run.status)}
        ${run.isLatest ? '<span class="badge muted">最新</span>' : `<span class="badge muted">历史运行 #${run.no}</span>`}
      </div>
      <div class="sub">${esc(p.app)} · 组件 <b>${esc(p.comp)}</b> · 触发 <b>${esc(p.trigger)}</b> · 分支 <span class="mono">${esc(run.branch)}</span>
        · 提交 <span class="mono">${esc(run.commit)}</span>${run.isLatest ? '' : ` · <span class="link" ${act('go', `/cicd/${p.id}`)}>回到最新</span>`}</div>
    </div>
    <div class="acts">
      ${pendingApproval ? `<button class="btn" ${act('rejectPipeline', `${p.id}`)}>驳回</button>
        <button class="btn primary" ${act('approvePipeline', `${p.id}`)}>${icon('shield', '', 14)}通过审批</button>` : ''}
      ${canaryRunning ? `<button class="btn primary" ${act('promoteCanary', `${p.id}`)}>${icon('send', '', 14)}推进灰度</button>` : ''}
      <button class="btn" ${act('rerunPipeline', `${p.id}`)}>${icon('refresh', '', 14)}重新运行</button>
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
          <div class="stage ${s.s} ${S.pipeStage === i ? 'sel' : ''}" ${s.s === 'skip' ? '' : `${act('pipeTabSet', (i))} title="查看该阶段日志"`}>
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
          <button class="btn sm ghost" ${act('toast', '日志已复制')}>复制</button>
        </div>
      </div>
      <div class="log-filter">
        <button class="filter-pill ${S.pipeStage < 0 ? 'on' : ''}" ${act('pipeTabSet', -1)}>全部</button>
        ${blocks.map((b, i) => `<button class="filter-pill ${S.pipeStage === i ? 'on' : ''}" ${act('pipeTabSet', (i))}>${esc(STAGE_ZH[b.key] || b.key)}</button>`).join('')}
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
          ${app ? `<button class="btn sm" style="width:100%;justify-content:center;margin-top:10px" ${act('go', `/apps/${app.id}/releases`)}>查看发布记录</button>` : ''}
        </div>
      </div>
    </div>
  </div>

  <div class="card mt16">
    <div class="card-head"><div class="t">构建历史</div><div class="r tiny muted">共 ${p.runs} 次 · 点任意一行查看该次运行</div></div>
    <table class="table">
      <thead><tr><th>编号</th><th>状态</th><th>提交</th><th>分支</th><th>触发人</th><th>耗时</th><th class="right">时间</th></tr></thead>
      <tbody>${(p.history || []).map(h => `<tr class="clickable ${String(h.no) === '#' + run.no ? 'sel' : ''}" ${act('go', `/cicd/${p.id}/${String(h.no).replace('#', '')}`)}>
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
    const desiredSnap = accessSnapshotOf(app);
    const appliedSnap = accessAppliedSnapshotOf(app);
    const hadPending = accessPending(app.id).count;
    applyAccess(app);
    app.updated = nowStamp();
    app.events.unshift({ t: clockNow(), k: 'ok', tx: `组件 <b>${esc(p.comp)}</b> 完成灰度发布${comp ? `，当前版本 ${esc(comp.version)}` : ''}${hadPending ? '，访问入口配置已生效' : ''}` });
    DB.releases.unshift({
      id: `rel-${Date.now().toString(36)}`, appId: app.id, comp: p.comp,
      version: comp ? comp.version : 'v1.0.0', prev: bumpVersion(comp ? comp.version : 'v1.0.0', -1),
      env: p.env, strategy: '灰度 10% → 50% → 100%', status: '已发布',
      by: DB.user.name, approver: app.owner || DB.user.name,
      at: fmtDateTime(Date.now()), ts: Date.now(), note: `流水线 ${p.name} #${p.runs}`,
      configSnapshot: configOf(app, p.comp).map(c => ({
        key: c.key, scope: c.scope, secret: !!c.secret, value: c.secret ? '••••••' : c.value
      })),
      accessSnapshot: desiredSnap,
      accessAppliedSnapshot: appliedSnap
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
      <button class="filter-pill on" ${act('statusFilter', '#artTable','all')}>全部</button>
      <button class="filter-pill" ${act('statusFilter', '#artTable','amd64')}>云端 amd64</button>
      <button class="filter-pill" ${act('statusFilter', '#artTable','arm64')}>边缘 arm64</button>
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
    ${t.map(([r, n]) => `<div class="tab ${active === r ? 'on' : ''}" ${act('go', `${r}`)}>${n}</div>`).join('')}
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
    <button class="btn sm" ${act('toggleModule', 'mesh', false)}>关闭模块</button>
  </div>`;
}

function viewMesh() {
  setCrumb('服务治理');
  if (!S.modules.mesh) return moduleOffPage('mesh', 'Service Mesh', '服务治理能力依赖该模块。启用后可查看服务清单、Sidecar 注入状态与 mTLS 策略。');
  return `
  <div class="page-head">
    <div><div class="ttl">服务治理</div><div class="sub">服务清单、Sidecar 注入状态与通信安全策略。</div></div>
    <div class="acts"><button class="btn" ${act('toast', '已刷新')}>${icon('refresh', '', 14)}刷新</button></div>
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
      <button class="filter-pill on" ${act('statusFilter', '#meshTable','all')}>全部</button>
      <button class="filter-pill" ${act('statusFilter', '#meshTable','告警')}>异常</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">控制面 istiod v1.21.3 · 数据面 Envoy 1.29</span></div>
    </div>
    <table class="table" id="meshTable">
      <thead><tr><th>服务</th><th>命名空间</th><th>版本</th><th>Sidecar</th><th>QPS</th><th>成功率</th><th>P99</th><th>实例</th><th>状态</th></tr></thead>
      <tbody>${DB.mesh.services.map(s => `
        <tr class="clickable" data-q="${esc(s.name)} ${esc(s.ns)} ${esc(s.ver)}" data-status="${esc(s.status)}" ${act('openTraceBySvc', `${esc(s.name)}`)} title="查看该服务的链路">
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

