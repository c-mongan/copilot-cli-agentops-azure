const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { checkAzureSubscription } = require('../src/lib/azure/subscription-guard');

const APPROVED = '11111111-1111-4111-8111-111111111111';
const UNAPPROVED = '22222222-2222-4222-8222-222222222222';

test('subscription guard fails closed without an explicitly configured subscription', () => {
  let called = false;
  const result = checkAzureSubscription({
    env: {},
    spawnSync() {
      called = true;
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Set AGENTOPS_AZURE_SUBSCRIPTION_ID/);
  assert.equal(called, false);
});

test('subscription guard does not accept the generic Azure subscription variable as write approval', () => {
  const result = checkAzureSubscription({
    env: {
      AZURE_SUBSCRIPTION_ID: APPROVED,
      AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: APPROVED
    },
    spawnSync() {
      throw new Error('az must not run without AGENTOPS_AZURE_SUBSCRIPTION_ID');
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Set AGENTOPS_AZURE_SUBSCRIPTION_ID/);
});

test('subscription guard fails closed when a public build has no approved allowlist', () => {
  let called = false;
  const result = checkAzureSubscription({
    expectedSubscriptionId: APPROVED,
    env: {},
    spawnSync() {
      called = true;
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS/);
  assert.equal(called, false);
});

test('subscription guard accepts the exact active subscription case-insensitively', () => {
  const result = checkAzureSubscription({
    expectedSubscriptionId: APPROVED.toUpperCase(),
    approvedSubscriptionIds: [APPROVED],
    spawnSync() {
      return { status: 0, stdout: `${APPROVED}\n`, stderr: '' };
    }
  });

  assert.deepEqual(result, { ok: true, expected: APPROVED, active: APPROVED, approved: [APPROVED], error: '' });
});

test('subscription guard rejects a subscription missing from the explicit allowlist', () => {
  let called = false;
  const result = checkAzureSubscription({
    expectedSubscriptionId: UNAPPROVED,
    approvedSubscriptionIds: [APPROVED],
    spawnSync() {
      called = true;
      return { status: 0, stdout: `${UNAPPROVED}\n`, stderr: '' };
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not in AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS/);
  assert.equal(called, false);
});

test('shell subscription guard also rejects a matching unapproved subscription', () => {
  const guard = path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'azure-subscription-guard.sh');
  const result = childProcess.spawnSync('bash', ['-c', `az() { printf '%s\\n' "$ACTIVE_TEST_SUB"; }; source "$GUARD_PATH"; agentops_require_azure_subscription`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ACTIVE_TEST_SUB: UNAPPROVED,
      AGENTOPS_AZURE_SUBSCRIPTION_ID: UNAPPROVED,
      AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: APPROVED,
      GUARD_PATH: guard
    }
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /not in AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS/);
});

test('shell subscription guard rejects AZURE_SUBSCRIPTION_ID as a write-approval substitute', () => {
  const guard = path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'azure-subscription-guard.sh');
  const result = childProcess.spawnSync('bash', ['-c', `az() { printf '%s\\n' "$ACTIVE_TEST_SUB"; }; source "$GUARD_PATH"; agentops_require_azure_subscription`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ACTIVE_TEST_SUB: APPROVED,
      AZURE_SUBSCRIPTION_ID: APPROVED,
      AGENTOPS_AZURE_SUBSCRIPTION_ID: '',
      AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: APPROVED,
      GUARD_PATH: guard
    }
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /set AGENTOPS_AZURE_SUBSCRIPTION_ID/);
});

test('shell subscription guard accepts an explicitly approved active subscription', () => {
  const guard = path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'azure-subscription-guard.sh');
  const result = childProcess.spawnSync('bash', ['-c', `az() { printf '%s\\n' "$ACTIVE_TEST_SUB"; }; source "$GUARD_PATH"; agentops_require_azure_subscription`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ACTIVE_TEST_SUB: APPROVED,
      AGENTOPS_AZURE_SUBSCRIPTION_ID: APPROVED,
      AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: APPROVED,
      GUARD_PATH: guard
    }
  });

  assert.equal(result.status, 0);
  assert.match(result.stderr, /verified/);
});

test('PowerShell collector guard uses the explicit public allowlist without an embedded subscription', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'collector-azuremonitor-up.ps1'), 'utf8');
  assert.match(script, /AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS/);
  assert.match(script, /not in AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS/);
  assert.doesNotMatch(script, /elseif \(\$env:AZURE_SUBSCRIPTION_ID\)/);
  assert.doesNotMatch(script, /approvedSubscriptionId\s*=\s*"[0-9a-f-]{36}"/i);
});

test('Application Insights smoke streams secret-bearing payloads without persistent temp files', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'azure-smoke-appinsights.sh'), 'utf8');
  assert.doesNotMatch(script, /payload_file|appinsights\.response|--data-binary\s+"@\$payload_file"/);
  assert.match(script, /--data-binary\s+@-/);
});

test('packaged infrastructure guide documents both explicit Azure write controls', () => {
  const guide = fs.readFileSync(path.resolve(__dirname, '..', '..', 'infra', 'README.md'), 'utf8');
  assert.match(guide, /AGENTOPS_AZURE_SUBSCRIPTION_ID="<approved-subscription-id>"/);
  assert.match(guide, /AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS="<approved-subscription-id>"/);
  assert.doesNotMatch(guide, /\n\s*AZURE_SUBSCRIPTION_ID="<approved-subscription-id>"/);
});
