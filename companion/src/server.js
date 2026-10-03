'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { launchCopilotTerminal } = require('./copilot-launch');
const RECEIVER_PORT = 4318;
function recorderModule() {
  return fs.existsSync(path.join(__dirname, 'recorder.js')) ? require('./recorder') : require('../../extensions/agentops-native/src/recorder');
}
function managedPolicy() {
  return { telemetry: { enabled: true, endpoint: `http://127.0.0.1:${RECEIVER_PORT}`, protocol: 'http/json', captureContent: false, lockCaptureContent: true, serviceName: 'github-copilot' } };
}
function controlHtml(token, nonce) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AgentOps local capture</title></head><body><h1>AgentOps local capture</h1><p>CLI is the primary target. Capture stays on this computer. Azure publishing is unavailable in this preview.</p><p>Connect starts the local Collector. Start Copilot opens a new Terminal session with private capture settings. It clears inherited telemetry settings only for that session. Other terminals need separate enterprise policy. Your normal Copilot account and permissions apply.</p><p><a href="/policy-example" download="managed-settings.example.json">Download policy sample for administrator review</a></p><p id="status" role="status">Checking capture status.</p><button id="connect">Connect</button> <button id="disconnect">Disconnect</button> <button id="start-copilot">Start Copilot in Terminal</button> <a href="/report" target="_blank" rel="noopener">Open local report</a> <button id="quit">Quit companion</button><p>The companion must stay open while Copilot runs. Missing spans do not prove success. Supported native capture does not trace every Python or JavaScript function.</p><script nonce="${nonce}">const token=${JSON.stringify(token)};let refreshTimer,stopped=false;async function refresh(){if(stopped)return;try{const r=await fetch('/status');const s=await r.json();document.getElementById('status').textContent=s.message;document.getElementById('connect').disabled=s.busy||s.connected;document.getElementById('disconnect').disabled=s.busy||!s.connected;document.getElementById('start-copilot').disabled=s.busy||!s.connected;}catch{clearInterval(refreshTimer);if(!stopped)document.getElementById('status').textContent='Companion is unavailable. Reopen the app or close this page.';}}for(const name of ['connect','disconnect','start-copilot','quit'])document.getElementById(name).addEventListener('click',async()=>{document.getElementById('status').textContent='Working.';const r=await fetch('/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-AgentOps-Token':token},body:'{}'});if(name==='quit'&&r.ok){stopped=true;clearInterval(refreshTimer);for(const id of ['connect','disconnect','start-copilot','quit'])document.getElementById(id).disabled=true;document.getElementById('status').textContent='Companion stopped. You can close this page.';return;}await refresh();});refresh();refreshTimer=setInterval(refresh,5000);</script></body></html>`;
}
async function startCompanion({ storage = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AgentOps Native Companion') : path.join(os.homedir(), 'Library', 'Application Support', 'AgentOps Native Companion'), recorder = recorderModule(), openBrowser = false, port = 0, launchCopilot = launchCopilotTerminal } = {}) {
  const lease = recorder.acquireProfileLease(storage);
  let active, lastReceipt, busy = false, failed = false, closing, outputLimit = false, storageBlocked = false;
  let launchNotice = '';
  let pendingAction = Promise.resolve();
  const token = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(24).toString('base64');
  let origin;
  const sockets = new Map();
  async function disconnect() {
    if (active) { const owned = active; active = undefined; try { await owned.stop(); } catch (error) { active = owned; throw error; } }
  }
  const server = http.createServer(async (req, res) => {
    const socketState = sockets.get(req.socket);
    if (socketState) socketState.activeRequests++;
    let completed = false;
    const complete = () => { if (completed) return; completed = true; if (socketState) socketState.activeRequests--; };
    res.once('finish', complete); res.once('close', complete);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    const send = (status, type, content) => { res.writeHead(status, { 'Content-Type': type }); res.end(content); };
    if (req.headers.host !== new URL(origin).host || !['GET', 'POST'].includes(req.method)) return send(403, 'text/plain', 'Request rejected.');
    if (req.method === 'GET') {
      if (req.url === '/') return send(200, 'text/html; charset=utf-8', controlHtml(token, nonce));
      if (req.url === '/policy-example') return send(200, 'application/json', JSON.stringify(managedPolicy(), null, 2));
      if (req.url === '/status') return send(200, 'application/json', JSON.stringify({ connected: !!active, busy, message: busy ? 'Capture setup is in progress.' : active ? 'Collector is ready at http://127.0.0.1:4318. Open a new Copilot session with the prepared startup configuration. Receipt is not yet proof of complete coverage.' + launchNotice : outputLimit ? 'Capture stopped at its monitored local output threshold. Restart capture only after reviewing retained data. A burst can exceed the threshold.' : storageBlocked ? 'Capture is blocked by the retained local storage limit or an unsafe storage entry. Review retained data and storage permissions before restarting. No files were deleted.' : failed ? 'Capture could not start or stopped unexpectedly. Check port 4318 and Collector availability. No configuration was changed.' : 'Capture is disconnected. No configuration was changed.' }));
      if (req.url === '/report') {
        try { return send(200, 'text/html; charset=utf-8', recorder.reportHtml(lastReceipt ? recorder.reportReceipt(lastReceipt) : { nativeSpanCount: 0, librarySpanCount: 0, httpSpanCount: 0, databaseSpanCount: 0, parsedSpans: 0, sessions: 0, failedSpans: 0, inputTokens: null, outputTokens: null })); }
        catch { return send(503, 'text/plain', 'The local receipt cannot be read safely.'); }
      }
      return send(404, 'text/plain', 'Not found.');
    }
    if (req.headers.origin !== origin || req.headers['x-agentops-token'] !== token || req.headers['content-type'] !== 'application/json') return send(403, 'text/plain', 'Request rejected.');
    if (!['/connect', '/disconnect', '/start-copilot', '/quit'].includes(req.url)) return send(404, 'text/plain', 'Not found.');
    const length = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 0 || length > 1024 || req.headers['transfer-encoding']) return send(413, 'text/plain', 'Request too large.');
    let body = ''; try { for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return send(413, 'text/plain', 'Request too large.'); } } catch { if (!res.destroyed) send(400, 'text/plain', 'Incomplete request.'); return; }
    if (body !== '{}') return send(400, 'text/plain', 'Invalid request.');
    if (closing) return send(503, 'text/plain', 'Companion is stopping.');
    if (busy) return send(409, 'text/plain', 'Capture setup is in progress.');
    busy = true;
    let finishAction; pendingAction = new Promise(resolve => { finishAction = resolve; });
    try {
      if (req.url === '/connect' && !active) {
        active = await recorder.startRecorder(storage, { endpoint: `http://127.0.0.1:${RECEIVER_PORT}` });
        if (active.endpoint !== `http://127.0.0.1:${RECEIVER_PORT}`) { await disconnect(); throw new Error('Stable endpoint was not provided.'); }
        lastReceipt = active.receiptPath; failed = false; outputLimit = false; storageBlocked = false; launchNotice = '';
        const owned = active;
        owned.exited?.then(result => { if (active === owned) { active = undefined; failed = true; outputLimit = result?.reason === 'output_limit'; } });
      } else if (req.url === '/disconnect') { await disconnect(); failed = false; launchNotice = ''; }
      else if (req.url === '/start-copilot') { if (!active) return send(409, 'text/plain', 'Connect before starting Copilot.'); await launchCopilot(storage); launchNotice = ' The Copilot terminal was opened. This does not prove span receipt.'; }
      send(200, 'application/json', '{"ok":true}');
      if (req.url === '/quit') setImmediate(() => close().catch(() => { process.exitCode = 1; }));
    } catch (error) { failed = true; storageBlocked = ['storage_limit', 'storage_scan_limit', 'storage_scan_unsafe'].includes(error?.reason); if (req.url === '/start-copilot') launchNotice = ' Copilot could not open. A supported installed native Copilot executable is required.'; send(503, 'text/plain', 'Capture action failed. No configuration was changed.'); }
    finally { busy = false; finishAction(); }
  });
  server.on('connection', socket => {
    const state = { activeRequests: 0 }; sockets.set(socket, state);
    socket.once('close', () => sockets.delete(socket));
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 24;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      await new Promise((resolve, reject) => {
        const drainIdle = () => {
          server.closeIdleConnections?.();
          // Browser preconnect sockets can have no HTTP request and escape the
          // runtime's idle HTTP bookkeeping. Never close an active response.
          for (const [socket, state] of sockets) if (!state.activeRequests && !socket.destroyed) {
            socket.end();
            if (!state.closeTimer) {
              state.closeTimer = setTimeout(() => { if (!state.activeRequests) socket.destroy(); }, 200);
              state.closeTimer.unref();
            }
          }
        };
        const idleTimer = setInterval(drainIdle, 50); idleTimer.unref();
        server.close(error => { clearInterval(idleTimer); for (const state of sockets.values()) clearTimeout(state.closeTimer); error ? reject(error) : resolve(); });
        drainIdle();
      });
      await pendingAction; await disconnect(); recorder.releaseProfileLease(lease);
    })();
    return closing;
  }
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    if (openBrowser) {
      if (process.platform === 'win32') await new Promise((resolve, reject) => { const browser = childProcess.spawn('explorer.exe', [origin], { stdio: 'ignore', detached: true }); browser.once('error', reject); browser.once('spawn', () => { browser.unref(); resolve(); }); });
      else { const result = childProcess.spawnSync('/usr/bin/open', [origin], { stdio: 'ignore' }); if (result.error || result.status !== 0) throw new Error('Could not open the browser.'); }
    }
    return { origin, close, server };
  } catch (error) { if (server.listening) await new Promise(resolve => server.close(resolve)); recorder.releaseProfileLease(lease); throw error; }
}
const storageIndex = process.argv.indexOf('--storage');
if (require.main === module) startCompanion({ openBrowser: !process.argv.includes('--no-browser'), ...(process.argv.includes('--port') ? { port: Number(process.argv[process.argv.indexOf('--port') + 1]) } : {}), ...(storageIndex > 0 && process.argv[storageIndex + 1] ? { storage: path.resolve(process.argv[storageIndex + 1]) } : {}) }).then(companion => {
  const stop = () => companion.close().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}).catch(() => { process.stderr.write('AgentOps companion could not start. Another companion may own the profile.\n'); process.exitCode = 1; });
module.exports = { startCompanion, managedPolicy, controlHtml, RECEIVER_PORT };
