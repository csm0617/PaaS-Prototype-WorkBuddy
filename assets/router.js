/* ==========================================================
   路由与启动
   ========================================================== */

/* ==========================================================
   路由
   ========================================================== */
function route() {
  const { seg, params } = parseHash();
  hydrateListState(seg, params);

  try {
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
    document.querySelectorAll('#view .chart').forEach(bindChart);
    if (LOG_TIMER) { clearInterval(LOG_TIMER); LOG_TIMER = null; }
    if (seg[0] === 'workloads' && seg[1]) mountWorkload();
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error('[route] 渲染失败:', err);
    renderErrorPage(err);
  }
  renderSidebar();
}

/* ---------------- 启动 ---------------- */
normalizeModel();
normalizeAccess();
normalizeAccessApplied();
migrateRefs();
normalizeWorkloadRoles();
normalizeWorkloadRuntime();
normalizeIO();
normalizeEdge();
normalizeClusters();
normalizeEdgeDist();
/* 全局兜底：视图错误由 route 的 try/catch 接管，这里记录异步错误，避免静默白屏 */
window.addEventListener('error', e => console.error('[window error]', e.error || e.message));
window.addEventListener('unhandledrejection', e => console.error('[unhandled rejection]', e.reason));
window.addEventListener('hashchange', route);
renderTopbar();
renderSidebar();
route();
