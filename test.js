/**
 * GravityLog - Verification & Test Suite
 */

const fs = require('fs');
const path = require('path');
const TelemetryIndexer = require('./engine/indexer');

async function runTests() {
  console.log('=== GravityLog Usage Analytics Test Suite ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // Test 1: TelemetryIndexer instantiation & live scan
  console.log('[Test 1] Testing TelemetryIndexer scan and metrics...');
  const indexer = new TelemetryIndexer();
  const liveData = indexer.scanIncrementally();
  assert(liveData && typeof liveData === 'object', 'scanIncrementally returned object');
  assert(liveData.totals && typeof liveData.totals.requests === 'number', 'totals.requests is number');
  assert(typeof liveData.totals.tokens === 'number', 'totals.tokens is number');
  assert(Array.isArray(liveData.heatmap), 'heatmap is an array');
  assert(liveData.heatmap.length >= 365, `heatmap has 365+ days (actual: ${liveData.heatmap.length})`);
  assert(liveData.streaks && typeof liveData.streaks.current === 'number', 'streaks.current is number');
  assert(Array.isArray(liveData.models), 'models is an array');
  assert(liveData.mostUsedModel && liveData.mostUsedModel.name, 'mostUsedModel is detected');

  console.log(`    -> Live stats: ${liveData.totals.requests} requests, ${liveData.totals.tokens.toLocaleString()} tokens, top model: ${liveData.mostUsedModel.name} (${liveData.mostUsedModel.share}%)`);

  // Test 2: Preview sample data matching reference image
  console.log('\n[Test 2] Testing Fallback / Preview Sample Data (Reference Image Matching)...');
  const previewData = indexer.getPreviewData();
  assert(previewData.isPreview === true, 'previewData has isPreview=true');
  assert(previewData.totals.requests === 3614, `previewData has exact requests (3,614)`);
  assert(previewData.totals.tokens === 115100000, `previewData has exact tokens (115.1M)`);
  assert(previewData.totals.inputTokens === 105800000, `previewData input tokens (105.8M)`);
  assert(previewData.totals.outputTokens === 9300000, `previewData output tokens (9.3M)`);
  assert(previewData.totals.requestsToday === 14, `previewData requests today (+14 today)`);
  assert(previewData.models.length >= 3, 'previewData contains multiple models');
  assert(previewData.heatmap.length >= 365, 'previewData heatmap contains 365+ days');
  assert(previewData.streaks.current === 14, 'previewData active streak is 14 days');

  // Test 3: Timeframe filtering
  console.log('\n[Test 3] Testing Timeframe filtering (today, 1w, 30d, 90d, all)...');
  const dToday = indexer.aggregate('today');
  const d1w = indexer.aggregate('1w');
  const d30 = indexer.aggregate('30d');
  const d90 = indexer.aggregate('90d');
  const dAll = indexer.aggregate('all');
  assert(dToday.totals.requests <= d1w.totals.requests, 'today requests <= 1w requests');
  assert(d1w.totals.requests <= d30.totals.requests, '1w requests <= 30d requests');
  assert(d30.totals.requests <= dAll.totals.requests, '30d requests <= all-time requests');
  assert(dAll.totals.inputTokens >= 1000000, `Input tokens accurate (actual: ${dAll.totals.inputTokens.toLocaleString()})`);
  assert(dAll.totals.outputTokens >= 100000, `Output tokens accurate (actual: ${dAll.totals.outputTokens.toLocaleString()})`);

  // Test 4: File existence
  console.log('\n[Test 4] Verifying required plugin files...');
  const files = [
    'plugin.json',
    'mcp_config.json',
    'server.js',
    path.join('engine', 'indexer.js'),
    path.join('mcp', 'mcp_server.js'),
    path.join('ui', 'dashboard.html'),
    path.join('ui', 'dashboard.css'),
    path.join('ui', 'dashboard.js'),
    path.join('ui', 'html2canvas.min.js'),
    path.join('ui', 'injector.js'),
    path.join('sidecars', 'usage-analytics', 'sidecar.json'),
    path.join('skills', 'usage-analytics', 'SKILL.md')
  ];

  for (const f of files) {
    const full = path.join(__dirname, f);
    assert(fs.existsSync(full), `File exists: ${f}`);
  }

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
