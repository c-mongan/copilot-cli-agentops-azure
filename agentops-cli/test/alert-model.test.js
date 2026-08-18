const assert = require('node:assert/strict');
const test = require('node:test');

const {
  alertPolicy,
  alertResourceState,
  alertRules,
  configChangeAnnotationsForSession,
  normalizeConfigChangeAnnotation,
  requireAlertRule
} = require('../src/lib/alert-model');

test('alert model helpers summarize rules resources policy and config annotations', () => {
  const row = {
    EventName: 'agentops.config.changed',
    TimeGenerated: '2026-01-01T00:00:00Z',
    Properties: {
      'agentops.custom.component': 'mcp',
      'agentops.custom.target': 'server_hash',
      'agentops.custom.change_type': 'updated',
      'agentops.custom.change_id': 'change-123',
      'gen_ai.conversation.id': 'session-123'
    }
  };
  const annotation = normalizeConfigChangeAnnotation(row);

  assert.equal(annotation.session_id, 'session-123');
  assert.equal(annotation.component, 'mcp');
  assert.equal(configChangeAnnotationsForSession([row, { EventName: 'noise' }], 'session-123').length, 1);
  assert.equal(requireAlertRule('content-capture', 'test').name, 'content-capture');
  assert.equal(alertRules('7d').find(rule => rule.name === 'failed-spans').last, '7d');

  const resources = alertResourceState({
    workspaceId: 'workspace-123',
    resourceGroup: 'rg-agentops',
    resources: [{
      name: 'rule-one',
      properties: {
        enabled: 'true',
        actions: { actionGroups: ['/actionGroups/oncall'] },
        evaluationFrequency: 'PT5M'
      }
    }]
  });
  assert.deepEqual(resources.summary, { total: 1, enabled: 1, disabled: 0, routed: 1 });

  const policy = alertPolicy({
    workspaceId: 'workspace-123',
    owners: ['oncall@example.com'],
    service: 'agentops'
  });
  assert.equal(policy.ownership.state, 'assigned');
  assert.equal(policy.escalation.requires_manual_review, true);
});
