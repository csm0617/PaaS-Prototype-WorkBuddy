/* ==========================================================
   CloudPaaS — 原型演示数据
   业务模型：应用 (Application) → 组件 (Component) → 工作负载 (Workload)
   ========================================================== */

window.DB = {

  user: { name: '张明', role: '平台管理员', org: '云原生平台部', avatar: '张' },

  envs: [
    { name: '生产环境', code: 'prod', cluster: 'prod-shanghai-01', region: '华东 · 上海', status: '健康', workloads: 24, apps: 7, guard: '严格模式', note: '变更需审批 + 灰度' },
    { name: '预发环境', code: 'staging', cluster: 'staging-shanghai-01', region: '华东 · 上海', status: '健康', workloads: 18, apps: 5, guard: '标准模式', note: '自动发布，允许热更新' },
    { name: '测试环境', code: 'dev', cluster: 'dev-beijing-01', region: '华北 · 北京', status: '维护中', workloads: 12, apps: 4, guard: '宽松模式', note: '每日 02:00 自动回收' }
  ],

  /* ---------------- 应用 - 组件 - 工作负载 ---------------- */
  apps: [
    {
      id: 'retail-platform',
      name: '智慧零售中台',
      domain: '零售业务域',
      owner: '张明',
      level: 'P0',
      status: '运行中',
      health: 99.2,
      desc: '面向门店与线上渠道的统一交易中台，承载下单、库存、履约核心链路。',
      updated: '2026-10-29 11:42',
      envs: ['生产环境', '预发环境'],
      components: [
        {
          name: 'order-service',
          role: '核心服务',
          runtime: 'Java 17 · Spring Boot 3.2',
          image: 'hub.corp.io/retail/order-service',
          version: 'v2.4.1',
          workloads: [
            { name: 'order-service-api', kind: 'Deployment', ready: '4/4', image: 'v2.4.1', cpu: '1.8 / 8c', mem: '4.2 / 8Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '3d12h' },
            { name: 'order-service-worker', kind: 'Deployment', ready: '2/2', image: 'v2.4.1', cpu: '0.6 / 2c', mem: '1.1 / 2Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 1, age: '3d12h' },
            { name: 'order-db', kind: 'StatefulSet', ready: '1/1', image: 'mysql:8.0.34', cpu: '2.4 / 8c', mem: '12 / 16Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '—', restarts: 0, age: '21d' }
          ]
        },
        {
          name: 'inventory-service',
          role: '核心服务',
          runtime: 'Go 1.22',
          image: 'hub.corp.io/retail/inventory-service',
          version: 'v1.9.0',
          workloads: [
            { name: 'inventory-api', kind: 'Deployment', ready: '3/3', image: 'v1.9.0', cpu: '0.9 / 4c', mem: '1.6 / 4Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '5d2h' },
            { name: 'inventory-sync-job', kind: 'CronJob', ready: '—', image: 'v1.9.0', cpu: '0.2 / 1c', mem: '256Mi / 512Mi', status: '已完成', where: '云端', cluster: 'prod-shanghai-01', mesh: '—', restarts: 0, age: '38m' }
          ]
        },
        {
          name: 'api-gateway',
          role: '入口网关',
          runtime: 'Envoy 1.29',
          image: 'hub.corp.io/platform/gateway',
          version: 'v3.1.4',
          workloads: [
            { name: 'api-gateway', kind: 'Deployment', ready: '2/2', image: 'v3.1.4', cpu: '0.4 / 2c', mem: '512Mi / 1Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '网关', restarts: 0, age: '9d' }
          ]
        },
        {
          name: 'stock-collector',
          role: '边缘采集',
          runtime: 'Rust 1.77',
          image: 'hub.corp.io/retail/stock-collector',
          version: 'v0.8.3',
          workloads: [
            { name: 'stock-collector-edge', kind: 'EdgeApp', ready: '12/12', image: 'v0.8.3', cpu: '0.2 / 1c', mem: '180Mi / 512Mi', status: '运行中', where: '边缘', cluster: 'edge-sh-store', mesh: '—', restarts: 2, age: '1d4h' },
            { name: 'stock-reporter', kind: 'EdgeApp', ready: '12/12', image: 'v0.8.3', cpu: '0.1 / 0.5c', mem: '96Mi / 256Mi', status: '运行中', where: '边缘', cluster: 'edge-sh-store', mesh: '—', restarts: 0, age: '1d4h' }
          ]
        }
      ],
      pipelines: ['pl-order', 'pl-inventory'],
      events: [
        { t: '11:42', k: 'ok', tx: '组件 <b>order-service</b> 完成灰度发布，v2.4.1 权重 100%' },
        { t: '11:20', k: 'ok', tx: '工作负载 <b>stock-collector-edge</b> 边缘分发成功（12 个节点）' },
        { t: '09:15', k: 'warn', tx: '工作负载 <b>order-service-worker</b> 发生 1 次容器重启，已自愈' },
        { t: '昨天', k: '', tx: '组件 <b>inventory-service</b> 镜像更新至 v1.9.0' }
      ]
    },
    {
      id: 'order-center',
      name: '订单中心',
      domain: '交易域',
      owner: '李静',
      level: 'P0',
      status: '运行中',
      health: 98.6,
      desc: '订单创建、状态机流转与履约编排服务，强依赖库存与支付。',
      updated: '2026-10-29 10:05',
      envs: ['生产环境'],
      components: [
        {
          name: 'order-core',
          role: '核心服务',
          runtime: 'Java 17 · Spring Boot 3.2',
          image: 'hub.corp.io/trade/order-core',
          version: 'v5.2.0',
          workloads: [
            { name: 'order-core-api', kind: 'Deployment', ready: '6/6', image: 'v5.2.0', cpu: '3.1 / 12c', mem: '6.8 / 12Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '7d' },
            { name: 'order-core-consumer', kind: 'Deployment', ready: '3/3', image: 'v5.2.0', cpu: '1.2 / 4c', mem: '2.4 / 4Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '7d' }
          ]
        },
        {
          name: 'order-archiver',
          role: '异步任务',
          runtime: 'Python 3.12',
          image: 'hub.corp.io/trade/order-archiver',
          version: 'v1.3.2',
          workloads: [
            { name: 'order-archiver-cron', kind: 'CronJob', ready: '—', image: 'v1.3.2', cpu: '0.5 / 2c', mem: '1Gi / 2Gi', status: '已完成', where: '云端', cluster: 'prod-shanghai-01', mesh: '—', restarts: 0, age: '2h' }
          ]
        }
      ],
      pipelines: ['pl-order-core'],
      events: [
        { t: '10:05', k: 'ok', tx: '工作负载 <b>order-core-api</b> 扩容 4 → 6 副本' },
        { t: '08:30', k: '', tx: '组件 <b>order-archiver</b> 完成历史订单归档 128 万条' }
      ]
    },
    {
      id: 'payment-gateway',
      name: '支付网关',
      domain: '交易域',
      owner: '王磊',
      level: 'P0',
      status: '告警',
      health: 94.1,
      desc: '统一支付路由与对账，接入 12 家渠道，含熔断与幂等保障。',
      updated: '2026-10-29 13:28',
      envs: ['生产环境', '预发环境'],
      components: [
        {
          name: 'pay-router',
          role: '核心服务',
          runtime: 'Go 1.22',
          image: 'hub.corp.io/pay/pay-router',
          version: 'v4.0.7',
          workloads: [
            { name: 'pay-router', kind: 'Deployment', ready: '5/5', image: 'v4.0.7', cpu: '2.8 / 8c', mem: '3.2 / 6Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '2d6h' }
          ]
        },
        {
          name: 'channel-adapter',
          role: '渠道适配',
          runtime: 'Java 17',
          image: 'hub.corp.io/pay/channel-adapter',
          version: 'v2.2.1',
          workloads: [
            { name: 'channel-adapter', kind: 'Deployment', ready: '2/3', image: 'v2.2.1', cpu: '1.4 / 3c', mem: '2.1 / 3Gi', status: '降级', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 4, age: '2d6h' }
          ]
        },
        {
          name: 'recon-job',
          role: '对账任务',
          runtime: 'Java 17',
          image: 'hub.corp.io/pay/recon-job',
          version: 'v1.6.0',
          workloads: [
            { name: 'recon-job-daily', kind: 'CronJob', ready: '—', image: 'v1.6.0', cpu: '1 / 4c', mem: '2Gi / 4Gi', status: '已完成', where: '云端', cluster: 'prod-shanghai-01', mesh: '—', restarts: 0, age: '6h' }
          ]
        }
      ],
      pipelines: ['pl-pay'],
      events: [
        { t: '13:28', k: 'bad', tx: '工作负载 <b>channel-adapter</b> 副本不足（2/3），触发告警' },
        { t: '13:25', k: 'warn', tx: '渠道「某银行」超时率升高至 6.2%，熔断器已打开' }
      ]
    },
    {
      id: 'edge-video-ai',
      name: '边缘视频分析',
      domain: '智能边缘',
      owner: '陈曦',
      level: 'P1',
      status: '运行中',
      health: 97.4,
      desc: '门店摄像头实时视频推理，边缘侧完成结构化后回传云端。',
      updated: '2026-10-29 09:50',
      envs: ['生产环境'],
      components: [
        {
          name: 'infer-engine',
          role: '推理引擎',
          runtime: 'CUDA 12.2 · Triton',
          image: 'hub.corp.io/edge/infer-engine',
          version: 'v2.1.0',
          workloads: [
            { name: 'infer-engine-edge', kind: 'EdgeApp', ready: '8/8', image: 'v2.1.0', cpu: '3.2 / 8c', mem: '6Gi / 12Gi', status: '运行中', where: '边缘', cluster: 'edge-sh-store', mesh: '—', restarts: 1, age: '4d' }
          ]
        },
        {
          name: 'video-ingest',
          role: '流接入',
          runtime: 'Go 1.22',
          image: 'hub.corp.io/edge/video-ingest',
          version: 'v1.4.2',
          workloads: [
            { name: 'video-ingest-edge', kind: 'EdgeApp', ready: '8/8', image: 'v1.4.2', cpu: '1.1 / 2c', mem: '1.2 / 2Gi', status: '运行中', where: '边缘', cluster: 'edge-sh-store', mesh: '—', restarts: 0, age: '4d' },
            { name: 'device-agent', kind: 'DeviceAgent', ready: '146/150', image: 'v1.4.2', cpu: '0.1 / 0.5c', mem: '64Mi / 128Mi', status: '运行中', where: '端侧', cluster: '门店终端', mesh: '—', restarts: 1, age: '11d' }
          ]
        }
      ],
      pipelines: ['pl-edge'],
      events: [
        { t: '09:50', k: 'ok', tx: '工作负载 <b>infer-engine-edge</b> 模型热更新至 v2.1.0（8 节点）' },
        { t: '08:12', k: 'warn', tx: '端设备 <b>4 台</b> 心跳超时，已标记离线' }
      ]
    },
    {
      id: 'user-center',
      name: '用户中心',
      domain: '基础域',
      owner: '赵雪',
      level: 'P1',
      status: '运行中',
      health: 99.8,
      desc: '统一账号、身份认证与用户画像基础服务。',
      updated: '2026-10-28 16:20',
      envs: ['生产环境', '预发环境', '测试环境'],
      components: [
        {
          name: 'auth-service',
          role: '核心服务',
          runtime: 'Java 17',
          image: 'hub.corp.io/base/auth-service',
          version: 'v3.6.2',
          workloads: [
            { name: 'auth-service', kind: 'Deployment', ready: '3/3', image: 'v3.6.2', cpu: '0.8 / 4c', mem: '2.1 / 4Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '12d' }
          ]
        },
        {
          name: 'profile-service',
          role: '核心服务',
          runtime: 'Go 1.22',
          image: 'hub.corp.io/base/profile-service',
          version: 'v1.2.8',
          workloads: [
            { name: 'profile-service', kind: 'Deployment', ready: '2/2', image: 'v1.2.8', cpu: '0.5 / 2c', mem: '1.2 / 2Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '12d' }
          ]
        }
      ],
      pipelines: ['pl-user'],
      events: [{ t: '昨天', k: 'ok', tx: '组件 <b>auth-service</b> 密钥轮换完成' }]
    },
    {
      id: 'iot-hub',
      name: '设备接入服务',
      domain: '智能边缘',
      owner: '陈曦',
      level: 'P1',
      status: '运行中',
      health: 96.9,
      desc: 'MQTT 设备接入、协议解析与指令下发，支持断网自治。',
      updated: '2026-10-29 08:31',
      envs: ['生产环境'],
      components: [
        {
          name: 'mqtt-broker',
          role: '接入层',
          runtime: 'EMQX 5.6',
          image: 'hub.corp.io/iot/mqtt-broker',
          version: 'v5.6.1',
          workloads: [
            { name: 'mqtt-broker', kind: 'StatefulSet', ready: '3/3', image: 'v5.6.1', cpu: '1.6 / 6c', mem: '5.4 / 8Gi', status: '运行中', where: '云端', cluster: 'prod-shanghai-01', mesh: '已注入', restarts: 0, age: '18d' }
          ]
        },
        {
          name: 'proto-parser',
          role: '协议解析',
          runtime: 'Rust 1.77',
          image: 'hub.corp.io/iot/proto-parser',
          version: 'v0.9.4',
          workloads: [
            { name: 'proto-parser-edge', kind: 'EdgeApp', ready: '12/12', image: 'v0.9.4', cpu: '0.6 / 2c', mem: '640Mi / 1Gi', status: '运行中', where: '边缘', cluster: 'edge-sh-store', mesh: '—', restarts: 0, age: '6d' }
          ]
        }
      ],
      pipelines: ['pl-iot'],
      events: [{ t: '08:31', k: 'ok', tx: '边缘组件 <b>proto-parser</b> 完成 12 个节点增量下发' }]
    },
    {
      id: 'promo-engine',
      name: '营销活动引擎',
      domain: '零售业务域',
      owner: '李静',
      level: 'P2',
      status: '已停止',
      health: 0,
      desc: '大促规则编排与优惠券发放，活动期弹性伸缩。',
      updated: '2026-10-20 14:00',
      envs: ['测试环境'],
      components: [
        {
          name: 'rule-engine',
          role: '规则计算',
          runtime: 'Java 17',
          image: 'hub.corp.io/mkt/rule-engine',
          version: 'v2.0.0',
          workloads: [
            { name: 'rule-engine', kind: 'Deployment', ready: '0/2', image: 'v2.0.0', cpu: '0 / 4c', mem: '0 / 4Gi', status: '已停止', where: '云端', cluster: 'dev-beijing-01', mesh: '—', restarts: 0, age: '9d' }
          ]
        }
      ],
      pipelines: [],
      events: [{ t: '10-20', k: 'warn', tx: '应用已停止，工作负载副本缩容至 0' }]
    }
  ],

  /* ---------------- 流水线 ---------------- */
  pipelines: [
    {
      id: 'pl-order', name: 'order-service · 主干发布', app: '智慧零售中台', appId: 'retail-platform',
      comp: 'order-service', trigger: 'Git Push', branch: 'main', status: '运行中',
      last: '3 分钟前', success: 96.4, runs: 218, env: '预发环境',
      stages: [
        { n: '代码检出', s: 'done', d: '12s' },
        { n: '编译构建', s: 'done', d: '1m48s' },
        { n: '单元测试', s: 'done', d: '56s' },
        { n: '镜像推送', s: 'done', d: '24s' },
        { n: '部署预发', s: 'done', d: '38s' },
        { n: '自动化回归', s: 'run', d: '2m12s' },
        { n: '人工审批', s: 'wait', d: '—' },
        { n: '灰度发布', s: 'wait', d: '—' }
      ],
      logs: [
        ['14:36:02', 'k', '#8 order-service  pipeline start  trigger=git-push  branch=main'],
        ['14:36:02', 't', 'commit 7f3ac91  "feat: 支持门店自提订单拆分"'],
        ['14:36:04', 'k', 'stage: checkout'],
        ['14:36:16', 'ok', 'stage checkout ✓ 12s'],
        ['14:36:18', 'k', 'stage: build  →  docker build -t order-service:2.4.1'],
        ['14:37:22', 't', 'Step 8/14 : RUN mvn -B clean package -DskipTests'],
        ['14:38:06', 'ok', 'stage build ✓ 1m48s  artifact=order-service-2.4.1.jar (68.4MB)'],
        ['14:38:08', 'k', 'stage: test  →  mvn test  (312 cases)'],
        ['14:39:04', 'ok', 'stage test ✓ 56s  312 passed, 0 failed, coverage 78.2%'],
        ['14:39:06', 'k', 'stage: push  →  hub.corp.io/retail/order-service:2.4.1'],
        ['14:39:30', 'ok', 'stage push ✓ 24s  digest=sha256:a91f...'],
        ['14:39:32', 'k', 'stage: deploy-staging  →  namespace retail-staging'],
        ['14:40:10', 'ok', 'stage deploy-staging ✓ 38s  ready 4/4'],
        ['14:40:12', 'k', 'stage: regression  →  运行接口回归套件'],
        ['14:40:31', 'warn', 'regression: 2 个用例慢查询 (>800ms)，继续执行']
      ],
      history: [
        { no: '#218', status: '运行中', by: '张明', branch: 'main', commit: '7f3ac91', dur: '进行中', time: '14:36' },
        { no: '#217', status: '成功', by: '张明', branch: 'main', commit: 'a02bd77', dur: '6m12s', time: '11:20' },
        { no: '#216', status: '成功', by: 'CI Robot', branch: 'main', commit: 'c81e4f0', dur: '5m58s', time: '09:41' },
        { no: '#215', status: '失败', by: '李静', branch: 'feat/split', commit: '3ad9b12', dur: '2m04s', time: '昨天 18:22' },
        { no: '#214', status: '成功', by: 'CI Robot', branch: 'main', commit: 'e5510ac', dur: '6m20s', time: '昨天 16:05' }
      ]
    },
    {
      id: 'pl-inventory', name: 'inventory-service · 主干发布', app: '智慧零售中台', appId: 'retail-platform',
      comp: 'inventory-service', trigger: 'Git Push', branch: 'main', status: '成功',
      last: '2 小时前', success: 99.1, runs: 402, env: '生产环境',
      stages: [
        { n: '代码检出', s: 'done', d: '9s' },
        { n: '编译构建', s: 'done', d: '52s' },
        { n: '单元测试', s: 'done', d: '31s' },
        { n: '镜像推送', s: 'done', d: '18s' },
        { n: '部署预发', s: 'done', d: '26s' },
        { n: '自动化回归', s: 'done', d: '3m05s' },
        { n: '人工审批', s: 'done', d: '4m20s' },
        { n: '灰度发布', s: 'done', d: '5m00s' }
      ],
      logs: [
        ['11:20:00', 'k', '#402 inventory-service pipeline start'],
        ['11:25:40', 'ok', 'all stages ✓  deploy prod  canary 10% → 50% → 100%'],
        ['11:25:41', 'ok', 'pipeline success  6m20s']
      ],
      history: [
        { no: '#402', status: '成功', by: 'CI Robot', branch: 'main', commit: 'b21f0c3', dur: '6m20s', time: '11:20' },
        { no: '#401', status: '成功', by: '赵雪', branch: 'main', commit: '8cc41de', dur: '6m02s', time: '昨天 15:12' },
        { no: '#400', status: '成功', by: 'CI Robot', branch: 'main', commit: '5ab9e77', dur: '5m48s', time: '昨天 10:30' }
      ]
    },
    {
      id: 'pl-pay', name: 'pay-router · 灰度发布', app: '支付网关', appId: 'payment-gateway',
      comp: 'pay-router', trigger: '手动触发', branch: 'release/4.0', status: '失败',
      last: '1 小时前', success: 88.6, runs: 156, env: '生产环境',
      stages: [
        { n: '代码检出', s: 'done', d: '11s' },
        { n: '编译构建', s: 'done', d: '2m10s' },
        { n: '单元测试', s: 'fail', d: '1m02s' },
        { n: '镜像推送', s: 'wait', d: '—' },
        { n: '部署预发', s: 'wait', d: '—' },
        { n: '自动化回归', s: 'wait', d: '—' },
        { n: '人工审批', s: 'wait', d: '—' },
        { n: '灰度发布', s: 'wait', d: '—' }
      ],
      logs: [
        ['13:20:04', 'k', '#156 pay-router pipeline start'],
        ['13:23:16', 'k', 'stage: test  →  go test ./...'],
        ['13:24:18', 'err', 'FAIL  internal/router/signature_test.go:88'],
        ['13:24:18', 'err', 'expected signature v2, got v1 (渠道「某银行」签名算法未匹配)'],
        ['13:24:19', 'err', 'stage test ✗  pipeline aborted'],
        ['13:24:20', 'warn', '通知已发送：王磊、支付值班群']
      ],
      history: [
        { no: '#156', status: '失败', by: '王磊', branch: 'release/4.0', commit: '9ef2a41', dur: '4m15s', time: '13:20' },
        { no: '#155', status: '成功', by: 'CI Robot', branch: 'main', commit: '0a77c3d', dur: '7m40s', time: '昨天 20:10' },
        { no: '#154', status: '成功', by: '王磊', branch: 'main', commit: 'bb18c2e', dur: '7m22s', time: '昨天 17:35' }
      ]
    },
    {
      id: 'pl-edge', name: 'infer-engine · 边缘分发', app: '边缘视频分析', appId: 'edge-video-ai',
      comp: 'infer-engine', trigger: 'Tag 触发', branch: 'v2.1.0', status: '成功',
      last: '5 小时前', success: 97.2, runs: 64, env: '生产环境',
      stages: [
        { n: '代码检出', s: 'done', d: '14s' },
        { n: '模型校验', s: 'done', d: '1m20s' },
        { n: '镜像构建', s: 'done', d: '3m40s' },
        { n: '签名校验', s: 'done', d: '8s' },
        { n: '边缘灰度', s: 'done', d: '4m12s' },
        { n: '全量分发', s: 'done', d: '6m30s' },
        { n: '健康巡检', s: 'done', d: '2m00s' }
      ],
      logs: [
        ['09:50:01', 'k', '#64 infer-engine tag v2.1.0'],
        ['09:53:41', 'ok', '镜像构建完成  1.82GB (arm64)'],
        ['09:53:49', 'ok', '镜像签名校验通过  cosign verify ✓'],
        ['09:58:01', 'ok', '边缘灰度 ✓ 2 节点  推理 P99 42ms'],
        ['10:04:31', 'ok', '全量分发 ✓ 8/8 节点'],
        ['10:06:31', 'ok', '健康巡检 ✓ 全部节点就绪']
      ],
      history: [
        { no: '#64', status: '成功', by: '陈曦', branch: 'v2.1.0', commit: '7a0c118', dur: '16m30s', time: '09:50' },
        { no: '#63', status: '成功', by: '陈曦', branch: 'v2.0.9', commit: '2e4d90b', dur: '15m10s', time: '昨天 14:00' }
      ]
    },
    {
      id: 'pl-order-core', name: 'order-core · 主干发布', app: '订单中心', appId: 'order-center',
      comp: 'order-core', trigger: 'Git Push', branch: 'main', status: '成功',
      last: '6 小时前', success: 94.8, runs: 331, env: '生产环境',
      stages: [
        { n: '代码检出', s: 'done', d: '10s' },
        { n: '编译构建', s: 'done', d: '2m22s' },
        { n: '单元测试', s: 'done', d: '1m40s' },
        { n: '镜像推送', s: 'done', d: '30s' },
        { n: '部署预发', s: 'done', d: '44s' },
        { n: '自动化回归', s: 'done', d: '4m10s' },
        { n: '人工审批', s: 'done', d: '12m00s' },
        { n: '灰度发布', s: 'done', d: '8m00s' }
      ],
      logs: [['08:00:00', 'k', '#331 order-core pipeline start'], ['08:29:36', 'ok', 'pipeline success']],
      history: [
        { no: '#331', status: '成功', by: '李静', branch: 'main', commit: 'dd03a11', dur: '29m36s', time: '08:00' },
        { no: '#330', status: '成功', by: 'CI Robot', branch: 'main', commit: '12ba9c4', dur: '26m10s', time: '昨天 19:40' }
      ]
    },
    {
      id: 'pl-user', name: 'auth-service · 主干发布', app: '用户中心', appId: 'user-center',
      comp: 'auth-service', trigger: 'Git Push', branch: 'main', status: '成功',
      last: '1 天前', success: 99.6, runs: 512, env: '生产环境',
      stages: [
        { n: '代码检出', s: 'done', d: '8s' },
        { n: '编译构建', s: 'done', d: '1m30s' },
        { n: '单元测试', s: 'done', d: '48s' },
        { n: '镜像推送', s: 'done', d: '15s' },
        { n: '部署预发', s: 'done', d: '22s' },
        { n: '自动化回归', s: 'done', d: '2m30s' },
        { n: '人工审批', s: 'done', d: '3m00s' },
        { n: '灰度发布', s: 'done', d: '4m00s' }
      ],
      logs: [['16:20:00', 'k', '#512 auth-service pipeline start'], ['16:32:15', 'ok', 'pipeline success']],
      history: [
        { no: '#512', status: '成功', by: '赵雪', branch: 'main', commit: 'a91cc02', dur: '12m15s', time: '昨天 16:20' }
      ]
    },
    {
      id: 'pl-iot', name: 'proto-parser · 边缘分发', app: '设备接入服务', appId: 'iot-hub',
      comp: 'proto-parser', trigger: 'Tag 触发', branch: 'v0.9.4', status: '成功',
      last: '8 小时前', success: 98.3, runs: 87, env: '生产环境',
      stages: [
        { n: '代码检出', s: 'done', d: '9s' },
        { n: '交叉编译', s: 'done', d: '1m10s' },
        { n: '镜像构建', s: 'done', d: '2m05s' },
        { n: '签名校验', s: 'done', d: '6s' },
        { n: '边缘灰度', s: 'done', d: '3m00s' },
        { n: '全量分发', s: 'done', d: '5m20s' }
      ],
      logs: [['08:31:00', 'k', '#87 proto-parser tag v0.9.4'], ['08:42:50', 'ok', '全量分发 ✓ 12/12']],
      history: [{ no: '#87', status: '成功', by: '陈曦', branch: 'v0.9.4', commit: 'cc10b3a', dur: '11m50s', time: '08:31' }]
    }
  ],

  /* ---------------- Service Mesh ---------------- */
  mesh: {
    services: [
      { name: 'order-service', ns: 'retail-prod', ver: 'v2.4.1', sidecar: '已注入', rps: '1.24k', success: '99.96%', p99: '48ms', inst: 6, status: '健康' },
      { name: 'inventory-service', ns: 'retail-prod', ver: 'v1.9.0', sidecar: '已注入', rps: '2.10k', success: '99.99%', p99: '12ms', inst: 3, status: '健康' },
      { name: 'pay-router', ns: 'pay-prod', ver: 'v4.0.7', sidecar: '已注入', rps: '860', success: '99.91%', p99: '76ms', inst: 5, status: '健康' },
      { name: 'channel-adapter', ns: 'pay-prod', ver: 'v2.2.1', sidecar: '已注入', rps: '420', success: '96.20%', p99: '1.42s', inst: 2, status: '告警' },
      { name: 'auth-service', ns: 'base-prod', ver: 'v3.6.2', sidecar: '已注入', rps: '3.60k', success: '99.98%', p99: '9ms', inst: 3, status: '健康' },
      { name: 'profile-service', ns: 'base-prod', ver: 'v1.2.8', sidecar: '已注入', rps: '1.05k', success: '99.95%', p99: '22ms', inst: 2, status: '健康' },
      { name: 'mqtt-broker', ns: 'iot-prod', ver: 'v5.6.1', sidecar: '已注入', rps: '8.40k', success: '99.99%', p99: '6ms', inst: 3, status: '健康' },
      { name: 'order-db', ns: 'retail-prod', ver: '8.0.34', sidecar: '未注入', rps: '—', success: '—', p99: '—', inst: 1, status: '跳过' }
    ],
    rules: [
      { name: 'order-service-canary', type: '虚拟服务', host: 'order-service', match: 'header[x-version]=v2', action: '路由 → v2.4.1 (权重 10%)', status: '生效中' },
      { name: 'order-service-retry', type: '目标规则', host: 'order-service', match: '所有请求', action: '重试 3 次 / 超时 800ms', status: '生效中' },
      { name: 'pay-router-circuit', type: '目标规则', host: 'pay-router', match: '所有请求', action: '熔断：连续 5 次 5xx → 隔离 30s', status: '生效中' },
      { name: 'channel-adapter-outlier', type: '目标规则', host: 'channel-adapter', match: '所有请求', action: '异常点驱逐 / 最大 50%', status: '生效中' },
      { name: 'inventory-mirror', type: '虚拟服务', host: 'inventory-service', match: '10% 采样', action: '流量镜像 → inventory-shadow', status: '已停用' }
    ]
  },

  /* ---------------- 云边端 ---------------- */
  edge: {
    nodes: [
      { name: 'edge-sh-007', region: '上海 · 静安嘉里中心店', type: '边缘一体机', cpu: 42, mem: 61, latency: '8ms', status: '在线', wl: 6, ver: 'v1.8.2', sync: '1 分钟前' },
      { name: 'edge-sh-012', region: '上海 · 徐汇港汇店', type: '边缘一体机', cpu: 38, mem: 55, latency: '11ms', status: '在线', wl: 6, ver: 'v1.8.2', sync: '1 分钟前' },
      { name: 'edge-sh-021', region: '上海 · 浦东世纪汇店', type: '边缘一体机', cpu: 67, mem: 74, latency: '13ms', status: '在线', wl: 7, ver: 'v1.8.2', sync: '2 分钟前' },
      { name: 'edge-hz-004', region: '杭州 · 湖滨银泰店', type: '边缘服务器', cpu: 31, mem: 44, latency: '19ms', status: '在线', wl: 5, ver: 'v1.8.1', sync: '3 分钟前' },
      { name: 'edge-hz-009', region: '杭州 · 城西银泰店', type: '边缘服务器', cpu: 88, mem: 91, latency: '21ms', status: '告警', wl: 7, ver: 'v1.8.1', sync: '8 分钟前' },
      { name: 'edge-sz-003', region: '深圳 · 万象城店', type: '边缘一体机', cpu: 25, mem: 33, latency: '26ms', status: '在线', wl: 4, ver: 'v1.8.2', sync: '1 分钟前' },
      { name: 'edge-cd-011', region: '成都 · 太古里店', type: '边缘一体机', cpu: 0, mem: 0, latency: '—', status: '离线', wl: 0, ver: 'v1.7.9', sync: '2 小时前' },
      { name: 'edge-bj-018', region: '北京 · 三里屯店', type: '边缘服务器', cpu: 54, mem: 62, latency: '34ms', status: '在线', wl: 6, ver: 'v1.8.2', sync: '1 分钟前' }
    ],
    dist: [
      { app: '边缘视频分析', comp: 'infer-engine', wl: 'infer-engine-edge', ver: 'v2.1.0', target: '全部门店（8 节点）', strategy: '先灰度 2 节点 → 全量', status: '已完成', progress: 100, time: '10:06' },
      { app: '智慧零售中台', comp: 'stock-collector', wl: 'stock-collector-edge', ver: 'v0.8.3', target: '华东区（12 节点）', strategy: '按区域分批', status: '已完成', progress: 100, time: '11:20' },
      { app: '设备接入服务', comp: 'proto-parser', wl: 'proto-parser-edge', ver: 'v0.9.4', target: '全部门店（12 节点）', strategy: '断网自治，联网后同步', status: '已完成', progress: 100, time: '08:42' },
      { app: '边缘视频分析', comp: 'video-ingest', wl: 'video-ingest-edge', ver: 'v1.4.3', target: '华东区（12 节点）', strategy: '低峰期窗口 02:00-05:00', status: '进行中', progress: 58, time: '进行中' },
      { app: '设备接入服务', comp: 'mqtt-broker', wl: 'mqtt-broker', ver: 'v5.6.1', target: '云端集群', strategy: '标准滚动更新', status: '待调度', progress: 0, time: '—' }
    ],
    devices: [
      { id: 'POS-SH-0042', type: '智能 POS', proto: 'MQTT', node: 'edge-sh-007', status: '在线', fw: 'v3.2.1', last: '12 秒前' },
      { id: 'ESL-SH-1180', type: '电子价签', proto: 'BLE', node: 'edge-sh-007', status: '在线', fw: 'v1.0.8', last: '3 分钟前' },
      { id: 'CAM-SH-0107', type: '视频摄像头', proto: 'RTSP', node: 'edge-sh-012', status: '在线', fw: 'v2.4.0', last: '8 秒前' },
      { id: 'GW-SH-0003', type: 'IoT 网关', proto: 'MQTT', node: 'edge-sh-021', status: '在线', fw: 'v4.1.2', last: '5 秒前' },
      { id: 'POS-HZ-0119', type: '智能 POS', proto: 'MQTT', node: 'edge-hz-009', status: '告警', fw: 'v3.1.9', last: '42 秒前' },
      { id: 'CAM-CD-0033', type: '视频摄像头', proto: 'RTSP', node: 'edge-cd-011', status: '离线', fw: 'v2.3.4', last: '2 小时前' },
      { id: 'ESL-BJ-2201', type: '电子价签', proto: 'BLE', node: 'edge-bj-018', status: '在线', fw: 'v1.0.8', last: '1 分钟前' }
    ]
  },

  /* ---------------- 运维 ---------------- */
  clusters: [
    { name: 'prod-shanghai-01', type: '云端 K8s', region: '华东 · 上海', ver: 'v1.29.4', nodes: 12, cpu: 62, mem: 71, pods: 386, status: '健康' },
    { name: 'staging-shanghai-01', type: '云端 K8s', region: '华东 · 上海', ver: 'v1.29.4', nodes: 4, cpu: 28, mem: 35, pods: 112, status: '健康' },
    { name: 'dev-beijing-01', type: '云端 K8s', region: '华北 · 北京', ver: 'v1.28.9', nodes: 3, cpu: 15, mem: 22, pods: 48, status: '维护中' },
    { name: 'edge-sh-store', type: '边缘集群', region: '华东 · 门店', ver: 'v1.28.6 · K3s', nodes: 12, cpu: 46, mem: 58, pods: 96, status: '健康' },
    { name: 'edge-cd-store', type: '边缘集群', region: '西南 · 门店', ver: 'v1.28.6 · K3s', nodes: 3, cpu: 0, mem: 0, pods: 0, status: '离线' }
  ],

  alerts: [
    { level: '严重', title: 'channel-adapter 副本不足 (2/3)', app: '支付网关', res: 'prod-shanghai-01 / channel-adapter', time: '13:28', status: '未处理' },
    { level: '严重', title: '边缘节点 edge-hz-009 内存使用率 91%', app: '—', res: 'edge-hz-009', time: '13:10', status: '未处理' },
    { level: '警告', title: '支付渠道超时率 6.2%（阈值 3%）', app: '支付网关', res: 'pay-router / 某银行', time: '13:25', status: '处理中' },
    { level: '警告', title: '流水线 #156 失败', app: '支付网关', res: 'pl-pay', time: '13:24', status: '已通知' },
    { level: '警告', title: '端设备 4 台心跳超时', app: '边缘视频分析', res: 'edge-cd-store', time: '08:12', status: '处理中' },
    { level: '提示', title: '证书将于 14 天后到期', app: '—', res: '*.corp.io', time: '昨天', status: '已忽略' }
  ],

  roles: [
    { name: '平台管理员', users: 3, scope: '全部环境 / 全部应用', perm: '读写 + 模块开关 + 授权', builtin: true },
    { name: '应用负责人', users: 12, scope: '所属应用 / 生产环境', perm: '读写（不可改模块配置）', builtin: false },
    { name: '开发者', users: 46, scope: '所属应用 / 测试 + 预发', perm: '读写（生产只读）', builtin: false },
    { name: '运维值班', users: 8, scope: '全部环境', perm: '发布 + 扩缩容 + 重启', builtin: false },
    { name: '只读审计', users: 5, scope: '全部环境', perm: '只读', builtin: false }
  ],

  /* ---------------- 概览补充 ---------------- */
  releases7d: [
    { d: '周一', v: 12 }, { d: '周二', v: 18 }, { d: '周三', v: 9 }, { d: '周四', v: 24 },
    { d: '周五', v: 31 }, { d: '周六', v: 7 }, { d: '周日', v: 14 }
  ],

  /* ==========================================================
     平台网关：对外暴露的统一入口
     两种访问形态 —— 独立域名 / 平台网关路径
     ========================================================== */
  gateway: {
    domain: 'apps.corp.io',
    ip: '104.21.36.8',
    cert: '*.corp.io（泛域名）',
    expire: '82 天',
    engine: 'Envoy Gateway v1.1',
    mode: '公网 + 内网双栈',
    pathRule: 'https://apps.corp.io/{应用标识}/{组件路径}'
  },

  /* 访问入口：按应用归属，env 为部署环境，type 为域名 / 网关路径 */
  access: {
    'retail-platform': [
      { env: '生产环境', type: '域名', url: 'https://retail.corp.io', backend: 'api-gateway:80', scope: '公网', tls: '已签发 · 82 天', auth: 'OAuth2 登录', status: '已生效', hits: '128.4k / 日', note: '主入口，前置 WAF + CDN' },
      { env: '生产环境', type: '网关路径', url: 'https://apps.corp.io/retail-platform/', backend: 'api-gateway:80', scope: '内网', tls: '平台泛域名', auth: '无', status: '已生效', hits: '12.1k / 日', note: '内部系统联调共用' },
      { env: '生产环境', type: '网关路径', url: 'https://apps.corp.io/retail-platform/edge', backend: 'stock-collector:9100', scope: '内网', tls: '平台泛域名', auth: 'API Key', status: '已生效', hits: '860 / 日', note: '边缘回传上报专用' },
      { env: '预发环境', type: '域名', url: 'https://retail-staging.corp.io', backend: 'api-gateway:80', scope: '内网', tls: '已签发 · 21 天', auth: 'Basic Auth', status: '已生效', hits: '1.2k / 日', note: '仅研发与测试网段' }
    ],
    'order-center': [
      { env: '生产环境', type: '域名', url: 'https://order.corp.io', backend: 'order-core-api:8080', scope: '公网', tls: '已签发 · 64 天', auth: 'OAuth2 登录', status: '已生效', hits: '46.2k / 日', note: '订单 H5 与小程序回调' },
      { env: '生产环境', type: '网关路径', url: 'https://apps.corp.io/order-center/', backend: 'order-core-api:8080', scope: '内网', tls: '平台泛域名', auth: '无', status: '已生效', hits: '8.4k / 日' }
    ],
    'payment-gateway': [
      { env: '生产环境', type: '域名', url: 'https://pay.corp.io', backend: 'pay-router:8443', scope: '内网', tls: '已签发 · 47 天', auth: 'mTLS 双向认证', status: '已生效', hits: '32.8k / 日', note: '仅允许业务网关网段访问' },
      { env: '生产环境', type: '网关路径', url: 'https://apps.corp.io/pay/', backend: 'pay-router:8443', scope: '内网', tls: '平台泛域名', auth: 'mTLS 双向认证', status: '已生效', hits: '5.1k / 日' },
      { env: '预发环境', type: '域名', url: 'https://pay-staging.corp.io', backend: 'pay-router:8443', scope: '内网', tls: '自签证书', auth: 'mTLS 双向认证', status: '已生效', hits: '220 / 日' }
    ],
    'edge-video-ai': [
      { env: '生产环境', type: '域名', url: 'https://ai-store.corp.io', backend: 'video-ingest:9000', scope: '公网', tls: '已签发 · 71 天', auth: 'API Key', status: '已生效', hits: '18.6k / 日', note: '门店摄像头推流鉴权' },
      { env: '生产环境', type: '网关路径', url: 'https://apps.corp.io/edge-ai/', backend: 'video-ingest:9000', scope: '内网', tls: '平台泛域名', auth: 'API Key', status: '已生效', hits: '3.2k / 日' }
    ],
    'user-center': [
      { env: '生产环境', type: '域名', url: 'https://id.corp.io', backend: 'auth-service:8080', scope: '公网', tls: '已签发 · 90 天', auth: 'OIDC', status: '已生效', hits: '210.5k / 日', note: '统一登录，全站 SSO' },
      { env: '生产环境', type: '网关路径', url: 'https://apps.corp.io/user/', backend: 'auth-service:8080', scope: '内网', tls: '平台泛域名', auth: '无', status: '已生效', hits: '14.0k / 日' }
    ],
    'iot-hub': [
      { env: '生产环境', type: '域名', url: 'mqtts://iot.corp.io:8883', backend: 'mqtt-broker:8883', scope: '公网', tls: '已签发 · 58 天', auth: '设备证书', status: '已生效', hits: '8.4k 连接', note: 'MQTT over TLS，非 HTTP 协议' },
      { env: '生产环境', type: '网关路径', url: 'https://apps.corp.io/iot/', backend: 'mqtt-broker:8083', scope: '内网', tls: '平台泛域名', auth: 'API Key', status: '已生效', hits: '1.6k / 日' }
    ],
    'promo-engine': [
      { env: '测试环境', type: '网关路径', url: 'https://apps.corp.io/promo/', backend: 'rule-engine:8080', scope: '内网', tls: '平台泛域名', auth: '无', status: '已停用', hits: '—', note: '应用已停止，入口同步下线' }
    ]
  },

  /* 组件依赖：声明式（平台内核维护），与服务拓扑的观测式调用链相互独立 */
  deps: {
    'retail-platform': [
      ['api-gateway', 'order-service', 'HTTP · 1.2k rps'],
      ['api-gateway', 'inventory-service', 'HTTP · 860 rps'],
      ['order-service', 'inventory-service', 'gRPC · 2.1k'],
      ['stock-collector', 'inventory-service', 'MQTT 上报', 'async']
    ],
    'order-center': [
      ['order-core', 'order-archiver', '归档读取', 'async']
    ],
    'payment-gateway': [
      ['pay-router', 'channel-adapter', 'HTTP · 420 rps'],
      ['pay-router', 'recon-job', '对账拉取', 'async']
    ],
    'edge-video-ai': [
      ['video-ingest', 'infer-engine', 'RTSP 帧分发', 'async']
    ],
    'user-center': [
      ['auth-service', 'profile-service', 'HTTP · 1.1k rps']
    ],
    'iot-hub': [
      ['mqtt-broker', 'proto-parser', 'MQTT 订阅', 'async']
    ],
    'promo-engine': []
  }
};
