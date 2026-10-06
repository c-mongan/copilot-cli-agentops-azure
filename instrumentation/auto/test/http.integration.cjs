'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { prepareAutoInstrumentation } = require('../plan.cjs');
const proofRoot = process.env.AGENTOPS_AUTO_PROOF_ROOT;
if (!proofRoot) throw new Error('AGENTOPS_AUTO_PROOF_ROOT must name the disposable dependency environment');
const python = path.join(proofRoot, 'python', 'bin', 'python');
const decodeCode = 'import sys,json\nfrom opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest\nm=ExportTraceServiceRequest();m.ParseFromString(sys.stdin.buffer.read());print(json.dumps([{ "name":s.name,"kind":s.kind,"traceId":s.trace_id.hex(),"parentId":s.parent_span_id.hex(),"attrs":{a.key:(a.value.string_value or a.value.int_value) for a in s.attributes}} for r in m.resource_spans for scope in r.scope_spans for s in scope.spans]))';
for (const runtime of ['cjs', 'esm', 'python']) {
  test(`${runtime} sends real library HTTP spans from scoped entry`, async () => {
    const received = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/traces') {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          assert.equal(req.headers['content-type'], 'application/x-protobuf');
          const result = spawnSync(python, ['-c', decodeCode], { input: Buffer.concat(chunks), encoding: 'utf8' });
          assert.equal(result.status, 0, result.stderr);
          received.push(...JSON.parse(result.stdout));
          res.writeHead(200, { 'content-type': 'application/x-protobuf' }); res.end();
        });
      } else { res.end('fixture-ok'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const endpoint = `http://127.0.0.1:${server.address().port}`;
      const root = path.join(proofRoot, runtime === 'python' ? 'python' : 'node');
      const ext = runtime === 'python' ? 'py' : runtime === 'esm' ? 'mjs' : 'cjs';
      const entry = path.join(root, `fixture.${ext}`);
      const source = runtime === 'python'
        ? `import requests\nassert requests.get(${JSON.stringify(endpoint + '/fixture')}).text == 'fixture-ok'\n`
        : `${runtime === 'esm' ? "import http from 'node:http';" : "const http = require('node:http');"}\nhttp.get(${JSON.stringify(endpoint + '/fixture')}, response => { response.resume(); response.on('end',()=>console.log('fixture-ok')); });`;
      fs.writeFileSync(entry, source);
      const traceparent = '00-11111111111111111111111111111111-2222222222222222-01';
      const plan = prepareAutoInstrumentation({ runtime: runtime === 'python' ? 'python' : 'node', executable: runtime === 'python' ? python : process.execPath, entry, projectRoot: root, endpoint, runId: 'http-proof', mode: runtime === 'esm' ? 'esm' : 'cjs', traceparent });
      assert.equal(plan.supported, true, JSON.stringify(plan.requirements));
      const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env, OTEL_BSP_SCHEDULE_DELAY: '25', OTEL_BSP_EXPORT_TIMEOUT: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = ''; child.stderr.on('data', c => { stderr += c; }); child.stdout.resume();
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
      const code = await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timeout);
      assert.equal(code, 0, stderr);
      const client = received.find(span => span.kind === 3 && span.attrs['http.request.method'] === 'GET');
      assert.ok(client, JSON.stringify(received));
      if (runtime === 'python') { assert.equal(client.traceId, '11111111111111111111111111111111'); assert.equal(client.parentId, '2222222222222222'); }
      fs.unlinkSync(entry);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
}
