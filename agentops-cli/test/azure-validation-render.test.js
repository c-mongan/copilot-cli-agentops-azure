const assert = require('node:assert/strict');
const test = require('node:test');

const { renderValidateAzure } = require('../src/lib/azure-validation-render');

test('azure validation renderer formats checks remediations and next steps', () => {
  const output = renderValidateAzure({
    ok: false,
    checks: [
      { name: 'az-cli', ok: true, detail: 'logged in' },
      {
        name: 'grafana-dashboards',
        ok: false,
        detail: '2 expected dashboards missing',
        missing: ['agentops-home', 'agentops-runs']
      },
      { name: 'grafana-resource', ok: true, skipped: true, detail: 'resource name is not configured' }
    ],
    remediation_plan: {
      note: 'Review these commands before running them.',
      actions: [{
        name: 'import-dashboards',
        risk: 'low',
        reason: 'Dashboards are missing.',
        review: 'Confirm Grafana target first.',
        commands: ['agentops dashboard import --yes']
      }]
    },
    next: ['agentops validate-azure --import-dashboards --last 24h']
  });

  assert.match(output, /^AgentOps Azure validation/);
  assert.match(output, /- az-cli: ok \(logged in\)/);
  assert.match(output, /- grafana-dashboards: failed \(2 expected dashboards missing\)/);
  assert.match(output, /missing: agentops-home, agentops-runs/);
  assert.match(output, /fix: agentops validate-azure --import-dashboards --last 24h/);
  assert.match(output, /- grafana-resource: skipped \(resource name is not configured\)/);
  assert.match(output, /Azure validation is incomplete\./);
  assert.match(output, /Remediation plan:\nReview these commands before running them\./);
  assert.match(output, /command: agentops dashboard import --yes/);
  assert.match(output, /Next:\n- agentops validate-azure --import-dashboards --last 24h/);
});
