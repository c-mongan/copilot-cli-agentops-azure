'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareAutoInstrumentation } = require('../plan.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-auto-plan-'));
const entry = path.join(root, 'app.cjs');
fs.writeFileSync(entry, 'console.log("app")');
const options = { runtime: 'node', executable: process.execPath, entry, projectRoot: root, endpoint: 'http://127.0.0.1:4318', runId: 'local-test' };
test('missing project dependencies produce a setup result without running the entry', () => {
  const plan = prepareAutoInstrumentation(options);
  assert.equal(plan.supported, false);
  assert.ok(plan.requirements.includes('@opentelemetry/sdk-node'));
  assert.equal(plan.env.OTEL_METRICS_EXPORTER, 'none');
  assert.equal(plan.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL, 'http/protobuf');
  assert.equal(plan.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, 'http://127.0.0.1:4318/v1/traces');
});
test('rejects remote exporters and credentialed endpoints', () => {
  for (const endpoint of ['http://example.org:4318', 'http://u:p@127.0.0.1:4318', 'http://127.0.0.1:4318/v1/traces', 'http://127.0.0.1:4318/?x=y']) assert.throws(() => prepareAutoInstrumentation({ ...options, endpoint }));
});
test('rejects symlink entries escaping the approved project', () => {
  const outside = path.join(os.tmpdir(), `agentops-outside-${process.pid}.cjs`);
  fs.writeFileSync(outside, '');
  const link = path.join(root, 'link.cjs');
  fs.symlinkSync(outside, link);
  assert.throws(() => prepareAutoInstrumentation({ ...options, entry: link }), /inside the approved project/);
  fs.unlinkSync(outside);
});
test('rejects shell strings, malformed context and unqualified TypeScript', () => {
  assert.throws(() => prepareAutoInstrumentation({ ...options, args: 'echo bad' }));
  assert.throws(() => prepareAutoInstrumentation({ ...options, traceparent: 'invalid' }));
  const ts = path.join(root, 'app.ts'); fs.writeFileSync(ts, '');
  assert.throws(() => prepareAutoInstrumentation({ ...options, entry: ts }), /compile TypeScript/);
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test('Electron runtime dependency probes and child plan explicitly use Node mode', () => {
  let probe;
  const plan = prepareAutoInstrumentation({ ...options, electronRuntime: true }, {
    spawnSync: (command, args, env) => { probe = { command, args, env }; return { status: 0, stdout: JSON.stringify({ missing: [] }) }; }
  });
  assert.equal(plan.supported, true);
  assert.equal(probe.env.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(plan.env.ELECTRON_RUN_AS_NODE, '1');
});
