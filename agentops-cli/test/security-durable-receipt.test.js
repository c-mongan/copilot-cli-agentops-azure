const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { durableReceiptSecurityCheck, securityAudit } = require('../src/lib/security-audit');

const repoRoot = path.resolve(__dirname, '..', '..');
const files = [
  'agentops-cli/src/lib/azure/durable-evidence-spool.js',
  'agentops-cli/src/lib/azure/logs-ingestion-upload.js',
  'agentops-cli/src/lib/azure/subscription-guard.js'
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-durable-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, file), destination);
  }
  return root;
}

function rewrite(root, file, change) {
  const absolute = path.join(root, file);
  fs.writeFileSync(absolute, change(fs.readFileSync(absolute, 'utf8')));
}

test('durable receipt security audit aggregates all blocking delivery controls', t => {
  const root = fixture(t);
  const result = durableReceiptSecurityCheck({ root });

  assert.equal(result.ok, true, result.detail);
  assert.equal(result.severity, 'info');
  assert.deepEqual(result.evidence.map(item => item.file), files);
  assert.ok(result.evidence.flatMap(item => item.controls).includes('no-raw-reason-error'));

  const audit = securityAudit({
    root,
    runStaticCheck: () => ({ name: 'static', ok: true, severity: 'info' }),
    runGitleaks: () => ({ name: 'gitleaks', ok: true, severity: 'info' })
  });
  assert.equal(audit.checks.some(check => check.name === 'durable-receipt-security'), true);
});

test('durable receipt security audit blocks aggregate schema privacy destination bounds and persistence regressions', t => {
  const root = fixture(t);
  const spool = files[0];
  const upload = files[1];
  rewrite(root, spool, body => body
    .replace("  'AgentOpsEvents_CL'", "  'AgentOpsEvents_CL', 'AgentOpsRunSummary_CL'")
    .replace("row.PrivacyMode = 'strict'", "row.PrivacyMode = input.PrivacyMode")
    .replace('const maximumDrainAttempts = 10;', 'const removedAttemptBound = 10;')
    .replace("  'SchemaVersion'", "  'SchemaVersion', 'Reason', 'Error'"));
  rewrite(root, upload, body => body
    .replace(".endsWith('.ingest.monitor.azure.com')", ".endsWith('.example.com')")
    .replace('AbortSignal.timeout(timeoutMs)', 'undefined'));

  const result = durableReceiptSecurityCheck({ root });

  assert.equal(result.ok, false);
  assert.equal(result.severity, 'error');
  assert.match(result.detail, /AgentOpsEvents_CL only/);
  assert.match(result.detail, /force strict privacy/);
  assert.match(result.detail, /attempt bounds/);
  assert.match(result.detail, /raw Reason\/Error/);
  assert.match(result.detail, /Azure public Monitor hostname/);
  assert.match(result.detail, /bounded timeout/);
});
