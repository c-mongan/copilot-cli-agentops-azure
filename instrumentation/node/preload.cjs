/* Opt-in, manifest-scoped OpenTelemetry root spans for Node skill scripts. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

const stateKey = Symbol.for('copilot-agentops.script-tracing');
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const NODE_SCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx']);
const attribute = (key, value) => ({ key, value: { stringValue: String(value) } });

function validEndpoint(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '::1'].includes(url.hostname) && Boolean(url.port))
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function entryScriptArgument(argv) {
  const entry = String(argv[1] || '').replace(/\\/g, '/').toLowerCase();
  const tsNodeLauncher = path.posix.basename(entry) === 'ts-node' || /\/ts-node\/(?:dist\/)?bin\.js$/.test(entry);
  if (!tsNodeLauncher) return argv[1] || '';
  for (const argument of argv.slice(2)) {
    if (argument.startsWith('-')) continue;
    if (NODE_SCRIPT_EXTENSIONS.has(path.extname(argument).toLowerCase())) return argument;
  }
  return '';
}

function recognizedLoader(value) {
  const normalized = String(value || '').toLowerCase().replace(/\\/g, '/');
  if (/(^|[/@])tsx(?:[/@.]|$)/.test(normalized) || normalized.includes('tsx/dist/')) return 'tsx';
  if (/(^|[/@])ts-node(?:[/@.]|$)/.test(normalized) || normalized.includes('ts-node/dist/')) return 'ts-node';
  return '';
}

function scriptLoaderName(argv = process.argv, execArgv = process.execArgv) {
  const entry = String(argv[1] || '').replace(/\\/g, '/').toLowerCase();
  if (path.posix.basename(entry) === 'ts-node' || /\/ts-node\/(?:dist\/)?bin\.js$/.test(entry)) return 'ts-node';
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = String(execArgv[index]);
    const flag = /^(--loader|--experimental-loader|--import|--require)=/.exec(argument);
    if (flag) {
      const loader = recognizedLoader(argument.slice(flag[0].length));
      if (loader) return loader;
      continue;
    }
    if (['--loader', '--experimental-loader', '--import', '--require', '-r'].includes(argument)) {
      const loader = recognizedLoader(execArgv[index + 1]);
      if (loader) return loader;
      index += 1;
    }
  }
  return '';
}

function runtimeIdentity(scriptName) {
  const extension = path.extname(scriptName).toLowerCase();
  const typescript = ['.ts', '.mts', '.cts', '.tsx'].includes(extension);
  const loader = scriptLoaderName();
  const nativeTypescript = ['.ts', '.mts', '.cts'].includes(extension) && Boolean(process.features?.typescript);
  return {
    name: 'node',
    version: String(process.versions.node || process.version || '').replace(/^v/, ''),
    implementation: String(process.release?.name || 'node'),
    loader: typescript ? loader || (nativeTypescript ? 'node-native-typescript' : 'unknown') : ''
  };
}

function loadTarget() {
  const runId = process.env.AGENTOPS_RUN_ID || '';
  const repo = process.env.AGENTOPS_REPO_ROOT || '';
  const manifestPath = process.env.AGENTOPS_ATTACHMENT_MANIFEST || '';
  const scriptArg = entryScriptArgument(process.argv);
  if (!runId || !repo || !manifestPath || !scriptArg || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) return null;
  const endpoint = process.env.AGENTOPS_SCRIPT_OTLP_ENDPOINT || '';
  if (!validEndpoint(endpoint)) return null;
  try {
    const realRepo = fs.realpathSync.native(repo);
    const expectedManifest = path.join(realRepo, '.agentops', 'attachment.json');
    if (fs.realpathSync.native(manifestPath) !== fs.realpathSync.native(expectedManifest)) return null;
    const manifestStat = fs.statSync(expectedManifest);
    if (!manifestStat.isFile() || manifestStat.size > MAX_MANIFEST_BYTES) return null;
    const manifest = JSON.parse(fs.readFileSync(expectedManifest, 'utf8'));
    if (manifest.managedBy !== 'copilot-agentops' || manifest.schemaVersion !== 1) return null;
    const scriptPath = fs.realpathSync.native(scriptArg);
    const relative = path.relative(realRepo, scriptPath).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) return null;
      const scriptStat = fs.statSync(scriptPath);
    if (!scriptStat.isFile() || scriptStat.size > MAX_SCRIPT_BYTES) return null;
    const architecture = manifest.architecture || {};
    const scripts = architecture.runtimeScripts
      || (architecture.skills || []).flatMap(skill => skill.scripts || []);
    for (const item of scripts) {
      if (item.path === relative && item.sha256 === crypto.createHash('sha256').update(fs.readFileSync(scriptPath)).digest('hex')) {
        return { endpoint, runId, sessionId: process.env.AGENTOPS_SESSION_ID || '', scriptName: relative, runtime: runtimeIdentity(relative) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function createExporter(target) {
  const startedAt = BigInt(Date.now()) * 1_000_000n;
  const clockStarted = process.hrtime.bigint();
  const traceParent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(process.env.TRACEPARENT || '');
  const traceId = traceParent?.[1].toLowerCase() || crypto.randomBytes(16).toString('hex');
  const rootSpanId = crypto.randomBytes(8).toString('hex');
  const childSpans = [];
  const context = new AsyncLocalStorage();
  let outcome = 1;
  let errorType = '';
  let flushStarted = false;

  function startChild(name, stepName, parentSpanId, callback) {
    const spanId = crypto.randomBytes(8).toString('hex');
    const childStarted = process.hrtime.bigint();
    const span = { traceId, spanId, parentSpanId, name, stepName, childStarted, ended: false, errorType: '' };
    childSpans.push(span);
    function finish(error) {
      if (span.ended) return;
      span.ended = true;
      span.duration = process.hrtime.bigint() - childStarted;
      if (error) span.errorType = error.name || 'Error';
    }
    try {
      const result = context.run({ spanId }, callback);
      if (result && typeof result.then === 'function') {
        return result.then(value => { finish(); return value; }, error => { finish(error); throw error; });
      }
      finish();
      return result;
    } catch (error) {
      finish(error);
      throw error;
    }
  }

  function toOtlpSpan(span) {
    const duration = span.duration || (process.hrtime.bigint() - (span.childStarted || clockStarted));
    const startNs = startedAt + (span.childStarted - clockStarted);
    const endNs = startNs + duration;
    const isRoot = span.name === 'agentops.script';
    const attributes = isRoot
      ? [attribute('agentops.script.name', target.scriptName)]
      : [attribute('agentops.step.name', span.stepName), attribute('agentops.script.name', target.scriptName)];
    attributes.push(
      attribute('agentops.script.runtime.name', target.runtime.name),
      attribute('agentops.script.runtime.version', target.runtime.version),
      attribute('agentops.script.runtime.implementation', target.runtime.implementation)
    );
    if (target.runtime.loader) attributes.push(attribute('agentops.script.loader.name', target.runtime.loader));
    if (span.errorType) attributes.push(attribute('error.type', span.errorType));
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      name: span.name,
      kind: 1,
      startTimeUnixNano: String(startNs),
      endTimeUnixNano: String(endNs),
      attributes,
      status: { code: span.errorType || isRoot && outcome !== 1 ? 2 : 1 }
    };
  }

  async function flush() {
    if (flushStarted) return;
    flushStarted = true;
    const duration = process.hrtime.bigint() - clockStarted;
    const root = {
      traceId,
      spanId: rootSpanId,
      parentSpanId: traceParent?.[2].toLowerCase() || '',
      name: 'agentops.script',
      childStarted: clockStarted,
      duration,
      errorType
    };
    const spans = [root, ...childSpans].map(toOtlpSpan);
    const body = {
      resourceSpans: [{
        resource: { attributes: [attribute('service.name', 'agentops-skill-script'), attribute('agentops.run.id', target.runId), attribute('agentops.session.id', target.sessionId)] },
        scopeSpans: [{ scope: { name: 'agentops.skill-script' }, spans }]
      }]
    };
    try {
      await fetch(target.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000)
      });
    } catch {
      // Export failure must not replace the script's normal result or exit code.
    }
  }

  return {
    step: (name, callback) => {
      if (typeof callback !== 'function') throw new TypeError('agentops step requires a callback');
      return startChild('agentops.script.step', String(name).slice(0, 128), context.getStore()?.spanId || rootSpanId, callback);
    },
    fail: type => { outcome = 2; if (!errorType) errorType = String(type || 'Error').slice(0, 128); },
    flush
  };
}

const target = loadTarget();
if (target && !globalThis[stateKey]) {
  const exporter = createExporter(target);
  globalThis[stateKey] = exporter;
  process.on('uncaughtExceptionMonitor', error => exporter.fail(error?.name || 'Error'));
  process.on('beforeExit', () => {
    if (Number.isInteger(process.exitCode) && process.exitCode !== 0) exporter.fail('ProcessExit');
    void exporter.flush();
  });
}
