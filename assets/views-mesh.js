/* ==========================================================
   视图：Service Mesh 服务治理、流量规则、拓扑、链路追踪
   ========================================================== */

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
  return list.map(r => `<tr class="clickable" ${act('ruleModal', `${r.id}`)}>
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
    <td class="right" data-stop="1">
      <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
        <button class="mini-act" title="${r.status === '生效中' ? '停用规则' : '启用规则'}" ${act('ruleToggle', `${r.id}`)}>${icon('power', '', 13)}</button>
        <button class="mini-act danger" title="删除规则" ${act('ruleDelete', `${r.id}`)}>${icon('archive', '', 13)}</button>
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
        <button class="btn sm primary" ${act('ruleModal', null)}>新建规则</button>
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
        <button class="btn primary" style="width:100%;justify-content:center;margin-top:14px" ${act('ruleModal', `${rule.id}`)}>调整权重</button>
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
    <div class="acts"><button class="btn primary" ${act('ruleModal', null)}>${icon('plus', '', 14)}新建规则</button></div>
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
          `<button class="filter-pill ${S.ruleType === k ? 'on' : ''}" ${act('ruleSet', 'type', `${k}`)}>${n}</button>`).join('')}
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
    svg += `<g class="topo-node"${clickable ? ` style="cursor:pointer" ${act('openTraceBySvc', `${n.n}`)}` : ''}>
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
      <div class="seg"><button class="on" disabled title="实时视图">1 小时</button><button disabled title="历史时段回放尚未开放">6 小时</button><button disabled title="历史时段回放尚未开放">24 小时</button></div>
      <button class="btn" ${act('openTraceBySvc', 'all')}>${icon('trace', '', 14)}链路追踪</button>
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
          `<button class="${S.traceRange === k ? 'on' : ''}" ${act('traceRange', `${k}`)}>${n}</button>`).join('')}
      </div>
      <button class="btn" ${act('toast', '已刷新，最新链路 12 秒前上报')}>${icon('refresh', '', 14)}刷新</button>
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
        `<button class="filter-pill ${S.traceSt === k ? 'on' : ''}" ${act('traceStatus', `${k}`)}>${k === 'all' ? '全部' : k}</button>`).join('')}
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
    return `<tr class="clickable ${on ? 'sel' : ''}" ${act('selectTrace', `${t.id}`)}>
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
        <button class="btn sm" ${act('copyTrace', `${t.id}`)}>${icon('copy', '', 12)}复制</button>
        <button class="btn sm" ${act('go', '/mesh/topology')}>查看拓扑</button>
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
          return `<div class="sp ${S.traceSpan === i ? 'on' : ''}" ${act('selectSpan', (i))}>
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
    ${t.map(([r, n]) => `<div class="tab ${active === r ? 'on' : ''}" ${act('go', `${r}`)}>${n}</div>`).join('')}
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
    <button class="btn sm" ${act('toggleModule', 'edge', false)}>关闭模块</button>
  </div>`;
}

