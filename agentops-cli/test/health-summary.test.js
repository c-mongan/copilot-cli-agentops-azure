const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function freshRequire(relativePath) {
  const absolutePath = path.join(repoRoot, 'agentops-cli', relativePath);
  delete require.cache[require.resolve(absolutePath)];
  return require(absolutePath);
}

function patch(object, property, value) {
  const original = object[property];
  object[property] = value;
  return () => {
    object[property] = original;
  };
}

test('status summary library composes local collector and copilot readiness', async () => {
  const legacy = require('../src/legacy');
  const collector = require('../src/lib/collector-manager');
  const resolver = require('../src/lib/copilot-resolver');
  const restore = [
    patch(legacy, 'doctor', () => [{ name: 'content-capture-disabled', ok: true }]),
    patch(legacy, 'agentopsStatusSummary', () => ({
      ok: true,
      required_files: { found: 3, total: 3 },
      shim: { agentops_cli: 'ok', agentops_command: 'ok', shadow: 'safe' }
    })),
    patch(collector, 'status', async () => ({
      running: true,
      mode: 'auto',
      effectiveMode: 'binary',
      privacyMode: 'strict',
      safeLocalhostBinding: true
    })),
    patch(resolver, 'resolveCopilotBinary', () => ({
      ok: true,
      path: '/usr/local/bin/copilot',
      source: 'PATH',
      error: null,
      candidates: []
    }))
  ];

  try {
    const { renderStatus, statusSummary } = freshRequire('src/lib/status-summary.js');
    const summary = await statusSummary();
    assert.equal(summary.content_capture_off, true);
    assert.equal(summary.collector.running, true);
    assert.equal(summary.copilot.path, '/usr/local/bin/copilot');
    assert.match(renderStatus(summary), /Collector: running \(binary, strict\)\./);
  } finally {
    restore.reverse().forEach(fn => fn());
  }
});

test('status summary reports durable delivery counters without claiming Azure visibility', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-status-delivery-'));
  try {
    const { createDurableEvidenceSpool } = require('../src/lib/azure/durable-evidence-spool');
    const { durableDeliveryStatus } = freshRequire('src/lib/status-summary.js');
    const spool = createDurableEvidenceSpool({ directory: tempDir });
    spool.enqueue({
      TimeGenerated: '2026-08-03T12:00:00.000Z',
      Sequence: 1,
      EventId: 'event-safe',
      RunId: 'run-safe',
      SessionId: 'session-safe',
      EventName: 'agentops.run.start',
      PrivacyMode: 'strict',
      ContentCaptureMode: 'off',
      Surface: 'cli',
      SchemaVersion: '2'
    });
    const delivery = durableDeliveryStatus({ directory: tempDir });
    assert.equal(delivery.state, 'local_pending');
    assert.equal(delivery.pending, 1);
    assert.doesNotMatch(delivery.headline, /visible|accepted by Azure/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('health summary library reports latest run attention state', () => {
  const { renderHealth, runHealthFromRows, summarizeChecks } = freshRequire('src/lib/health-summary.js');
  const latestRun = runHealthFromRows([
    {
      TimeGenerated: '2026-01-01T00:00:00.000Z',
      RunId: 'run_old',
      OutcomeStatus: 'success',
      TestsRan: true,
      PrivacyMode: 'strict'
    },
    {
      TimeGenerated: '2026-01-02T00:00:00.000Z',
      RunId: 'run_new',
      SessionId: 'session_new',
      OutcomeStatus: 'success',
      FilesEditedCount: 2,
      TestsRan: false,
      PrivacyMode: 'strict'
    }
  ]);

  assert.deepEqual(summarizeChecks([
    { name: 'pass', ok: true },
    { name: 'warn', ok: false, severity: 'warning' },
    { name: 'block', ok: false }
  ]), {
    total: 3,
    passed: 1,
    warnings: 1,
    blocking: 1
  });
  assert.equal(latestRun.run_id, 'run_new');
  assert.equal(latestRun.status, 'needs-attention');
  assert.match(renderHealth({
    status: 'needs-attention',
    checks: { passed: 1, total: 3, warnings: 1, blocking: 1 },
    local: {
      collector_running: false,
      collector_mode: 'auto',
      collector_privacy_mode: 'strict',
      content_capture_off: true
    },
    latest_run: latestRun,
    next_action: 'Review warnings.'
  }), /Latest run: run_new \(needs-attention\)/);
});
