const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { libraryReceiptCounts } = require('./library-report');

function runtimeModule(name) {
  const bundled = fs.existsSync(path.join(__dirname, '../runtime/package.json'));
  const modules = bundled ? {
    'collector-binary-release': () => require('../runtime/src/lib/collector-binary-release'),
    'copilot/scoped-collector': () => require('../runtime/src/lib/copilot/scoped-collector'),
    'copilot/session-otel': () => require('../runtime/src/lib/copilot/session-otel'),
    'copilot/delivery-limits': () => require('../runtime/src/lib/copilot/delivery-limits')
  } : {
    'collector-binary-release': () => require('../../../agentops-cli/src/lib/collector-binary-release'),
    'copilot/scoped-collector': () => require('../../../agentops-cli/src/lib/copilot/scoped-collector'),
    'copilot/session-otel': () => require('../../../agentops-cli/src/lib/copilot/session-otel'),
    'copilot/delivery-limits': () => require('../../../agentops-cli/src/lib/copilot/delivery-limits')
  };
  return modules[name]();
}

function privateBinary(stat) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid())
    && (process.platform === 'win32' || (stat.mode & 0o022) === 0);
}

async function ensureCollector(storage, deps = {}) {
  const release = deps.release || runtimeModule('collector-binary-release');
  const info = release.collectorPackageInfo();
  const binDir = path.join(storage, 'bin', info.version);
  const destination = path.join(binDir, info.binaryName);
  if (fs.existsSync(destination)) {
    const stat = fs.lstatSync(destination);
    if (!privateBinary(stat)) throw new Error('Collector storage is not a regular owner-owned file without group or world write access.');
    return destination;
  }
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const temp = fs.mkdtempSync(path.join(binDir, 'download-'));
  try {
    const archive = path.join(temp, info.fileName);
    const checksums = path.join(temp, info.checksumFileName);
    await release.downloadFile(info.url, archive);
    await release.downloadFile(info.checksumUrl, checksums);
    if (!release.verifyChecksum({ archive, checksumsText: fs.readFileSync(checksums, 'utf8'), fileName: info.fileName }).ok) {
      throw new Error('Collector release checksum verification failed.');
    }
    // Extract only the known binary from the verified official release.
    const extracted = (deps.spawnSync || childProcess.spawnSync)('tar', ['-xzf', archive, '-C', temp, info.binaryName], { timeout: 60000, encoding: 'utf8', maxBuffer: 1048576 });
    if (extracted.status !== 0) throw new Error('Cannot extract Collector. A system tar program is required.');
    const binary = path.join(temp, info.binaryName);
    const stat = fs.lstatSync(binary);
    if (!privateBinary(stat)) throw new Error('Collector release binary is not a regular owner-owned file without group or world write access.');
    fs.chmodSync(binary, 0o700);
    fs.renameSync(binary, destination);
    return destination;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

async function startRecorder(storage, deps = {}) {
  let receiverPort;
  if (deps.endpoint !== undefined) {
    const match = /^http:\/\/127\.0\.0\.1:([0-9]+)$/.exec(deps.endpoint);
    receiverPort = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(receiverPort) || receiverPort < 1024 || receiverPort > 65535 || String(receiverPort) !== match?.[1]) throw new Error('Saved Collector endpoint is invalid.');
  }
  const binary = await (deps.ensureCollector || ensureCollector)(storage);
  if (deps.startScopedStrictCollector) return deps.startScopedStrictCollector({
    tempRoot: path.join(storage, 'receipts'), agentopsHome: storage, receiverPort,
    findCollectorBinary: () => ({ ok: true, path: binary, source: 'extension-storage' })
  });
  // The worker owns Collector shutdown when the extension host IPC channel closes.
  const worker = (deps.fork || childProcess.fork)(path.join(__dirname, 'recorder-worker.js'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  let collectorExit;
  worker.on('message', message => { if (message?.type === 'stopped') collectorExit = message; });
  const exited = new Promise(resolve => worker.once('exit', (code, signal) => resolve({ code, signal, ...(collectorExit || {}) })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local Collector startup timed out.')), 45000);
    worker.once('error', () => { clearTimeout(timer); reject(new Error('Local Collector worker did not start.')); });
    worker.once('exit', () => { clearTimeout(timer); reject(new Error('Local Collector worker exited during setup.')); });
    worker.on('message', message => {
      if (message?.type === 'ready') { clearTimeout(timer); resolve(message); }
      if (message?.type === 'failed') { clearTimeout(timer); reject(Object.assign(new Error('Local Collector setup failed.'), { reason: message.reason })); }
    });
  });
  const stop = async () => {
    if (worker.exitCode !== null) return;
    if (worker.connected) worker.send({ type: 'stop' });
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), 10000); });
    const stopped = await Promise.race([exited.then(() => true), timeout]);
    clearTimeout(timer);
    if (!stopped) { worker.kill('SIGTERM'); throw new Error('Local Collector worker did not confirm shutdown.'); }
  };
  worker.send({ type: 'start', storage, binary, receiverPort });
  try { const result = await ready; return { ...result, exited, stop }; }
  catch (error) { try { await stop(); } catch {} throw error; }
}

function reportReceipt(file) {
  const text = runtimeModule('copilot/delivery-limits').readPrivateFile(file, 16 * 1024 * 1024);
  const { readOtelSpansFromText } = runtimeModule('copilot/session-otel');
  const parsed = readOtelSpansFromText(text);
  const spans = parsed.spans;
  const ids = new Set(spans.map(span => span.sessionId));
  const llmSpans = [...new Map(spans.filter(s => ['chat', 'generate_content'].includes(s.operation)).map(s => [`${s.traceId}:${s.spanId}`, s])).values()];
  const sum = key => llmSpans.length && llmSpans.every(s => typeof s[key] === 'number') ? llmSpans.reduce((n, s) => n + s[key], 0) : null;
  return { ...libraryReceiptCounts(text), nativeSpanCount: spans.length, parsedSpans: spans.length, sessions: ids.size, failedSpans: spans.filter(s => s.failed).length, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), coverage: 'unknown', outcome: 'unknown' };
}

function reportHtml(report) {
  // Only fixed labels and numbers enter this view. No source names, URLs, IDs, prompts, or paths.
  const fields = { 'Received native spans': report.nativeSpanCount, 'Received library spans': report.librarySpanCount, 'HTTP library spans': report.httpSpanCount, 'Database library spans': report.databaseSpanCount, 'Parsed spans': report.parsedSpans, 'Sessions': report.sessions, 'Spans with errors': report.failedSpans, 'Observed LLM input tokens': report.inputTokens, 'Observed LLM output tokens': report.outputTokens };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';"><title>AgentOps native report</title></head><body><h1>AgentOps native report</h1><p>Capture coverage: unknown. Task outcome: unknown.</p><p>Missing telemetry does not prove success. Token totals cover observed LLM spans only. A total is unknown if any LLM span omits that token count. Refresh this report to read new data.</p><table><caption>Observed local metadata</caption>${Object.entries(fields).map(([label, value]) => `<tr><th scope="row">${label}</th><td>${typeof value === 'number' && Number.isFinite(value) ? value : 'Unknown'}</td></tr>`).join('')}</table></body></html>`;
}

function readProfileState(storage) {
  const file = path.join(storage, 'native-state.json');
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(runtimeModule('copilot/delivery-limits').readPrivateFile(file, 128 * 1024));
  if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.optedIn !== 'boolean') throw new Error('Native profile state is invalid.');
  return state;
}
function writeProfileState(storage, state) {
  const temporary = path.join(storage, `native-state-${require('node:crypto').randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, path.join(storage, 'native-state.json'));
  } finally { fs.rmSync(temporary, { force: true }); }
}
function leaseRecord(file) {
  const record = JSON.parse(runtimeModule('copilot/delivery-limits').readPrivateFile(file, 4096));
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !/^[a-f0-9-]{36}$/.test(record.token)) throw new Error('Native profile lease is invalid.');
  return record;
}
function acquireProfileLease(storage) {
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  const directory = fs.lstatSync(storage);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (typeof process.getuid === 'function' && directory.uid !== process.getuid())) throw new Error('Native profile storage is not a private owned directory.');
  fs.chmodSync(storage, 0o700);
  const file = path.join(storage, 'native-capture.lock');
  const record = { pid: process.pid, token: require('node:crypto').randomUUID() };
  const create = () => fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  try { create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recovery = path.join(storage, 'native-capture-recovery');
    try { fs.mkdirSync(recovery, { mode: 0o700 }); }
    catch { throw new Error('Another VS Code window is recovering the native capture profile.'); }
    try {
      const owner = leaseRecord(file);
      let dead = false;
      try { process.kill(owner.pid, 0); }
      catch (error) { dead = error.code === 'ESRCH'; }
      if (!dead) throw new Error('Another VS Code window owns native capture.');
      fs.unlinkSync(file);
      create();
    } finally { fs.rmdirSync(recovery); }
  }
  return { storage, file, ...record };
}
function releaseProfileLease(lease) {
  const current = leaseRecord(lease.file);
  if (current.pid !== lease.pid || current.token !== lease.token) throw new Error('Native capture profile ownership changed.');
  fs.unlinkSync(lease.file);
}

module.exports = { ensureCollector, startRecorder, reportReceipt, reportHtml, readProfileState, writeProfileState, acquireProfileLease, releaseProfileLease };
