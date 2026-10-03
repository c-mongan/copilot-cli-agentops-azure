'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NODE_PACKAGES = ['@opentelemetry/sdk-node', '@opentelemetry/auto-instrumentations-node', '@opentelemetry/exporter-trace-otlp-proto'];
const limitations = [
  'Supported installed library operations only; internal functions need explicit spans.',
  'Each child process needs its own approved plan. This plan does not instrument other processes.',
  'The local Collector must filter attributes before storage or Azure delivery.',
  'Node library spans do not automatically inherit the root observer context; application context propagation is required.',
  'TypeScript must use a separately qualified runtime or be compiled to JavaScript first.'
];

function prepareAutoInstrumentation(options, deps = {}) {
  const probeProcess = deps.spawnSync || spawnSync;
  const { runtime, executable, entry, projectRoot, endpoint, runId, traceparent = '', mode = 'cjs', args = [], electronRuntime = false } = options;
  if (!['node', 'python'].includes(runtime)) throw new Error('runtime must be node or python');
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.includes('\0'))) throw new Error('args must be a string array');
  if (![executable, entry, projectRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('absolute executable, entry and projectRoot are required');
  const root = fs.realpathSync(projectRoot);
  const target = fs.realpathSync(entry);
  const relative = path.relative(root, target);
  if (!fs.statSync(root).isDirectory() || !fs.statSync(target).isFile() || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('entry must be a file inside the approved project');
  const command = executable;
  fs.realpathSync(command);
  if (!fs.statSync(command).isFile()) throw new Error('executable must be a file');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("endpoint must be a loopback Collector base URL"); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('endpoint must be a loopback Collector base URL');
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) throw new Error('valid runId required');
  if (traceparent && !/^00-(?!0{32})[a-f0-9]{32}-(?!0{16})[a-f0-9]{16}-[a-f0-9]{2}$/.test(traceparent)) throw new Error('invalid traceparent');
  const env = {
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${url.origin}/v1/traces`,
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/protobuf',
    OTEL_TRACES_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none', OTEL_LOGS_EXPORTER: 'none',
    OTEL_SEMCONV_STABILITY_OPT_IN: 'http',
    OTEL_SERVICE_NAME: 'agentops.project', OTEL_RESOURCE_ATTRIBUTES: `agentops.run.id=${runId}`,
    AGENTOPS_AUTO_PROJECT_ROOT: root,
    AGENTOPS_AUTO_TRACEPARENT: traceparent,
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false'
  };
  if (electronRuntime && runtime !== 'node') throw new Error('Electron runtime is only supported for Node');
  if (electronRuntime) env.ELECTRON_RUN_AS_NODE = '1';
  let probe, commandArgs, requirements;
  if (runtime === 'node') {
    if (!['cjs', 'esm'].includes(mode)) throw new Error('node mode must be cjs or esm');
    if (!['.js', '.cjs', '.mjs'].includes(path.extname(target))) throw new Error('compile TypeScript first; only js, cjs and mjs entries are qualified');
    const probeCode = `const r=require('node:module').createRequire(require('node:path').join(process.argv[1],'package.json')); const p=${JSON.stringify(NODE_PACKAGES)}; const out={missing:p.filter(n=>{try{r.resolve(n);return false}catch{return true}})}; if(${JSON.stringify(mode)}==='esm'){try{out.hook=r.resolve('@opentelemetry/instrumentation/hook.mjs')}catch{out.missing.push('@opentelemetry/instrumentation/hook.mjs')}} console.log(JSON.stringify(out));`;
    probe = probeProcess(command, ['-e', probeCode, root], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    let data;
    try { data = JSON.parse(probe.stdout); } catch { data = { missing: NODE_PACKAGES }; }
    requirements = data.missing;
    commandArgs = ['--require', path.join(__dirname, 'node.cjs')];
    if (mode === 'esm' && data.hook) commandArgs.push('--import', data.hook);
    commandArgs.push(target, ...args);
  } else {
    if (path.extname(target) !== '.py') throw new Error('python entry must be a py script');
    const code = 'import json,importlib.util,importlib.metadata as m; names=["opentelemetry.sdk.trace","opentelemetry.exporter.otlp.proto.http.trace_exporter"]; missing=[]\nfor n in names:\n try:\n  if importlib.util.find_spec(n) is None: missing.append(n)\n except ModuleNotFoundError: missing.append(n)\nif not list(m.entry_points(group="opentelemetry_instrumentor")): missing.append("project library instrumentors")\nprint(json.dumps({"missing":missing}))';
    probe = probeProcess(command, ['-c', code], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    try { requirements = JSON.parse(probe.stdout).missing; } catch { requirements = ['opentelemetry-sdk', 'opentelemetry-exporter-otlp-proto-http', 'project library instrumentors']; }
    commandArgs = [path.join(__dirname, 'python.py'), target, ...args];
  }
  return { supported: probe.status === 0 && requirements.length === 0, command, args: commandArgs, cwd: root, env, requirements, limitations: [...limitations] };
}
module.exports = { prepareAutoInstrumentation };
