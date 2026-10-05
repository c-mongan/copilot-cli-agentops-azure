const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { attachCommand } = require('../src/lib/attach-command');
const { capturePreRunSnapshot, validPreRunSnapshot, attachmentProvenance, sessionSourceIntegrity } = require('../src/lib/copilot/run-evidence-contract');
const { buildStaticGraph, joinObserved } = require('../src/lib/architecture/graph');
const { computeAllMetrics, componentComplete } = require('../src/lib/architecture/metrics');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-contract-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  cp.execFileSync('git', ['init', '-q', dir]);
  fs.mkdirSync(path.join(dir, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'agents', 'test.agent.md'), 'PRIVATE_RAW_CONTENT');
  attachCommand(['--repo', dir, '--yes'], { stdout: { write() {} } });
  return dir;
}
test('snapshot is immutable metadata with verifiable hash; later manifest does not replace it', t => {
  const dir = fixture(t), snapshot = capturePreRunSnapshot({ cwd: dir });
  assert.equal(validPreRunSnapshot(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.architecture.agents[0]), true);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_RAW_CONTENT/);
  assert.equal(attachmentProvenance(snapshot, dir).status, 'unchanged');
  const manifest = path.join(dir, '.agentops', 'attachment.json');
  fs.appendFileSync(manifest, ' ');
  assert.equal(attachmentProvenance(snapshot, dir).status, 'unavailable');
  assert.equal(validPreRunSnapshot(snapshot), true);
  assert.equal(validPreRunSnapshot({ ...snapshot, architectureVersion: 'changed' }), false);
});
test('source integrity rejects malformed rows, duplicate boundaries and unmatched terminals; pending is partial', t => {
  const dir = fixture(t), file = path.join(dir, 'events.jsonl');
  const start = { type: 'session.start', data: { sessionId: 'test' } };
  const end = { type: 'session.shutdown', data: {} };
  const write = rows => fs.writeFileSync(file, rows.map(JSON.stringify).join('\n')+'\n');
  write([start, end]); assert.equal(sessionSourceIntegrity(file, 'test').status, 'valid');
  write([start, { type: 'tool.execution_start', data: { toolCallId: 'c' } }, end]);
  assert.equal(sessionSourceIntegrity(file, 'test').status, 'partial');
  write([start, start, end]); assert.equal(sessionSourceIntegrity(file, 'test').status, 'invalid');
  write([start, { type: 'tool.execution_complete', data: { toolCallId: 'c' } }, end]);
  assert.equal(sessionSourceIntegrity(file, 'test').status, 'invalid');
  write([start, end]); fs.appendFileSync(file, '{malformed\n');
  assert.equal(sessionSourceIntegrity(file, 'test').malformedRows, 1);
  assert.equal(sessionSourceIntegrity(file, 'wrong').status, 'invalid');
});
test('unknown global coverage permits positive diagnostics but no absence or probabilistic findings', t => {
  const dir = fixture(t);
  const snapshot = capturePreRunSnapshot({ cwd: dir, executionConfiguration: { configurationVersion: 'a'.repeat(16) }, taskId: 'task' });
  const graph = buildStaticGraph(snapshot.architecture);
  const run = joinObserved(graph, { runId: 'run', architectureVersion: snapshot.architectureVersion,
    configurationVersion: snapshot.configurationVersion, taskId: snapshot.taskId,
    preRunSnapshot: snapshot, attachmentProvenance: { status: 'unchanged' }, sourceIntegrity: { status: 'partial' },
    evidenceComplete: false, coverage: { tools: 'unknown' },
    events: [{ EventId: 'e', EventName: 'tool.execution_complete', ToolName: 'bash', ToolCallId: 'c', Status: 'completed' }] });
  const metrics = computeAllMetrics(graph, [run]);
  assert.equal(metrics.coverageRuns, 0);
  assert.equal(metrics.observedDiagnostics.tools.length, 1);
  assert.equal(metrics.observedDiagnostics.absenceEligible, false);
  assert.deepEqual(metrics.declaredVsObserved.notObserved.agents, []);
  assert.equal(componentComplete(graph, run, ['tools']), false);
  run.coverage.tools = 'complete';
  assert.equal(componentComplete(graph, run, ['tools']), false);
  run.attachmentProvenance.status = 'changed';
  assert.equal(computeAllMetrics(graph, [run]).observedDiagnostics.tools.length, 0);
});
test('caller denominator claims cannot qualify an unsupported exhaustive producer', t => {
  const dir = fixture(t);
  const snapshot = capturePreRunSnapshot({ cwd: dir, executionConfiguration: { configurationVersion: 'a'.repeat(16) }, taskId: 'task' });
  const graph = buildStaticGraph(snapshot.architecture);
  const run = joinObserved(graph, { runId: 'run', architectureVersion: snapshot.architectureVersion,
    configurationVersion: snapshot.configurationVersion, taskId: snapshot.taskId,
    preRunSnapshot: snapshot, attachmentProvenance: { status: 'unchanged' },
    lifecycle: { collector: 'completed', process: 'completed' },
    sourceIntegrity: { status: 'valid', freshSession: true, sha256: 'b'.repeat(64) },
    coverage: { tools: 'complete', skills: 'unknown' },
    componentDenominators: { tools: { status: 'complete', scope: 'entire-run', producer: 'synthetic-independent-audit', sourceSha256: 'b'.repeat(64), expected: 1, observed: 1 } },
    events: [{ EventId: 'e', EventName: 'tool.execution_complete', ToolName: 'bash', ToolCallId: 'c', Status: 'completed' }] });
  assert.equal(componentComplete(graph, run, ['tools']), false);
  assert.equal(componentComplete(graph, run, ['skills']), false);
  assert.equal(computeAllMetrics(graph, [run]).toolRepetition.length, 0);
  assert.equal(computeAllMetrics(graph, [run]).skillActivationRate.length, 0);
  assert.equal(computeAllMetrics(graph, [run]).coverageRuns, 0);
  run.componentDenominators.tools.scope = 'stimulus';
  assert.equal(componentComplete(graph, run, ['tools']), false);
  run.componentDenominators.tools.scope = 'entire-run';
  run.sourceIntegrity.freshSession = false;
  assert.equal(componentComplete(graph, run, ['tools']), false);
  run.sourceIntegrity.freshSession = true;
  run.configurationVersion = 'c'.repeat(16);
  assert.equal(componentComplete(graph, run, ['tools']), false);
});
test('explicit session identity on shutdown or tool lifecycle cannot cross the selected session', t => {
  const dir = fixture(t), file = path.join(dir, 'events.jsonl');
  for (const type of ['session.shutdown', 'tool.execution_start', 'tool.execution_complete']) {
    fs.writeFileSync(file, [
      { type: 'session.start', data: { sessionId: 'selected' } },
      { type, data: { sessionId: 'different', toolCallId: 'c' } },
      ...(type === 'session.shutdown' ? [] : [{ type: 'session.shutdown', data: { sessionId: 'selected' } }])
    ].map(JSON.stringify).join('\n'));
    assert.equal(sessionSourceIntegrity(file, 'selected').status, 'invalid', type);
  }
});
test('recorded-run complete claims cannot bypass invalid snapshot, source or changed attachment', t => {
  const dir = fixture(t), snapshot = capturePreRunSnapshot({ cwd: dir });
  const graph = buildStaticGraph(snapshot.architecture);
  const run = joinObserved(graph, { evidenceOrigin: 'recorded-run', runId: 'forged',
    architectureVersion: graph.architectureVersion, evidenceComplete: true,
    preRunSnapshot: {}, sourceIntegrity: { status: 'invalid' }, attachmentProvenance: { status: 'changed' },
    events: [{ EventId: 'e', EventName: 'tool.execution_complete', ToolName: 'bash', ToolCallId: 'c', Status: 'completed' }] });
  assert.equal(computeAllMetrics(graph, [run]).observedDiagnostics.tools.length, 0);
  assert.equal(componentComplete(graph, run, ['tools']), false);
});
test('actual loader and Runs renderer keep forged recorded global completeness unknown', t => {
  const { loadLedgerFromDirectory } = require('../src/lib/architecture-command');
  const { renderRuns } = require('../src/lib/architecture/views');
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'attachment.json'), JSON.stringify({ architecture: { agents: [], skills: [] } }));
  const runDir = path.join(dir, 'forged-complete'); fs.mkdirSync(runDir);
  const claimed = Object.fromEntries(['agents', 'skills', 'references', 'scripts', 'tools', 'models'].map(kind => [kind, 'complete']));
  fs.writeFileSync(path.join(runDir, 'run-context.json'), JSON.stringify({ evidenceComplete: true, coverage: claimed,
    preRunSnapshot: { status: 'unavailable' }, sessionId: 's' }));
  fs.writeFileSync(path.join(runDir, 'AgentOpsEvents_CL.jsonl'), JSON.stringify({ EventId: 'e', EventName: 'session.start' })+'\n');
  const loaded = loadLedgerFromDirectory(dir).runs.filter(run => run.runId === 'forged-complete');
  assert.equal(loaded[0].evidenceComplete, false);
  assert.equal(loaded[0].evidenceOrigin, 'recorded-run');
  assert.deepEqual(loaded[0].coverageClaims, claimed);
  assert.deepEqual(loaded[0].coverage, Object.fromEntries(Object.keys(claimed).map(kind => [kind, 'unknown'])));
  const html = renderRuns(loaded);
  assert.match(html, /Capture: partial or unknown/);
  assert.doesNotMatch(html, /Capture: complete/);
  assert.match(html, /tools: unknown/);
});
