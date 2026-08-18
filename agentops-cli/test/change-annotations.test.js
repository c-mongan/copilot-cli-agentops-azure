const assert = require('node:assert/strict');
const test = require('node:test');

const {
  changeAnnotationsForRun,
  changeRef,
  configChangeAnnotationsForSession,
  normalizeChangeAnnotation,
  normalizeConfigChangeAnnotation,
  parseDetailsValue,
  propertyValue
} = require('../src/lib/change-annotations');

test('change annotations normalize config-change rows from property aliases and details', () => {
  const row = {
    TimeGenerated: '2026-06-03T11:59:55Z',
    Details: 'annotation_type=config_change component=skill target=agentops-latest-run change_type=updated change_id=change-123 version=2026.06.03',
    Properties: {
      'agentops.custom.component': 'hook',
      'agentops.run.id': 'run-regression',
      'gen_ai.conversation.id': 'session-regression'
    }
  };
  const annotation = normalizeConfigChangeAnnotation(row);

  assert.equal(propertyValue(row, 'component'), 'hook');
  assert.equal(parseDetailsValue(row.Details, 'target'), 'agentops-latest-run');
  assert.equal(annotation.component, 'hook');
  assert.equal(annotation.target, 'agentops-latest-run');
  assert.equal(annotation.change_id, 'change-123');
  assert.equal(annotation.run_id, 'run-regression');
  assert.equal(annotation.session_id, 'session-regression');
  assert.deepEqual(normalizeChangeAnnotation(row), annotation);
  assert.equal(normalizeConfigChangeAnnotation({ EventName: 'noise' }), null);
});

test('change annotations filter by run or session and render change refs', () => {
  const rows = [
    {
      EventName: 'agentops.config.changed',
      RunId: 'run-1',
      SessionId: 'session-1',
      ChangeComponent: 'skill',
      ChangeTarget: 'agentops-latest-run'
    },
    {
      EventName: 'agentops.config.changed',
      RunId: 'run-2',
      SessionId: 'session-2',
      ChangeComponent: 'model',
      ChangeTarget: 'SECRET_SHOULD_NOT_ATTACH'
    }
  ];
  const runAnnotations = changeAnnotationsForRun(rows, { RunId: 'run-1' });
  const sessionAnnotations = configChangeAnnotationsForSession(rows, 'session-1');

  assert.equal(runAnnotations.length, 1);
  assert.equal(sessionAnnotations.length, 1);
  assert.equal(changeRef(runAnnotations[0]), 'skill:agentops-latest-run');
});
