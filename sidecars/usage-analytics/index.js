/**
 * GravityLog - Antigravity Sidecar Entrypoint for Usage Analytics
 */
const path = require('path');
const fs = require('fs');

const candidatePaths = [
  path.resolve(__dirname, '../../server.js'),
  path.resolve(__dirname, '../../../server.js'),
  path.join(process.env.USERPROFILE || '', '.gemini', 'config', 'plugins', 'antigravity-analytics', 'server.js'),
  path.resolve(__dirname, 'server.js')
];

let started = false;
for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    console.log(`[Sidecar Entrypoint] Starting server from: ${p}`);
    require(p);
    started = true;
    break;
  }
}

if (!started) {
  console.error('[Sidecar Entrypoint] Could not locate server.js in candidates:', candidatePaths);
  process.exit(1);
}
