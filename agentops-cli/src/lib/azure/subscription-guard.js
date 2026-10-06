const childProcess = require('node:child_process');

// Public builds must not embed an owner's Azure subscription. Operators approve
// write targets explicitly through AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS or
// the injected option used by tests and embedding applications.
const APPROVED_AZURE_SUBSCRIPTION_IDS = Object.freeze([]);

function normalizedSubscriptionId(value) {
  return String(value || '').trim().toLowerCase();
}

function expectedSubscriptionId(options = {}) {
  const env = options.env || process.env;
  return normalizedSubscriptionId(
    options.expectedSubscriptionId
      || env.AGENTOPS_AZURE_SUBSCRIPTION_ID
  );
}

function approvedSubscriptionIds(options = {}) {
  const env = options.env || process.env;
  const configured = options.approvedSubscriptionIds === undefined
    ? String(env.AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS || '').split(/[\s,]+/)
    : options.approvedSubscriptionIds;
  return [...new Set((Array.isArray(configured) ? configured : [configured])
    .map(normalizedSubscriptionId)
    .filter(Boolean))];
}

function checkAzureSubscription(options = {}) {
  const expected = expectedSubscriptionId(options);
  const approved = approvedSubscriptionIds(options);
  if (!expected) {
    return {
      ok: false,
      expected: '',
      active: '',
      error: 'Set AGENTOPS_AZURE_SUBSCRIPTION_ID before an Azure write. The guard does not infer a subscription.'
    };
  }

  if (approved.length === 0) {
    return {
      ok: false,
      expected,
      active: '',
      approved,
      error: 'Set AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS before an Azure write. Public builds contain no embedded subscription allowlist.'
    };
  }

  if (!approved.includes(expected)) {
    return {
      ok: false,
      expected,
      active: '',
      approved,
      error: `Azure subscription guard refused the write: configured subscription ${expected} is not in AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS.`
    };
  }

  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const accountArgs = ['account', 'show', ...(options.requireActive === false ? ['--subscription', expected] : []), '--query', 'id', '-o', 'tsv'];
  const result = spawnSync('az', accountArgs, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      expected,
      active: '',
      error: `Could not verify the active Azure subscription${result.error ? `: ${result.error.message}` : ` (az exited ${result.status})`}.`
    };
  }

  const active = normalizedSubscriptionId(result.stdout);
  if (!active || active !== expected) {
    return {
      ok: false,
      expected,
      active,
      error: `Azure subscription guard refused the write: expected ${expected}, ${options.requireActive === false ? 'selected' : 'active'} ${active || 'unknown'}.`
    };
  }

  return { ok: true, expected, active, approved, error: '' };
}

module.exports = {
  APPROVED_AZURE_SUBSCRIPTION_IDS,
  approvedSubscriptionIds,
  checkAzureSubscription,
  expectedSubscriptionId,
  normalizedSubscriptionId
};
