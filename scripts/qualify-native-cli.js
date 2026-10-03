#!/usr/bin/env node
'use strict';
// Real Copilot runtime, synthetic local model. No provider credentials are inherited.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { startScopedStrictCollector } = require('../agentops-cli/src/lib/copilot/scoped-collector');
const CANARY = 'AGENTOPS_NATIVE_PRIVATE_CANARY_20261003';
function cleanEnvironment(source) {
  const result = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SHELL', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (source[key]) result[key] = source[key];
  return result;
}
function fixtureTool(platform = process.platform) {
  return platform === 'win32' ? { name: 'powershell', command: 'Write-Output agentops-native-fixture', permission: 'shell(Write-Output)' } : { name: 'bash', command: 'printf agentops-native-fixture', permission: 'shell(printf)' };
}
function spansFromReceipt(text) {
  return text.trim().split('\n').filter(Boolean).flatMap(line => {
    const row = JSON.parse(line);
    return (row.resourceSpans || []).flatMap(resource => (resource.scopeSpans || []).flatMap(scope => scope.spans || []));
  });
}
function attribute(span, key) { return span.attributes?.find(a => a.key === key)?.value?.stringValue; }
function readReceipt(receiptPath) {
  if (fs.statSync(receiptPath).size > 16 * 1024 * 1024) throw new Error('Qualification receipt exceeds the 16 MiB read limit.');
  return fs.readFileSync(receiptPath);
}
function externalCollector(options) {
  if (!options.collectorEndpoint && !options.receiptPath) return null;
  if (!options.collectorEndpoint || !options.receiptPath) throw new Error('External Collector requires both endpoint and receiptPath.');
  const endpoint = new URL(options.collectorEndpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('External qualification only accepts an explicit HTTP IPv4 loopback endpoint.');
  const receiptPath = options.receiptPath;
  if (!path.isAbsolute(receiptPath) || path.basename(receiptPath) !== 'native-receipt.jsonl') throw new Error('External receipt must be an absolute native-receipt.jsonl path.');
  const stat = fs.lstatSync(receiptPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) || (process.getuid && stat.uid !== process.getuid())) throw new Error('External receipt must be a private regular file owned by this user.');
  const directory = path.dirname(receiptPath);
  const directoryStat = fs.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0)) throw new Error('External receipt directory must be private.');
  const config = fs.readFileSync(path.join(directory, 'otelcol.local.strict.yaml'), 'utf8');
  if (!config.includes(`      http:\n        endpoint: 127.0.0.1:${endpoint.port}\n`) || !config.includes('transform/privacy_strict') || !config.includes('file/receipt')) throw new Error('External endpoint and receipt must belong to the same strict Collector scope.');
  return { endpoint: endpoint.origin, receiptPath, external: true };
}
function inspectReceipt(text) {
  const spans = spansFromReceipt(text);
  const operations = spans.map(span => attribute(span, 'gen_ai.operation.name')).filter(Boolean);
  const rootIds = new Set(spans.filter(span => attribute(span, 'gen_ai.operation.name') === 'invoke_agent').map(span => span.spanId));
  const children = spans.filter(span => ['chat', 'execute_tool'].includes(attribute(span, 'gen_ai.operation.name')));
  return { spanCount: spans.length, operations: [...new Set(operations)].sort(), canaryAbsent: !text.includes(CANARY), traceCount: new Set(spans.map(s => s.traceId)).size, childrenHaveAgentParent: children.length > 0 && children.every(span => rootIds.has(span.parentSpanId)), hasAgent: operations.includes('invoke_agent'), hasChat: operations.includes('chat'), hasTool: operations.includes('execute_tool') };
}
async function qualify(options = {}) {
  const suppliedCollector = externalCollector(options);
  const tool = fixtureTool(options.platform || process.platform);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-cli-'));
  fs.chmodSync(root, 0o700);
  const requests = [];
  const nativeExports = [];
  let toolSent = false;
  let collector;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', part => { body += part; if (body.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        if (req.url === '/v1/traces' || req.url === '/v1/metrics') {
          nativeExports.push({ path: req.url, canaryPresentBeforeFilter: body.includes(CANARY), bytes: Buffer.byteLength(body) });
          const forward = http.request(`${collector.endpoint}${req.url}`, { method: 'POST', headers: { 'content-type': req.headers['content-type'] || 'application/json' } }, response => { res.writeHead(response.statusCode, { 'content-type': response.headers['content-type'] || 'application/json' }); response.pipe(res); });
          forward.on('error', () => { res.writeHead(502); res.end(); });
          forward.end(body);
          return;
        }
        const request = JSON.parse(body);
        const toolNames = (request.tools || []).map(t => t.function?.name);
        const toolResultHasMarker = (request.messages || []).some(message => message.role === 'tool' && JSON.stringify(message.content).includes('agentops-native-fixture'));
        requests.push({ path: req.url, stream: Boolean(request.stream), toolNames, toolResultHasMarker });
        const runTool = !toolSent && toolNames.includes(tool.name);
        if (runTool) toolSent = true;
        const message = runTool ? { role: 'assistant', content: null, tool_calls: [{ id: 'fixture_tool_1', type: 'function', function: { name: tool.name, arguments: JSON.stringify({ command: tool.command, description: 'Print a fixed qualification marker', timeout: 2000 }) } }] } : { role: 'assistant', content: `Local synthetic response ${CANARY}` };
        const base = { id: `fixture-${requests.length}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'agentops-local-fixture', choices: [{ index: 0, message, finish_reason: runTool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } };
        if (request.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const delta = runTool ? { role: 'assistant', tool_calls: message.tool_calls.map((t, index) => ({ index, ...t })) } : message;
          res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: base.choices[0].finish_reason }] })}\n\n`);
          res.end('data: [DONE]\n\n');
        } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(base)); }
      } catch { res.writeHead(400); res.end('Invalid fixture request'); }
    });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    collector = suppliedCollector || await startScopedStrictCollector({ tempRoot: path.join(root, 'collector'), findCollectorBinary: () => ({ ok: true, path: options.collector || '/Users/conormongan/.agentops/collector/bin/otelcol-contrib' }) });
    const initialReceiptBytes = fs.statSync(collector.receiptPath).size;
    const env = { ...cleanEnvironment(process.env), COPILOT_HOME: path.join(root, 'copilot-home'), COPILOT_OFFLINE: 'true', COPILOT_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, COPILOT_PROVIDER_TYPE: 'openai', COPILOT_PROVIDER_WIRE_API: 'completions', COPILOT_MODEL: 'agentops-local-fixture', COPILOT_OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}`, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_RESOURCE_ATTRIBUTES: `qualification.private_canary=${CANARY}`, OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false', OTEL_BSP_SCHEDULE_DELAY: '100' };
    const result = await new Promise((resolve, reject) => {
      const child = spawn(options.copilot || '/opt/homebrew/bin/copilot', ['-C', root, '-p', `Print a fixed fixture marker using shell, then finish. Private prompt ${CANARY}`, '--available-tools', tool.name, '--allow-tool', tool.permission, '--disable-builtin-mcps', '--no-custom-instructions', '--stream', 'off'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
      let killTimer;
      const timer = setTimeout(() => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000); }, options.timeoutMs || 60000);
      child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); clearTimeout(killTimer); resolve({ code, signal, outputContainedCanary: stdout.includes(CANARY), stderr: stderr.slice(-4000) }); });
    });
    // Only stop a Collector that this qualification owns. The installed companion
    // keeps running; poll its bounded receipt for accepted batches instead.
    if (!collector.external) await collector.stop({ remove: false });
    if (collector.external) {
      const deadline = Date.now() + Math.min(options.receiptWaitMs ?? 15000, 15000);
      while (Date.now() < deadline) {
        const bytes = readReceipt(collector.receiptPath);
        try {
          const current = inspectReceipt(bytes.subarray(initialReceiptBytes).toString('utf8'));
          if (current.hasAgent && current.hasChat && current.hasTool) break;
        } catch { /* A JSON line can be in progress while the Collector appends. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const receipt = readReceipt(collector.receiptPath).toString('utf8');
    const inspected = inspectReceipt(Buffer.from(receipt).subarray(initialReceiptBytes).toString('utf8'));
    inspected.canaryAbsent = !receipt.includes(CANARY);
    const report = { evidence: 'real Copilot CLI runtime with synthetic local model', collectorEvidence: collector.external ? 'actual installed companion Collector, left running' : 'owned scoped Collector, stopped and flushed', collectorEndpoint: collector.endpoint, paidModelUsed: false, offline: true, ...result, ...inspected, requests, nativeExports, toolRequested: toolSent, artifactDirectory: root, receiptPath: collector.receiptPath, collectorStopped: !collector.external };
    report.toolExecuted = requests.some(request => request.toolResultHasMarker);
    report.canaryObservedBeforeFilter = nativeExports.some(request => request.canaryPresentBeforeFilter);
    report.passed = result.code === 0 && report.hasAgent && report.hasChat && report.hasTool && report.traceCount === 1 && report.childrenHaveAgentParent && report.canaryAbsent && report.canaryObservedBeforeFilter && report.outputContainedCanary && report.toolExecuted;
    fs.writeFileSync(path.join(root, 'qualification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  } finally { await new Promise(resolve => server.close(resolve)); if (collector && !collector.external) await collector.stop({ remove: false }); }
}
if (require.main === module) qualify().then(report => { console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { CANARY, fixtureTool, cleanEnvironment, inspectReceipt, externalCollector, qualify };
