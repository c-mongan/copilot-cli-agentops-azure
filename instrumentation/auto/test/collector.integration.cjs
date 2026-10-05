'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepareAutoInstrumentation } = require('../plan.cjs');
const { startScopedStrictCollector } = require('../../../agentops-cli/src/lib/copilot/scoped-collector');
const { libraryReceiptCounts } = require('../../../extensions/agentops-native/src/library-report');
const proofRoot = process.env.AGENTOPS_AUTO_PROOF_ROOT;
const binary = process.env.AGENTOPS_AUTO_COLLECTOR_BINARY;
if (!proofRoot || !binary) throw new Error('Explicit disposable proof root and existing Collector binary are required');

test('real CJS, ESM and Python HTTP spans retain safe operation kind and remove URL canary', async () => {
  const server = http.createServer((_req, res) => res.end('fixture-ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let collector;
  try {
    collector = await startScopedStrictCollector({ tempRoot: path.join(proofRoot, 'collector-proof'), findCollectorBinary: () => ({ ok: true, path: binary }) });
    const canary = 'AGENTOPS_LIBRARY_URL_SECRET_CANARY_20261003';
    const requestUrl = `http://127.0.0.1:${server.address().port}/private/${canary}?token=${canary}`;
    const python = path.join(proofRoot, 'python', 'bin', 'python');
    for (const format of ['cjs', 'esm', 'python']) {
      const runtime = format === 'python' ? 'python' : 'node';
      const projectRoot = path.join(proofRoot, runtime === 'python' ? 'python' : 'node');
      const entry = path.join(projectRoot, `collector-fixture.${format === 'python' ? 'py' : format === 'esm' ? 'mjs' : 'cjs'}`);
      const source = format === 'python' ? `import requests\nassert requests.get(${JSON.stringify(requestUrl)}).text == 'fixture-ok'\n` : `${format === 'esm' ? "import http from 'node:http';" : "const http = require('node:http');"}\nhttp.get(${JSON.stringify(requestUrl)}, response => response.resume());`;
      fs.writeFileSync(entry, source);
      try {
        const plan = prepareAutoInstrumentation({ runtime, executable: runtime === 'python' ? python : process.execPath, entry, projectRoot, endpoint: collector.endpoint, runId: `collector-${format}`, mode: format === 'esm' ? 'esm' : 'cjs' });
        assert.equal(plan.supported, true, 'Project dependency setup must be complete');
        const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env, OTEL_BSP_SCHEDULE_DELAY: '25', OTEL_BSP_EXPORT_TIMEOUT: '1000' }, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = ''; child.stderr.on('data', c => { stderr += c; });
        const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
        const code = await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timer);
        assert.equal(code, 0, stderr);
      } finally { fs.unlinkSync(entry); }
    }
    let receipt = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      receipt = fs.readFileSync(collector.receiptPath, 'utf8');
      if (libraryReceiptCounts(receipt).httpSpanCount >= 3) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(receipt.includes(canary), false, 'URL canary must not reach the filtered receipt');
    assert.equal(receipt.includes('url.full'), false, 'Raw URL attribute must be removed');
    const counts = libraryReceiptCounts(receipt);
    assert.equal(counts.httpSpanCount, 3);
    assert.equal(counts.librarySpanCount, 3);
    assert.equal(counts.databaseSpanCount, 0);
    const runIds = new Set();
    for (const line of receipt.split('\n').filter(Boolean)) for (const resource of JSON.parse(line).resourceSpans || []) {
      for (const attr of resource.resource?.attributes || []) if (attr.key === 'agentops.run.id') runIds.add(attr.value.stringValue);
      for (const scope of resource.scopeSpans || []) for (const span of scope.spans || []) {
        const attrs = Object.fromEntries((span.attributes || []).map(item => [item.key, item.value.stringValue]));
        if (attrs['agentops.operation.kind'] === 'http') assert.equal(attrs['http.request.method'], 'GET');
      }
    }
    assert.deepEqual([...runIds].sort(), ['collector-cjs', 'collector-esm', 'collector-python']);
  } finally {
    if (collector) await collector.stop({ remove: false });
    await new Promise(resolve => server.close(resolve));
  }
});
