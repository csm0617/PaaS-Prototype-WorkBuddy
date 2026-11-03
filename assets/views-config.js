/* ==========================================================
   视图：配置与密钥、配置与存储、全局存储
   ========================================================== */

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
/* ==========================================================
   工作负载运行配置：更新策略 / 探针 / 生命周期 / 弹性 / 标签注解
   ========================================================== */
const rtInput = (id, value, type = 'text', attrs = '') =>
  `<input class="input" id="${id}" type="${type}" value="${esc(value)}" ${attrs} />`;
const rtSelect = (id, opts, value) =>
  `<select class="input" id="${id}">${opts.map(o => {
    const v = Array.isArray(o) ? o[0] : o;
    const n = Array.isArray(o) ? o[1] : o;
    return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(n)}</option>`;
  }).join('')}</select>`;
function rtKvText(obj) {
  return Object.entries(obj || {}).map(([k, v]) => `${k}=${v}`).join('\n');
}
function rtParseKv(text) {
  const data = {}, errors = [];
  String(text || '').split('\n').forEach(line => {
    const s = line.trim();
    if (!s) return;
    const i = s.indexOf('=');
    if (i < 1) return errors.push(s);
    const k = s.slice(0, i).trim(), v = s.slice(i + 1).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(k) || !v) return errors.push(s);
    data[k] = v;
  });
  return { data, errors };
}
/* 容忍度：每行 key=value:Effect，只有 key 时按 Exists 处理 */
function rtTolText(list) {
  return (list || []).map(t => `${t.key}${t.operator === 'Equal' ? `=${t.value}` : ''}:${t.effect}`).join('\n');
}
function rtParseTolerations(text) {
  const list = [], errors = [];
  String(text || '').split('\n').forEach(line => {
    const s = line.trim();
    if (!s) return;
    const seg = s.split(':');
    const body = (seg[0] || '').trim();
    const effect = (seg[1] || '').trim();
    const eq = body.indexOf('=');
    const key = (eq > -1 ? body.slice(0, eq) : body).trim();
    const value = eq > -1 ? body.slice(eq + 1).trim() : '';
    if (!key || (eq > -1 && !value)) return errors.push(s);
    if (effect && !['NoSchedule', 'PreferNoSchedule', 'NoExecute'].includes(effect)) return errors.push(s);
    list.push({ key, operator: eq > -1 ? 'Equal' : 'Exists', value, effect: effect || 'NoSchedule' });
  });
  return { list, errors };
}
/* 运行配置快照：只保留可回滚字段，避免把变更记录自身递归进去 */
function rtSnapshot(wl) {
  const r = wl.runtime || {};
  return JSON.parse(JSON.stringify({
    update: r.update,
    probes: r.probes,
    lifecycle: r.lifecycle,
    autoscaling: r.autoscaling,
    schedule: r.schedule,
    cron: r.cron,
    edge: r.edge,
    labels: r.labels,
    annotations: r.annotations
  }));
}
function runtimeToggleInherit(on) {
  document.querySelectorAll('#wl-runtime [data-probe]').forEach(el => { el.disabled = on; });
}
function runtimeToggleHpa(on) {
  document.querySelectorAll('#wl-runtime [data-hpa]').forEach(el => { el.disabled = !on; });
}
function wlRuntimeView(app, comp, wl) {
  const r = wl.runtime;
  const isCron = wl.kind === 'CronJob';
  const isEdge = wl.kind === 'EdgeApp';
  const probeRow = (key, label, p, extra = '') => `<tr>
    <td class="name">${extra}${label}</td>
    <td>${rtInput(`rt-${key}-path`, p.path, 'text', `data-probe ${r.probes.inherit ? 'disabled' : ''}`)}</td>
    <td>${rtInput(`rt-${key}-port`, p.port, 'number', `data-probe ${r.probes.inherit ? 'disabled' : ''}`)}</td>
    <td>${rtInput(`rt-${key}-delay`, p.initialDelay, 'number', `data-probe ${r.probes.inherit ? 'disabled' : ''}`)}</td>
    <td>${rtInput(`rt-${key}-period`, p.period, 'number', `data-probe ${r.probes.inherit ? 'disabled' : ''}`)}</td>
    <td>${rtInput(`rt-${key}-timeout`, p.timeout, 'number', `data-probe ${r.probes.inherit ? 'disabled' : ''}`)}</td>
    <td>${rtInput(`rt-${key}-failure`, p.failure, 'number', `data-probe ${r.probes.inherit ? 'disabled' : ''}`)}</td>
  </tr>`;
  return `<div class="card-body" id="wl-runtime" style="padding:16px">
    <div class="spread" style="margin-bottom:12px">
      <div>
        <div style="font-size:14px;font-weight:650">运行配置</div>
        <div class="tiny muted" style="margin-top:3px">这些字段只作用于当前工作负载；探针可以选择继承组件契约。</div>
      </div>
      <button class="btn primary" ${act('saveWlRuntime', `${app.id}`, `${comp.name}`, `${wl.name}`)}>保存运行配置</button>
    </div>

    <div class="form-sec">更新策略</div>
    ${isCron ? '<div class="tiny muted">定时任务由 CronJob 调度，更新策略与弹性伸缩不适用。</div>' : `
      <div class="form-row">
        ${fField('策略', rtSelect('rt-strategy', ['RollingUpdate', 'Recreate', 'OnDelete'], r.update.strategy), '滚动更新 / 重建 / 手动删除后更新')}
        ${fField('maxSurge', rtInput('rt-surge', r.update.maxSurge), '数字或百分比，例如 25%')}
        ${fField('maxUnavailable', rtInput('rt-unavail', r.update.maxUnavailable), '数字或百分比，例如 0')}
        ${fField('minReadySeconds', rtInput('rt-minready', r.update.minReadySeconds, 'number'), '新实例就绪后至少稳定多少秒')}
      </div>`}

    <div class="form-sec">副本弹性</div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <input type="checkbox" id="rt-hpa" ${r.autoscaling.enabled ? 'checked' : ''} ${isCron || isEdge ? 'disabled' : ''}
        onchange="runtimeToggleHpa(this.checked)" />
      启用 HPA 自动扩缩容${isCron || isEdge ? '（当前类型不支持）' : ''}
    </label>
    <div class="form-row">
      ${fField('最小副本', rtInput('rt-hpa-min', r.autoscaling.min, 'number', `data-hpa ${r.autoscaling.enabled && !isCron && !isEdge ? '' : 'disabled'}`))}
      ${fField('最大副本', rtInput('rt-hpa-max', r.autoscaling.max, 'number', `data-hpa ${r.autoscaling.enabled && !isCron && !isEdge ? '' : 'disabled'}`))}
      ${fField('CPU 目标', rtInput('rt-hpa-cpu', r.autoscaling.targetCPU, 'number', `data-hpa ${r.autoscaling.enabled && !isCron && !isEdge ? '' : 'disabled'}`), '百分比，例如 70')}
    </div>

    <div class="form-sec">健康检查</div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <input type="checkbox" id="rt-inherit" ${r.probes.inherit ? 'checked' : ''} onchange="runtimeToggleInherit(this.checked)" />
      继承组件服务契约中的探针路径与端口
    </label>
    <div style="overflow-x:auto">
    <table class="table">
      <thead><tr><th>探针</th><th>路径</th><th>端口</th><th>延迟(s)</th><th>周期(s)</th><th>超时(s)</th><th>失败阈值</th></tr></thead>
      <tbody>
        ${probeRow('liveness', '存活探针', r.probes.liveness)}
        ${probeRow('readiness', '就绪探针', r.probes.readiness)}
        ${probeRow('startup', '启动探针', r.probes.startup,
          `<input type="checkbox" id="rt-startup-enabled" data-probe ${r.probes.inherit ? 'disabled' : ''} ${r.probes.startup.enabled ? 'checked' : ''} style="margin-right:5px" />`)}
      </tbody>
    </table>
    </div>

    <div class="form-sec">生命周期</div>
    <div class="form-row">
      ${fField('优雅终止（秒）', rtInput('rt-grace', r.lifecycle.grace, 'number'), '默认 30 秒')}
      ${fField('preStop 命令', rtInput('rt-prestop', r.lifecycle.preStop), '例如：sleep 5，留空表示不执行')}
    </div>

    <div class="form-sec">调度约束</div>
    <div class="form-row">
      ${fField('节点选择器', `<textarea class="input" id="rt-node-selector" rows="3">${esc(rtKvText(r.schedule.nodeSelector))}</textarea>`, '每行 key=value，节点需同时满足')}
      ${fField('容忍度', `<textarea class="input" id="rt-tolerations" rows="3">${esc(rtTolText(r.schedule.tolerations))}</textarea>`, '每行 key=value:Effect，值可省略（Exists）')}
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <input type="checkbox" id="rt-spread" ${r.schedule.spread.enabled ? 'checked' : ''} />
      启用拓扑分布约束（让实例分散到不同故障域）
    </label>
    <div class="form-row">
      ${fField('拓扑键', rtInput('rt-spread-key', r.schedule.spread.topologyKey), '例如 topology.kubernetes.io/zone')}
      ${fField('maxSkew', rtInput('rt-spread-skew', r.schedule.spread.maxSkew, 'number'), '允许的最大不均衡数')}
      ${fField('不满足时', rtSelect('rt-spread-when', ['ScheduleAnyway', 'DoNotSchedule'], r.schedule.spread.whenUnsatisfiable), '调度优先 / 硬性约束')}
    </div>

    ${isCron ? `
    <div class="form-sec">定时调度</div>
    <div class="form-row">
      ${fField('Cron 表达式', rtInput('rt-cron-schedule', r.cron.schedule), '例如 */5 * * * *')}
      ${fField('并发策略', rtSelect('rt-cron-concurrency', ['Forbid', 'Allow', 'Replace'], r.cron.concurrencyPolicy), '上次未结束时如何处理')}
      ${fField('启动截止（秒）', rtInput('rt-cron-deadline', r.cron.startingDeadline, 'number'), '错过调度的容忍时间')}
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <input type="checkbox" id="rt-cron-suspend" ${r.cron.suspend ? 'checked' : ''} /> 暂停调度（保留配置，不再创建新任务）
    </label>
    <div class="form-row">
      ${fField('成功记录保留', rtInput('rt-cron-ok', r.cron.successHistory, 'number'), '个数')}
      ${fField('失败记录保留', rtInput('rt-cron-fail', r.cron.failedHistory, 'number'), '个数')}
    </div>` : ''}

    ${isEdge ? `
    <div class="form-sec">边缘策略</div>
    <div class="form-row">
      ${fField('目标节点选择器', rtInput('rt-edge-selector', r.edge.targetSelector), '按节点标签挑选目标')}
      ${fField('目标节点数', rtInput('rt-edge-count', r.edge.count, 'number'), '期望覆盖的节点数量')}
      ${fField('离线策略', rtSelect('rt-edge-policy', [['replay', '恢复后回放'], ['drop', '离线期间丢弃'], ['cloud', '切换云端处理']], r.edge.offlinePolicy))}
      ${fField('离线缓存（秒）', rtInput('rt-edge-buffer', r.edge.bufferSeconds, 'number'), '断连期间保留多久的数据')}
    </div>` : ''}

    <div class="form-sec">标签与注解</div>
    <div class="form-row">
      ${fField('Labels', `<textarea class="input" id="rt-labels" rows="4">${esc(rtKvText(r.labels))}</textarea>`, '每行 key=value')}
      ${fField('Annotations', `<textarea class="input" id="rt-annotations" rows="4">${esc(rtKvText(r.annotations))}</textarea>`, '每行 key=value')}
    </div>

    <div class="form-sec">变更记录</div>
    ${runtimeHistoryRows(app, comp, wl)}
  </div>`;
}
function runtimeHistoryRows(app, comp, wl) {
  const list = wl.runtime.revisions || [];
  if (!list.length) return '<div class="tiny muted">尚无运行配置变更记录，保存后会自动留档，最多保留 10 条。</div>';
  return `<div style="overflow-x:auto"><table class="table">
    <thead><tr><th>时间</th><th>操作人</th><th>说明</th><th class="right">操作</th></tr></thead>
    <tbody>${list.map((rev, i) => `<tr>
      <td class="mono" style="font-size:11px">${esc(rev.t)}</td>
      <td>${esc(rev.by)}</td>
      <td>${esc(rev.note)}</td>
      <td class="right"><button class="btn sm" ${act('rollbackWlRuntime', `${app.id}`, `${comp.name}`, `${wl.name}`, i)}>回滚</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}
function saveWlRuntime(appId, compName, wlName) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  const wl = comp && findWl(comp, wlName);
  if (!wl) return;
  const blocked = releaseLockReason(app, '修改运行配置', compName);
  if (blocked) return toast(blocked, 'warn');
  const val = id => { const el = $('#' + id); return el ? String(el.value).trim() : ''; };
  const num = (id, min, max, fallback) => {
    const raw = val(id);
    if (raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const isCron = wl.kind === 'CronJob';
  const isEdge = wl.kind === 'EdgeApp';
  const errors = [];
  const strategy = val('rt-strategy') || 'RollingUpdate';
  const maxSurge = val('rt-surge') || '25%';
  const maxUnavailable = val('rt-unavail') || '0';
  if (!/^\d+%?$/.test(maxSurge)) errors.push('maxSurge 需为数字或百分比');
  if (!/^\d+%?$/.test(maxUnavailable)) errors.push('maxUnavailable 需为数字或百分比');
  const minReady = num('rt-minready', 0, 86400, 10);
  if (minReady === null) errors.push('minReadySeconds 需为 0-86400');

  const inherit = !!($('#rt-inherit') && $('#rt-inherit').checked);
  const probe = (key, def) => {
    const path = val(`rt-${key}-path`) || def.path;
    const port = num(`rt-${key}-port`, 1, 65535, def.port);
    const delay = num(`rt-${key}-delay`, 0, 86400, def.initialDelay);
    const period = num(`rt-${key}-period`, 1, 86400, def.period);
    const timeout = num(`rt-${key}-timeout`, 1, 3600, def.timeout);
    const failure = num(`rt-${key}-failure`, 1, 100, def.failure);
    if (!path.startsWith('/')) errors.push(`${key} 探针路径需以 / 开头`);
    if (port === null) errors.push(`${key} 探针端口需为 1-65535`);
    if (delay === null || period === null || timeout === null || failure === null) errors.push(`${key} 探针的时间参数不正确`);
    return { path, port: port || def.port, initialDelay: delay, period, timeout, failure };
  };
  const liveness = probe('liveness', wl.runtime.probes.liveness);
  const readiness = probe('readiness', wl.runtime.probes.readiness);
  const startup = probe('startup', wl.runtime.probes.startup);
  startup.enabled = !!($('#rt-startup-enabled') && $('#rt-startup-enabled').checked);

  const hpaOn = !!($('#rt-hpa') && $('#rt-hpa').checked) && !isCron && !isEdge;
  const min = num('rt-hpa-min', 1, 1000, 2);
  const max = num('rt-hpa-max', 1, 1000, 10);
  const cpu = num('rt-hpa-cpu', 1, 100, 70);
  if (hpaOn && (min === null || max === null || cpu === null || min > max)) errors.push('HPA 参数不正确：需满足 1 ≤ 最小副本 ≤ 最大副本，CPU 目标 1-100');

  const grace = num('rt-grace', 0, 86400, 30);
  if (grace === null) errors.push('优雅终止时间需为 0-86400');
  const labels = rtParseKv(val('rt-labels'));
  const annotations = rtParseKv(val('rt-annotations'));
  if (labels.errors.length) errors.push(`Labels 格式不正确：${labels.errors[0]}`);
  if (annotations.errors.length) errors.push(`Annotations 格式不正确：${annotations.errors[0]}`);

  const nodeSelector = rtParseKv(val('rt-node-selector'));
  if (nodeSelector.errors.length) errors.push(`节点选择器格式不正确：${nodeSelector.errors[0]}`);
  const tolerations = rtParseTolerations(val('rt-tolerations'));
  if (tolerations.errors.length) errors.push(`容忍度格式不正确：${tolerations.errors[0]}（示例 key=value:NoSchedule）`);
  const spreadOn = !!($('#rt-spread') && $('#rt-spread').checked);
  const spreadKey = val('rt-spread-key');
  const spreadSkew = num('rt-spread-skew', 1, 100, 1);
  if (spreadOn && !spreadKey) errors.push('启用拓扑分布后需填写拓扑键');
  if (spreadOn && spreadSkew === null) errors.push('maxSkew 需为 1-100');

  const cron = Object.assign({}, wl.runtime.cron);
  if (isCron) {
    cron.schedule = val('rt-cron-schedule');
    cron.concurrencyPolicy = val('rt-cron-concurrency') || 'Forbid';
    cron.suspend = !!($('#rt-cron-suspend') && $('#rt-cron-suspend').checked);
    cron.startingDeadline = num('rt-cron-deadline', 0, 86400, 120);
    cron.successHistory = num('rt-cron-ok', 0, 100, 3);
    cron.failedHistory = num('rt-cron-fail', 0, 100, 1);
    if (cron.schedule.split(/\s+/).length !== 5) errors.push('Cron 表达式需为 5 段，例如 */5 * * * *');
    if (cron.startingDeadline === null || cron.successHistory === null || cron.failedHistory === null) errors.push('定时调度的数值参数不正确');
  }

  const edge = Object.assign({}, wl.runtime.edge);
  if (isEdge) {
    edge.targetSelector = val('rt-edge-selector');
    edge.count = num('rt-edge-count', 1, 10000, 12);
    edge.offlinePolicy = val('rt-edge-policy') || 'replay';
    edge.bufferSeconds = num('rt-edge-buffer', 0, 604800, 3600);
    if (!edge.targetSelector) errors.push('边缘策略需填写目标节点选择器');
    if (edge.count === null || edge.bufferSeconds === null) errors.push('边缘策略的数值参数不正确');
  }

  if (errors.length) return toast(errors[0], 'warn');

  wl.runtime.update = { strategy, maxSurge, maxUnavailable, minReadySeconds: minReady };
  wl.runtime.probes = { inherit, liveness, readiness, startup };
  wl.runtime.lifecycle = { grace, preStop: val('rt-prestop') };
  wl.runtime.autoscaling = { enabled: hpaOn, min: min || 2, max: max || 10, targetCPU: cpu || 70 };
  wl.runtime.schedule = {
    nodeSelector: nodeSelector.data,
    tolerations: tolerations.list,
    spread: {
      enabled: spreadOn,
      topologyKey: spreadKey || 'topology.kubernetes.io/zone',
      maxSkew: spreadSkew || 1,
      whenUnsatisfiable: val('rt-spread-when') || 'ScheduleAnyway'
    }
  };
  if (isCron) wl.runtime.cron = cron;
  if (isEdge) wl.runtime.edge = edge;
  wl.runtime.labels = labels.data;
  wl.runtime.annotations = annotations.data;
  wl.labels = Object.assign({}, labels.data);
  wl.annotations = Object.assign({}, annotations.data);

  wl.runtime.revisions.unshift({ t: nowStamp(), by: DB.user.name, note: '保存运行配置', snap: rtSnapshot(wl) });
  wl.runtime.revisions = wl.runtime.revisions.slice(0, 10);

  app.updated = nowStamp();
  app.events.unshift({ t: clockNow(), k: '', tx: `工作负载 <b>${esc(wl.name)}</b> 运行配置已更新` });
  saveSnapshot();
  route();
  toast('运行配置已保存', 'ok');
}
/* 回滚到某条历史快照，并把回滚本身也记一笔，避免历史断档 */
function rollbackWlRuntime(appId, compName, wlName, idx) {
  const app = DB.apps.find(a => a.id === appId);
  const comp = app && findComp(app, compName);
  const wl = comp && findWl(comp, wlName);
  const rev = wl && wl.runtime.revisions[idx];
  if (!rev) return toast('该变更记录不存在', 'warn');
  const blocked = releaseLockReason(app, '回滚运行配置', compName);
  if (blocked) return toast(blocked, 'warn');
  Object.assign(wl.runtime, JSON.parse(JSON.stringify(rev.snap)));
  wl.labels = Object.assign({}, wl.runtime.labels || {});
  wl.annotations = Object.assign({}, wl.runtime.annotations || {});
  wl.runtime.revisions.unshift({ t: nowStamp(), by: DB.user.name, note: `回滚到 ${rev.t}`, snap: rtSnapshot(wl) });
  wl.runtime.revisions = wl.runtime.revisions.slice(0, 10);
  app.updated = nowStamp();
  app.events.unshift({ t: clockNow(), k: '', tx: `工作负载 <b>${esc(wl.name)}</b> 运行配置回滚到 ${esc(rev.t)}` });
  saveSnapshot();
  route();
  toast('已回滚到所选版本', 'ok');
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
        <button class="btn sm primary" ${act('wlEnvNew')}>${icon('plus', '', 12)}新增变量</button>
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
                 <button class="btn sm ghost" style="height:18px;padding:0 5px;margin-left:4px" ${act('ioReveal', `${esc(e.key)}`)}>显示</button>`
              : esc(String(e.value).slice(0, 60))}
          </td>
          <td>${e.from === 'app' ? '<span class="chip blue">应用配置</span>' : '<span class="chip">工作负载</span>'}</td>
          <td class="tiny">${e.from === 'app' ? esc(e.scope === 'all' ? '全部组件' : e.scope) : '仅本负载'}</td>
          <td>${e.secret ? '<span class="badge purple">secretKeyRef</span>' : '<span class="badge muted">明文</span>'}</td>
          <td class="right" data-stop="1">
            <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
              ${e.from === 'app'
                ? `<button class="btn sm" ${act('go', `/apps/${app.id}/config`)}>去配置页</button>`
                : `<button class="btn sm" ${act('wlEnvEdit', `${esc(e.key)}`)}>编辑</button>
                   <button class="mini-act danger" title="删除变量" ${act('wlEnvDelete', `${esc(e.key)}`)}>${icon('archive', '', 13)}</button>`}
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
        <button class="btn sm primary" ${act('wlVolNew')}>${icon('plus', '', 12)}新增存储卷</button>
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
            : `<button class="mini-act danger" title="移除挂载" ${act('wlVolDelete', `${esc(v.name)}`)}>${icon('archive', '', 13)}</button>`}
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
    <div class="acts"><button class="btn" ${act('toast', '存储类由集群管理员在基础设施侧维护')}>存储类说明</button></div>
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
  return rows.map(p => `<tr class="clickable" ${act('openWlIO', `${p.appId}`, `${esc(p.comp)}`, `${esc(p.wl)}`)}>
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
/* 一条配置实际被哪些工作负载使用：作用域匹配、且未被同名自有变量覆盖 */
function cfgRefs(app, c) {
  const empty = { effective: [], overridden: [] };
  if (!c) return empty;
  const comps = app.components.filter(x => c.scope === 'all' || x.id === c.scope || x.name === c.scope);
  const effective = [], overridden = [];
  comps.forEach(x => x.workloads.forEach(w => {
    const own = c.mount !== 'file' && (w.env || []).some(e => e.key === c.key);
    (own ? overridden : effective).push({ comp: x, wl: w });
  }));
  return { effective, overridden };
}
function cfgRefText(app, c) {
  const r = cfgRefs(app, c);
  return `${r.effective.length} 个工作负载` + (r.overridden.length ? ` · ${r.overridden.length} 个被覆盖` : '');
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
           <button class="btn sm ghost" style="height:18px;padding:0 5px;margin-left:4px" ${act('cfgReveal', `${app.id}`, `${c.id}`)}>显示</button>`
        : ioValPreview(c.value)}
    </td>
    <td>${c.scope === 'all' ? '<span class="chip">全部组件</span>' : `<span class="chip blue">${esc(compLabel(app, c.scope))}</span>`}
      <div class="sub">${cfgRefText(app, c)}</div></td>
    <td>${c.mount === 'file'
      ? `<span class="badge info">文件挂载</span><div class="sub mono">${esc(c.path || '/etc/app/conf')}</div>`
      : `<span class="badge outline">环境变量</span>`}</td>
    <td>${c.secret ? '<span class="badge purple">密钥</span>' : '<span class="badge muted">明文</span>'}</td>
    <td class="tiny muted">${esc(c.updated)}</td>
    <td class="right">
      <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
        <button class="btn sm" ${act('cfgEdit', `${app.id}`, `${c.id}`)}>编辑</button>
        <button class="mini-act danger" title="删除" ${act('cfgDelete', `${app.id}`, `${c.id}`)}>${icon('archive', '', 13)}</button>
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
        `<button class="filter-pill ${S.cfgType === k ? 'on' : ''}" ${act('cfgSet', 'type', `${k}`)}>${n}</button>`).join('')}
      <div class="grow">
        <span class="tiny muted" style="align-self:center" id="cfg-count">${shown} / ${list.length} 项</span>
        <button class="btn sm primary" ${act('cfgNew', `${app.id}`)}>${icon('plus', '', 12)}新增配置</button>
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
      ${item ? (() => {
        const r = cfgRefs(app, item);
        if (!r.effective.length && !r.overridden.length) return '';
        return `<div class="warn-box" style="margin-bottom:11px">
          <b>修改影响面</b>：当前有 <b>${r.effective.length}</b> 个工作负载使用该配置${r.overridden.length ? `，另有 ${r.overridden.length} 个被同名变量覆盖、不受影响` : ''}。
          ${r.effective.length ? `<div class="mono" style="font-size:11px;margin-top:5px;color:var(--text-2)">${r.effective.slice(0, 4).map(x => esc(x.wl.name)).join('、')}${r.effective.length > 4 ? ' 等' : ''}</div>` : ''}
          <div class="tiny muted" style="margin-top:5px">${(item.mount || 'env') === 'file'
            ? '文件挂载方式：保存后约 1 分钟内自动同步到容器，无需重启。'
            : '环境变量方式：保存后需要重启工作负载才会生效。'}</div>
        </div>`;
      })() : ''}
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
  const refs = cfgRefs(app, item).effective;
  formModal({
    title: '删除配置项',
    desc: `${item.key} · 作用域 ${compLabel(app, item.scope)}`,
    danger: true,
    okText: '确认删除',
    body: refs.length
      ? `<div class="danger-box">
          仍有 <b>${refs.length}</b> 个工作负载在使用该配置：
          <div class="mono" style="font-size:11px;margin-top:5px">${refs.slice(0, 4).map(r => esc(r.wl.name)).join('、')}${refs.length > 4 ? ' 等' : ''}</div>
          <div style="margin-top:6px">按规则 R-06，应先把这些工作负载改绑到别的配置，或调整作用域。</div>
        </div>
        ${fCheck('force', '我知道删除后这些工作负载将缺少该配置项，强制删除', false)}`
      : `<p style="margin:0;font-size:12.5px;color:var(--text-2)">当前没有工作负载引用该配置，可以安全删除。</p>`,
    onSubmit: st => {
      if (refs.length && !st.force) return `仍有 ${refs.length} 个工作负载引用该配置，请先解绑或勾选强制删除`;
      DB.config[appId] = ensureConfig(app).filter(c => c.id !== id);
      app.updated = nowStamp();
      app.events.unshift({ t: clockNow(), k: 'warn', tx: `配置 <b>${esc(item.key)}</b> 已删除${refs.length ? `（强制，影响 ${refs.length} 个工作负载）` : ''}` });
      saveSnapshot();
      route();
      toast('配置已删除', 'ok');
      return null;
    }
  });
}

