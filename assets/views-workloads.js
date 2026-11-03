/* ==========================================================
   视图：工作负载详情与运行时数据生成（Pod/指标/日志/事件/YAML/终端）
   ========================================================== */

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
/* ---------- 工作负载运行配置 → YAML ---------- */
function rtProbe(comp, w, key) {
  const p = (w.runtime && w.runtime.probes) || {};
  if (p.inherit !== false) {
    if (key === 'liveness') return { path: comp.healthPath || '/healthz', port: comp.port || 8080, initialDelay: 15, period: 10, timeout: 1, failure: 3 };
    if (key === 'readiness') return { path: comp.readyPath || '/readyz', port: comp.port || 8080, initialDelay: 5, period: 5, timeout: 1, failure: 3 };
    return { enabled: false };
  }
  return p[key] || {};
}
function probeBlock(name, p, ind) {
  if (!p || p.enabled === false) return [];
  return [
    `${ind}${name}:`,
    `${ind}  httpGet:`,
    `${ind}    path: ${p.path}`,
    `${ind}    port: ${p.port}`,
    `${ind}  initialDelaySeconds: ${p.initialDelay || 0}`,
    `${ind}  periodSeconds: ${p.period || 10}`,
    `${ind}  timeoutSeconds: ${p.timeout || 1}`,
    `${ind}  failureThreshold: ${p.failure || 3}`
  ];
}
function probeYamlLines(comp, w, ind) {
  const startup = rtProbe(comp, w, 'startup');
  return [
    ...(startup.enabled ? probeBlock('startupProbe', startup, ind) : []),
    ...probeBlock('livenessProbe', rtProbe(comp, w, 'liveness'), ind),
    ...probeBlock('readinessProbe', rtProbe(comp, w, 'readiness'), ind)
  ];
}
function kvYamlLines(obj, ind) {
  return Object.entries(obj || {})
    .filter(([k, v]) => k && v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${ind}${k}: "${String(v).replace(/"/g, '\\"')}"`);
}
function preStopYamlLines(w, ind) {
  const cmd = w.runtime && w.runtime.lifecycle && w.runtime.lifecycle.preStop;
  if (!cmd) return [];
  return [
    `${ind}lifecycle:`,
    `${ind}  preStop:`,
    `${ind}    exec:`,
    `${ind}      command: ${JSON.stringify(['/bin/sh', '-c', cmd])}`
  ];
}
/* 调度约束：节点选择器 / 容忍度 / 拓扑分布 */
function scheduleYamlLines(sched, wlName, ind) {
  const out = [];
  const sel = (sched && sched.nodeSelector) || {};
  if (Object.keys(sel).length) out.push(`${ind}nodeSelector:`, ...kvYamlLines(sel, ind + '  '));
  const tol = (sched && sched.tolerations) || [];
  if (tol.length) {
    out.push(`${ind}tolerations:`);
    tol.forEach(t => {
      out.push(`${ind}  - key: ${t.key}`);
      out.push(`${ind}    operator: ${t.operator}`);
      if (t.operator === 'Equal') out.push(`${ind}    value: ${t.value}`);
      out.push(`${ind}    effect: ${t.effect}`);
    });
  }
  const sp = (sched && sched.spread) || {};
  if (sp.enabled) {
    out.push(
      `${ind}topologySpreadConstraints:`,
      `${ind}  - maxSkew: ${sp.maxSkew}`,
      `${ind}    topologyKey: ${sp.topologyKey}`,
      `${ind}    whenUnsatisfiable: ${sp.whenUnsatisfiable}`,
      `${ind}    labelSelector:`,
      `${ind}      matchLabels:`,
      `${ind}        app: ${wlName}`
    );
  }
  return out;
}
function yamlFor(app, comp, w) {
  if (w.kind === 'CronJob') return cronYaml(app, comp, w);
  const { cur: cpuCur, cap: cpuCap } = parseRes(w.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(w.mem, 'mem');
  const np = w.replicas || 0;
  const reqCpu = Math.max(0.1, cpuCap / 4), reqMem = Math.max(0.25, memCap / 2);
  const inject = w.mesh === '已注入' && S.modules.mesh;
  const rt = w.runtime || {};
  const u = rt.update || { strategy: 'RollingUpdate', maxSurge: '25%', maxUnavailable: '0', minReadySeconds: 10 };
  const rtLabels = rt.labels || w.labels || {};
  const rtAnnotations = rt.annotations || w.annotations || {};
  const strategyLines = [
    '  strategy:',
    `    type: ${u.strategy}`,
    ...(u.strategy === 'RollingUpdate' ? [
      '    rollingUpdate:',
      ...(w.kind !== 'StatefulSet' ? [`      maxSurge: ${u.maxSurge}`] : []),
      `      maxUnavailable: ${u.maxUnavailable}`
    ] : []),
    `  minReadySeconds: ${u.minReadySeconds}`
  ];
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
    ...kvYamlLines(rtLabels, '    '),
    'spec:',
    `  replicas: ${np}`,
    ...strategyLines,
    '  selector:',
    '    matchLabels:',
    `      app: ${w.name}`,
    '  template:',
    '    metadata:',
    '      labels:',
    `        app: ${w.name}`,
    ...kvYamlLines(rtLabels, '        '),
    '      annotations:',
    `        sidecar.istio.io/inject: "${inject ? 'true' : 'false'}"`,
    '        platform.io/scheduled-to: ' + w.where,
    ...kvYamlLines(rtAnnotations, '        '),
    '    spec:',
    `      serviceAccountName: ${app.id}-sa`,
    `      terminationGracePeriodSeconds: ${(rt.lifecycle && rt.lifecycle.grace) ?? 30}`,
    ...scheduleYamlLines(rt.schedule, w.name, '      '),
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
    ...probeYamlLines(comp, w, '          '),
    ...preStopYamlLines(w, '          '),
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
    const e = rt.edge || {};
    const i = base.findIndex(l => /^  replicas: /.test(l));
    base.splice(i + 1, 0,
      '  targetNodes:',
      `    selector: ${e.targetSelector}`,
      `    count: ${e.count}`,
      '  offlinePolicy:',
      `    bufferSeconds: ${e.bufferSeconds}`,
      `    onReconnect: ${e.offlinePolicy}`);
  }
  const hpa = rt.autoscaling || {};
  if (hpa.enabled && kind !== 'EdgeApp') {
    base.push(
      '---',
      'apiVersion: autoscaling/v2',
      'kind: HorizontalPodAutoscaler',
      'metadata:',
      `  name: ${w.name}`,
      `  namespace: ${app.id.split('-')[0]}-prod`,
      'spec:',
      '  scaleTargetRef:',
      '    apiVersion: apps/v1',
      `    kind: ${kind}`,
      `    name: ${w.name}`,
      `  minReplicas: ${hpa.min}`,
      `  maxReplicas: ${hpa.max}`,
      '  metrics:',
      '    - type: Resource',
      '      resource:',
      '        name: cpu',
      '        target:',
      '          type: Utilization',
      `          averageUtilization: ${hpa.targetCPU}`
    );
  }
  return base;
}
function cronYaml(app, comp, w) {
  const { cur: cpuCur, cap: cpuCap } = parseRes(w.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(w.mem, 'mem');
  const rt = w.runtime || {};
  const rtLabels = rt.labels || w.labels || {};
  const rtAnnotations = rt.annotations || w.annotations || {};
  const c = rt.cron || {};
  const lines = [
    'apiVersion: batch/v1',
    'kind: CronJob',
    'metadata:',
    `  name: ${w.name}`,
    `  namespace: ${app.id.split('-')[0]}-prod`,
    '  labels:',
    `    app.kubernetes.io/name: ${comp.name}`,
    `    app.kubernetes.io/part-of: ${app.id}`,
    ...kvYamlLines(rtLabels, '    '),
    'spec:',
    `  schedule: "${c.schedule}"`,
    `  concurrencyPolicy: ${c.concurrencyPolicy}`,
    `  suspend: ${c.suspend ? 'true' : 'false'}`,
    `  startingDeadlineSeconds: ${c.startingDeadline}`,
    `  successfulJobsHistoryLimit: ${c.successHistory}`,
    `  failedJobsHistoryLimit: ${c.failedHistory}`,
    '  jobTemplate:',
    '    spec:',
    '      backoffLimit: 2',
    '      template:',
    '        metadata:',
    '          labels:',
    `            app: ${w.name}`,
    ...kvYamlLines(rtLabels, '            '),
    '          annotations:',
    ...kvYamlLines(rtAnnotations, '            '),
    '        spec:',
    '          restartPolicy: OnFailure',
    `          serviceAccountName: ${app.id}-sa`,
    `          terminationGracePeriodSeconds: ${(rt.lifecycle && rt.lifecycle.grace) ?? 30}`,
    ...scheduleYamlLines(rt.schedule, w.name, '          '),
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
    ...envYamlLines(effectiveEnv(app, comp, w), '                '),
    ...probeYamlLines(comp, w, '              '),
    ...preStopYamlLines(w, '              ')
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
      <button class="btn primary" ${act('go', '/workloads')}>返回工作负载列表</button>
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

  const tabs = [['overview', '概览'], ['metrics', '指标'], ['logs', '日志'], ['events', '事件'], ['runtime', '运行配置'], ['io', '配置与存储'], ['yaml', 'YAML'], ['terminal', '终端']];
  const { cur: cpuCur, cap: cpuCap } = parseRes(wl.cpu, 'cpu');
  const { cur: memCur, cap: memCap } = parseRes(wl.mem, 'mem');
  const pods = podsFor(wl);

  return `
  <div class="page-head">
    <div style="min-width:0">
      <div class="ttl" style="display:flex;align-items:center;gap:9px">${esc(wl.name)} ${badge(wl.status)} <span class="chip">${esc(wl.kind)}</span></div>
      <div class="sub">
        <span class="link" ${act('go', `/apps/${app.id}/components`)}>${esc(app.name)}</span>
        <span class="muted"> / </span>
        <span class="link" ${act('go', `/apps/${app.id}/components`)}>${esc(comp.name)}</span>
        <span class="muted"> / </span><span class="mono">${esc(wl.image)}</span>
        · ${whereChip(wl.where)} <span class="mono">${esc(wl.cluster)}</span>
        ${wl.mesh === '已注入' && S.modules.mesh ? '· <span class="badge info">Sidecar 已注入</span>' : ''}
      </div>
      <div class="lbl-row">${labelChips(wl.labels, 4)}</div>
    </div>
    <div class="acts">
      <button class="btn" ${act('wlGo', 'logs')}>${icon('doc', '', 14)}日志</button>
      <button class="btn" ${act('wlGo', 'terminal')}>${icon('server', '', 14)}终端</button>
      <button class="btn" ${act('editWorkload', `${app.id}`, `${comp.name}`, `${wl.name}`)}>编辑</button>
      <button class="btn" ${act('wlRestart', `${app.id}`, `${comp.name}`, `${wl.name}`)}>${icon('refresh', '', 14)}重启</button>
      <button class="btn primary" ${act('go', '/cicd')}>${icon('flow', '', 14)}发布</button>
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
      ${tabs.map(([k, n]) => `<div class="tab ${S.wlTab === k ? 'on' : ''}" ${act('wlGo', `${k}`)}>${n}</div>`).join('')}
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
  if (S.wlTab === 'runtime') return wlRuntimeView(app, comp, wl);
  if (S.wlTab === 'io') return wlIOView(app, comp, wl);
  if (S.wlTab === 'yaml') return wlYamlView(app, comp, wl);
  if (S.wlTab === 'terminal') return wlTerminalView(wl);
  return wlOverviewView(app, comp, wl, pods);
}

/* 状态条件：由副本数与状态推导，和 kubectl get 里的 Conditions 口径一致 */
function wlConditions(w) {
  if (w.kind === 'CronJob') {
    const c = (w.runtime && w.runtime.cron) || {};
    return [
      { type: 'Suspended', status: c.suspend ? 'True' : 'False', reason: c.suspend ? 'CronJobSuspended' : 'CronJobActive', msg: c.suspend ? '已暂停调度' : '按计划触发', tone: c.suspend ? 'warn' : 'ok' },
      { type: 'Progressing', status: 'True', reason: 'ScheduleActive', msg: `下次按 ${c.schedule || '*/5 * * * *'} 触发`, tone: 'ok' }
    ];
  }
  const want = w.replicas || 0;
  const ready = Math.min(w.readyN || 0, want);
  const available = want > 0 && ready === want;
  const failing = w.status === '异常';
  return [
    { type: 'Available', status: available ? 'True' : 'False', reason: available ? 'MinimumReplicasAvailable' : want === 0 ? 'NoReplicas' : 'MinimumReplicasUnavailable', msg: `${ready}/${want} 实例就绪`, tone: available ? 'ok' : want === 0 ? 'muted' : 'bad' },
    { type: 'Progressing', status: failing ? 'False' : 'True', reason: failing ? 'ReplicaSetUpdated' : 'NewReplicaSetAvailable', msg: failing ? '副本未收敛' : '副本已收敛', tone: failing ? 'bad' : 'ok' },
    { type: 'ReplicaFailure', status: failing ? 'True' : 'False', reason: failing ? 'FailedCreate' : 'None', msg: failing ? '存在创建失败的实例' : '无', tone: failing ? 'bad' : 'muted' }
  ];
}
function wlOverviewView(app, comp, wl, pods) {
  const m = wlMetrics(wl, '1h');
  const ev = eventsFor(wl, comp).slice(-3).reverse();
  const inject = wl.mesh === '已注入' && S.modules.mesh;
  const rt = wl.runtime || {};
  const live = rtProbe(comp, wl, 'liveness');
  const ready = rtProbe(comp, wl, 'readiness');
  const startup = rtProbe(comp, wl, 'startup');
  const sched = rt.schedule || {};
  const selCount = Object.keys(sched.nodeSelector || {}).length;
  const tolCount = (sched.tolerations || []).length;
  const spread = sched.spread || {};
  const cronCfg = rt.cron || {};
  const edgeCfg = rt.edge || {};
  const schedText = `${selCount} 个节点标签${tolCount ? ` · ${tolCount} 条容忍` : ''}${spread.enabled ? ` · 拓扑分布 ${spread.topologyKey}` : ''}`;
  return `
  <div class="card-body" style="padding:11px 16px;border-bottom:1px solid var(--border)">
    <div style="display:flex;flex-wrap:wrap;gap:7px;align-items:center">
      <span class="tiny muted" style="margin-right:3px">状态条件</span>
      ${wlConditions(wl).map(c => `<span class="badge ${c.tone}" title="${esc(c.type)}: ${esc(c.reason)} — ${esc(c.msg)}"><i></i>${esc(c.type)}=${esc(c.status)}</span>`).join('')}
    </div>
  </div>

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
        <dt>存活探针</dt><dd class="mono" style="font-size:11px">GET ${esc(live.path)} :${live.port} · ${live.period}s</dd>
        <dt>就绪探针</dt><dd class="mono" style="font-size:11px">GET ${esc(ready.path)} :${ready.port} · ${ready.period}s</dd>
        ${startup.enabled ? `<dt>启动探针</dt><dd class="mono" style="font-size:11px">GET ${esc(startup.path)} :${startup.port} · ${startup.period}s</dd>` : ''}
        <dt>更新策略</dt><dd>${esc(rt.update ? rt.update.strategy : 'RollingUpdate')}${rt.update && rt.update.strategy === 'RollingUpdate' ? ` · ${esc(rt.update.maxSurge)} / ${esc(rt.update.maxUnavailable)}` : ''}</dd>
        <dt>弹性伸缩</dt><dd>${rt.autoscaling && rt.autoscaling.enabled ? `HPA ${rt.autoscaling.min}-${rt.autoscaling.max} · CPU ${rt.autoscaling.targetCPU}%` : '未启用'}</dd>
        <dt>优雅终止</dt><dd>${rt.lifecycle ? rt.lifecycle.grace : 30}s${rt.lifecycle && rt.lifecycle.preStop ? ` · preStop ${esc(rt.lifecycle.preStop)}` : ''}</dd>
        <dt>调度约束</dt><dd>${esc(schedText)}</dd>
        ${wl.kind === 'CronJob' ? `<dt>调度计划</dt><dd class="mono" style="font-size:11px">${esc(cronCfg.schedule)}${cronCfg.suspend ? ' · 已暂停' : ''}</dd>` : ''}
        ${wl.kind === 'EdgeApp' ? `<dt>边缘策略</dt><dd>${esc(edgeCfg.count)} 个节点 · 离线${edgeCfg.offlinePolicy === 'replay' ? '回放' : edgeCfg.offlinePolicy === 'drop' ? '丢弃' : '云端接管'}</dd>` : ''}
        <dt>调度位置</dt><dd>${whereChip(wl.where)} <span class="mono muted" style="font-size:10.5px">${esc(wl.cluster)}</span></dd>
      </dl>
    </div>
    <div style="padding:14px 16px">
      <div class="tiny muted" style="margin-bottom:9px">最近事件</div>
      ${ev.map(e => `<div style="display:flex;gap:7px;margin-bottom:7px;font-size:11.5px">
        <span class="badge ${e.type === 'Warning' ? 'warn' : 'muted'}" style="flex:none">${e.reason}</span>
        <span style="color:var(--text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45">${esc(e.msg)}</span>
      </div>`).join('')}
      <div class="link tiny" ${act('wlGo', 'events')}>查看全部事件 →</div>
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
        `<button class="${range === k ? 'on' : ''}" ${act('wlSetRange', `${k}`)}>${n}</button>`).join('')}
    </div>
    <span class="tiny muted">采样 15s · 数据来自 Prometheus（原型模拟）</span>
    <div class="grow"><button class="btn sm" ${act('toast', '已刷新指标')}>${icon('refresh', '', 12)}刷新</button></div>
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
      `<button class="filter-pill ${L.level === k ? 'on' : ''}" ${act('logSet', 'level', `${k}`)}>${k === 'all' ? '全部' : k}</button>`).join('')}
    <div class="search" style="margin:0;width:190px">${icon('search', '', 13)}
      <input placeholder="过滤关键字" value="${esc(L.q)}" oninput="logSet('q', this.value, true)" />
    </div>
    <div class="grow">
      <button class="btn sm ${L.paused ? 'primary' : ''}" ${act('logTogglePause')}>${L.paused ? '继续跟随' : '暂停'}</button>
      <button class="btn sm" ${act('logClear')}>清空</button>
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
    <div class="grow"><button class="btn sm" ${act('toast', '已刷新事件')}>${icon('refresh', '', 12)}刷新</button></div>
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
      <button class="btn sm" ${act('setYamlDiff', (showDiff ? 'false' : 'true'))}>${showDiff ? '退出对比' : '与运行态对比'}</button>
      <button class="btn sm" ${act('toast', 'YAML 已复制到剪贴板', 'ok')}>${icon('copy', '', 12)}复制</button>
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
  const blocked = releaseLockReason(app, '重启工作负载', comp);
  if (blocked) return toast(blocked, 'warn');
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

