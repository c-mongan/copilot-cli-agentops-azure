const assert = require('node:assert/strict');
const test = require('node:test');

const { createAlertActionGroupActions } = require('../src/lib/alert-action-group-actions');
const TEST_APPROVED_SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';

function createActions() {
  return createAlertActionGroupActions({
    alertHandoff: ({ rule, session, last = '24h', owners = [], resourceGroup }) => ({
      schema_version: 'agentops.alert-handoff.v1',
      alert: {
        rule,
        session,
        last,
        owner: owners[0] || null
      },
      resource_group: resourceGroup,
      evidence: {
        detail: {
          session_link: {
            grafana_url: `https://grafana.example/d/session?var-session_id=${session}`
          },
          history_query: `AlertHistory | where Conversation == "${session}"`
        }
      }
    })
  });
}

test('alert action group module previews action group creation', () => {
  const { alertActionGroupPlan } = createActions();

  const plan = alertActionGroupPlan({
    resourceGroup: 'rg-agentops-dev',
    name: 'ag-agentops-oncall',
    shortName: 'agentops',
    owners: ['agentops-oncall'],
    emails: ['ops@example.com'],
    webhooks: ['https://example.com/agentops-webhook']
  });

  assert.equal(plan.schema_version, 'agentops.alert-action-group-plan.v1');
  assert.equal(plan.mode, 'preview-only-action-group-plan');
  assert.equal(plan.command.executable, 'az');
  assert.deepEqual(plan.receivers.email, [{ name: 'email-1', email_address: 'ops@example.com' }]);
  assert.deepEqual(plan.receivers.webhook, [{ name: 'webhook-1', service_uri: 'https://example.com/agentops-webhook' }]);
  assert.match(plan.follow_up_route_command, /alert route-action-group/);

  assert.throws(() => alertActionGroupPlan({
    resourceGroup: 'rg-agentops-dev',
    name: 'ag-agentops-oncall',
    shortName: 'agentops',
    owners: ['agentops-oncall']
  }), /requires at least one --email/);
});

test('alert action group module dry-runs and posts scheduled query routing', () => {
  const { alertActionGroupRoute } = createActions();
  const actionGroupId = '/subscriptions/sub-123/resourceGroups/rg-agentops-dev/providers/microsoft.insights/actionGroups/ag-agentops';

  const dryRun = alertActionGroupRoute({
    rule: 'failed-spans',
    session: 'session-123',
    last: '6h',
    owners: ['agentops-oncall'],
    resourceGroup: 'rg-agentops-dev',
    scheduledQuery: 'sqr-agentops-failed-spans',
    actionGroups: [actionGroupId]
  });

  assert.equal(dryRun.schema_version, 'agentops.alert-action-group-route.v1');
  assert.equal(dryRun.mode, 'dry-run-action-group-route');
  assert.equal(dryRun.command.executable, 'az');
  assert.ok(dryRun.command.args.includes(actionGroupId));
  assert.equal(dryRun.enable_alert, false);
  assert.match(dryRun.evidence.history_query, /Conversation == "session-123"/);

  let invoked = null;
  const posted = alertActionGroupRoute({
    rule: 'failed-spans',
    session: 'session-456',
    owners: ['agentops-oncall'],
    resourceGroup: 'rg-agentops-dev',
    scheduledQuery: 'sqr-agentops-failed-spans',
    actionGroups: [actionGroupId],
    enableAlert: true,
    yes: true,
    expectedSubscriptionId: TEST_APPROVED_SUBSCRIPTION_ID,
    approvedSubscriptionIds: [TEST_APPROVED_SUBSCRIPTION_ID],
    spawnSync: (command, args, options) => {
      invoked = { command, args, options };
      if (args[0] === 'account') return { status: 0, stdout: `${TEST_APPROVED_SUBSCRIPTION_ID}\n`, stderr: '' };
      return { status: 0, stdout: '{"name":"sqr-agentops-failed-spans"}', stderr: '' };
    }
  });

  assert.equal(posted.mode, 'routed-action-group');
  assert.equal(posted.status, 0);
  assert.equal(invoked.command, 'az');
  assert.ok(invoked.args.includes('--disabled'));
  assert.ok(invoked.args.includes('false'));
  assert.equal(invoked.options.encoding, 'utf8');
});
