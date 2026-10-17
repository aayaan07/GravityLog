/**
 * GravityLog - Local Background Service & API Server
 * Zero-dependency Node.js HTTP server.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const TelemetryIndexer = require('./engine/indexer');

// Antigravity injects ANTIGRAVITY_SIDECAR_WEB_PORT for web UI sidecars!
const PORT = parseInt(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT, 10) || parseInt(process.env.PORT, 10) || 49221;
const indexer = new TelemetryIndexer();

// Initial background scan
try {
  console.log('[Server] Starting initial telemetry scan...');
  indexer.scanIncrementally();
  console.log('[Server] Initial scan complete.');
} catch (e) {
  console.error('[Server] Initial scan error:', e.message);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

function handleExport(res, format, preview = false) {
  const data = preview ? indexer.getPreviewData() : indexer.scanIncrementally();

  if (format === 'csv') {
    let csv = 'Date,Requests,Tokens,InputTokens,OutputTokens,IntensityLevel\n';
    for (const d of data.heatmap) {
      csv += `${d.date},${d.requests},${d.tokens},${d.inputTokens},${d.outputTokens},${d.level}\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=UTF-8',
      'Content-Disposition': 'attachment; filename="gravitylog-usage-analytics.csv"',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(csv);
  }

  // JSON
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Disposition': 'attachment; filename="gravitylog-usage-analytics.json"',
    'Access-Control-Allow-Origin': '*'
  });
  return res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // API Routes
  if (pathname === '/api/health') {
    return sendJson(res, 200, { status: 'ok', service: 'gravitylog-analytics', version: '1.0.0', time: new Date().toISOString() });
  }

  if (pathname === '/api/metrics') {
    const timeframe = query.timeframe || 'all';
    const isPreview = query.preview === 'true';
    if (isPreview) {
      return sendJson(res, 200, indexer.getPreviewData());
    }
    if (query.refresh === 'true') {
      try {
        indexer.scanIncrementally();
      } catch (e) {
        console.warn('[Server] Incremental scan error on refresh:', e.message);
      }
    }
    const metrics = indexer.aggregate(timeframe);
    return sendJson(res, 200, metrics);
  }

  if (pathname === '/api/refresh') {
    try {
      const fresh = indexer.scanIncrementally();
      return sendJson(res, 200, { success: true, count: fresh.totals.requests, metrics: fresh });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  if (pathname === '/api/export') {
    const format = (query.format || 'json').toLowerCase();
    const isPreview = query.preview === 'true';
    return handleExport(res, format, isPreview);
  }

  // Static File Serving (from ./ui, ./, or ./assets)
  let filePath = '';
  if (pathname === '/' || pathname === '/index.html' || pathname === '/dashboard.html') {
    filePath = path.join(__dirname, 'ui', 'dashboard.html');
  } else if (pathname.startsWith('/ui/')) {
    filePath = path.join(__dirname, pathname);
  } else {
    const cleanPath = pathname.replace(/^\//, '');
    const possibleUi = path.join(__dirname, 'ui', cleanPath);
    const possibleRoot = path.join(__dirname, cleanPath);
    const possibleAssets = path.join(__dirname, 'assets', cleanPath);

    if (fs.existsSync(possibleUi) && fs.statSync(possibleUi).isFile()) {
      filePath = possibleUi;
    } else if (fs.existsSync(possibleRoot) && fs.statSync(possibleRoot).isFile()) {
      filePath = possibleRoot;
    } else if (fs.existsSync(possibleAssets) && fs.statSync(possibleAssets).isFile()) {
      filePath = possibleAssets;
    } else {
      filePath = possibleRoot;
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*'
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('404 Not Found');
});

// Guard against unhandled EADDRINUSE crashes
server.on('error', (err) => {
  console.error('[GravityLog] Server error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.warn(`[GravityLog] Port ${PORT} already active.`);
    if (!process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
      server.listen(0, '127.0.0.1', () => {
        console.log(`[GravityLog] Fallback service listening on http://127.0.0.1:${server.address().port}`);
      });
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[GravityLog] Service listening on http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

module.exports = { server, indexer };
