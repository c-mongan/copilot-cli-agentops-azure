const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  evidenceDir,
  latestEvidenceDir,
  redactText,
  safeE2eEnv,
  writeJson
} = require('../src/lib/e2e-runtime');
const { repoRoot } = require('../src/lib/paths');

test('e2e runtime helpers build stable paths and strict env defaults', () => {
  assert.equal(evidenceDir('fixed-run'), path.join(repoRoot, '.agentops', 'e2e', 'fixed-run'));
  assert.equal(latestEvidenceDir(), path.join(repoRoot, '.agentops', 'e2e', 'latest'));
  assert.deepEqual(safeE2eEnv({ AGENTOPS_E2E_ID: 'agentops-e2e-test' }), {
    AGENTOPS_PRIVACY_MODE: 'strict',
    AGENTOPS_CAPTURE_CONTENT: 'false',
    AGENTOPS_DISABLE_CONTENT_CAPTURE_OVERRIDE: '1',
    COPILOT_OTEL_CAPTURE_CONTENT: 'false',
    AGENTOPS_E2E_ID: 'agentops-e2e-test'
  });
});

test('e2e runtime helpers write json and redact sensitive command output', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-e2e-runtime-'));
  const out = path.join(tempRoot, 'nested', 'payload.json');

  writeJson(out, { ok: true });

  assert.equal(fs.readFileSync(out, 'utf8'), '{\n  "ok": true\n}\n');
  assert.equal(
    redactText('TOKEN=abc InstrumentationKey=secret; Authorization=Bearer raw'),
    'TOKEN=[REDACTED] InstrumentationKey=[REDACTED] Authorization=Bearer [REDACTED]'
  );
});

test('e2e runtime uses shared JSON file writer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'e2e-runtime.js'), 'utf8');
  assert.doesNotMatch(source, /function writeJson\(/);
});
