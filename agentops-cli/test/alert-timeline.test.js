const assert = require('node:assert/strict');
const test = require('node:test');

const { incidentTimelineFromArtifacts } = require('../src/lib/alert-timeline');

function artifact({ rule, session, createdAt, ticket = null, extraExcluded = [] }) {
  return {
    schema_version: 'agentops.alert-artifact.v1',
    created_at: createdAt,
    rule,
    session,
    last: '4h',
    privacy: {
      mode: 'metadata-only',
      excluded: ['prompts', ...extraExcluded]
    },
    evidence: {
      history_query: `history ${rule}`,
      session_link: { conversation: session, workspace_id: 'workspace-from-link' },
      threshold_evidence_query: `threshold ${rule}`
    },
    action_plan: {
      title: `AgentOps alert: ${rule}`,
      severity: rule === 'content-capture' ? 'critical' : 'review',
      safe_metadata: { signal: rule },
      guardrails: ['metadata-only']
    },
    status: {
      state: 'review',
      ticket,
      notes: []
    }
  };
}

test('alert timeline normalizes artifacts chronologically without content fields', () => {
  const timeline = incidentTimelineFromArtifacts({
    artifacts: [
      artifact({ rule: 'failed-spans', session: 'session-b', createdAt: '2026-06-03T12:10:00.000Z', ticket: 'INC-2', extraExcluded: ['tool results'] }),
      artifact({ rule: 'content-capture', session: 'session-a', createdAt: '2026-06-03T12:00:00.000Z', ticket: 'INC-1', extraExcluded: ['responses'] })
    ],
    createdAt: '2026-06-03T12:30:00.000Z',
    incidentId: 'incident-123',
    workspaceId: 'workspace-default'
  });

  assert.equal(timeline.schema_version, 'agentops.incident-timeline.v1');
  assert.equal(timeline.workspace_id, 'workspace-from-link');
  assert.equal(timeline.incident_id, 'incident-123');
  assert.deepEqual(timeline.status.tickets, ['INC-1', 'INC-2']);
  assert.equal(timeline.timeline[0].rule, 'content-capture');
  assert.equal(timeline.timeline[1].rule, 'failed-spans');
  assert.ok(timeline.privacy.excluded.includes('tool results'));
  assert.ok(timeline.privacy.excluded.includes('responses'));
  assert.ok(timeline.next.some(step => step.includes('assign an owner')));
  assert.doesNotMatch(JSON.stringify(timeline), /SECRET_FAKE_TEST_VALUE|raw transcript/);
});

test('alert timeline validates input artifacts', () => {
  assert.throws(
    () => incidentTimelineFromArtifacts({ artifacts: [], createdAt: '2026-06-03T12:30:00.000Z' }),
    /requires at least one alert artifact/
  );
  assert.throws(
    () => incidentTimelineFromArtifacts({ artifacts: [{ schema_version: 'other' }] }),
    /must be an agentops.alert-artifact.v1 JSON file/
  );
});
