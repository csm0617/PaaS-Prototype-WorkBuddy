/* ==========================================================
   视图：边缘节点、应用分发、端设备
   ========================================================== */

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
      <button class="btn" ${act('toast', '接入指引：门店侧安装 Agent → 执行接入命令 → 云端自动纳管')}>接入指引</button>
      <button class="btn primary" ${act('addEdgeNode')}>${icon('plus', '', 14)}添加节点</button>
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
      <button class="filter-pill on" ${act('statusFilter', '#nodeTable','all')}>全部</button>
      <button class="filter-pill" ${act('statusFilter', '#nodeTable','在线')}>在线</button>
      <button class="filter-pill" ${act('statusFilter', '#nodeTable','告警')}>告警</button>
      <button class="filter-pill" ${act('statusFilter', '#nodeTable','离线')}>离线</button>
      ${pend ? `<button class="filter-pill" ${act('statusFilter', '#nodeTable','待激活')}>待激活</button>` : ''}
      <div class="grow"><span class="tiny muted" style="align-self:center">Agent 版本 v1.8.2 统一</span></div>
    </div>
    <table class="table" id="nodeTable">
      <thead><tr><th>节点</th><th>位置</th><th>类型</th><th>CPU</th><th>内存</th><th>回源延迟</th><th>工作负载</th><th>最近同步</th><th>状态</th></tr></thead>
      <tbody>${nodes.map(n => `
        <tr class="clickable" data-q="${esc(n.name)} ${esc(n.region)} ${esc(n.type)}" data-status="${esc(n.status)}" ${act('goto', `#/edge/nodes/${encodeURIComponent(n.name)}`)}>
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
      <button class="btn primary" ${act('goto', '#/edge/nodes')}>返回节点列表</button>
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
        <span class="link tiny" ${act('goto', '#/edge/nodes')}>边缘节点</span>
        <span class="muted">/</span>
        <span class="ttl" style="font-size:16px">${esc(n.name)}</span>
        ${badge(n.status)}
        ${n.cordoned ? '<span class="badge muted">已封锁调度</span>' : ''}
      </div>
      <div class="sub">${esc(n.region)} · <b>${esc(n.type)}</b> · 集群 <span class="mono">${esc(n.cluster)}</span> · Agent <span class="mono">${esc(n.agent)}</span></div>
    </div>
    <div class="acts">
      ${n.status === '待激活' ? `<button class="btn primary" ${act('nodeActivate', `${esc(n.name)}`)}>${icon('refresh', '', 14)}模拟上线</button>
        <button class="btn" ${act('joinModal', `${esc(n.name)}`)}>查看接入命令</button>` : `
        <button class="btn" ${act('nodeSync', `${esc(n.name)}`)}>${icon('refresh', '', 14)}立即同步</button>
        <button class="btn" ${act('nodeCordon', `${esc(n.name)}`)}>${n.cordoned ? '解除封锁' : '封锁调度'}</button>`}
      <button class="btn danger" ${act('nodeRemove', `${esc(n.name)}`)}>移除节点</button>
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
        <tbody>${wls.map((w, i) => `<tr class="clickable" ${act('goto', `${wlUrl(w.appId, w.comp, w.name)}`)}>
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
          <tbody>${devs.map(d => `<tr class="clickable" ${act('goto', '#/edge/devices')}>
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
    <div class="acts"><button class="btn primary" ${act('newDist')}>${icon('send', '', 14)}新建分发</button></div>
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
          <tr class="clickable" ${act('distDetail', `${d.id}`)}>
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
      <button class="filter-pill on" ${act('statusFilter', '#devTable','all')}>全部</button>
      <button class="filter-pill" ${act('statusFilter', '#devTable','POS')}>POS</button>
      <button class="filter-pill" ${act('statusFilter', '#devTable','摄像头')}>摄像头</button>
      <button class="filter-pill" ${act('statusFilter', '#devTable','价签')}>价签</button>
      <div class="grow"><span class="tiny muted" style="align-self:center">心跳周期 30s</span></div>
    </div>
    <table class="table" id="devTable">
      <thead><tr><th>设备 ID</th><th>类型</th><th>协议</th><th>所属边缘节点</th><th>固件</th><th>最近心跳</th><th>状态</th></tr></thead>
      <tbody>${DB.edge.devices.map(d => `
        <tr class="clickable" data-q="${esc(d.id)} ${esc(d.type)} ${esc(d.node)}" data-status="${esc(d.type)}" ${act('deviceDetail', `${d.id}`)}>
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
    <button class="btn primary" ${act('toggleModule', `${key}`, true)}>启用${name}</button>
    <button class="btn" style="margin-left:8px" ${act('go', '/admin/modules')}>查看模块管理</button>
  </div></div>`;
}

/* ---------- 集群 ---------- */

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
        <button class="btn sm" ${act('devicePing', `${esc(d.id)}`)}>下发探活</button>
        <button class="btn sm" ${act('deviceUpgrade', `${esc(d.id)}`)}>固件升级</button>
        <button class="btn sm" ${act('deviceUnbind', `${esc(d.id)}`)}>解绑设备</button>
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
          ['单环境部署', '生产环境一体化，灰度与回滚承担验证', 'v4.2.0'],
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
        <button class="switch ${m.on ? 'on' : ''}" ${act('toggleModule', `${m.key}`, (!m.on))} title="${m.on ? '关闭' : '启用'}"></button>
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
      <button class="btn sm" ${act('go', `${m.key === 'mesh' ? '/mesh' : '/edge/nodes'}`)} ${m.on ? '' : 'disabled'}>进入模块</button>
      <button class="btn sm ghost" ${act('moduleConfig', `${m.key}`)}>配置</button>
      <button class="btn sm ghost" ${act('moduleDocs', `${m.key}`)}>文档</button>
    </div>
  </div>`;
}
