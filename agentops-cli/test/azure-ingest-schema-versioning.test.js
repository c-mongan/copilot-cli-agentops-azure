const assert = require('node:assert/strict');
const test = require('node:test');

const {
  schemaMigrationSummary,
  schemaVersionFor,
  schemaVersioningSummary
} = require('../src/lib/azure/v2-schema-versioning');

test('azure ingest schema versioning detects current missing legacy and unsupported rows', () => {
  const current = schemaVersionFor('AgentOpsRunSummary_CL', [
    { SchemaVersion: '2' },
    { SchemaVersion: '2' }
  ]);
  assert.equal(current.ok, true);
  assert.deepEqual(current.versions, ['2']);
  assert.equal(current.migration.status, 'current');

  const migration = schemaVersionFor('AgentOpsRunSummary_CL', [
    {},
    { SchemaVersion: '1' },
    { SchemaVersion: '3' }
  ]);
  assert.equal(migration.ok, false);
  assert.equal(migration.missing_rows, 1);
  assert.deepEqual(migration.mismatched_versions, ['1', '3']);
  assert.equal(migration.migration.status, 'unsupported-newer');
  assert.equal(migration.migration.compatible_for_ingest, false);
  assert.deepEqual(migration.migration.legacy_versions, ['1']);
  assert.deepEqual(migration.migration.unsupported_versions, ['3']);
  assert.match(migration.migration.actions.join('\n'), /missing-version row/);
  assert.match(migration.migration.actions.join('\n'), /version\(s\) 1 to 2/);
  assert.match(migration.migration.actions.join('\n'), /unsupported newer schema version\(s\) 3/);

  const unchecked = schemaVersionFor('AgentOpsAlertHandoffs', [{ schema_version: 'agentops.alert-handoff.v1' }]);
  assert.equal(unchecked.checked, false);
  assert.equal(unchecked.ok, true);

  const tables = {
    AgentOpsRunSummary_CL: { schema_version: migration },
    AgentOpsEvents_CL: { schema_version: current },
    AgentOpsAlertHandoffs: { schema_version: unchecked }
  };
  assert.deepEqual(schemaVersioningSummary(tables).mismatched_tables, [
    { table: 'AgentOpsRunSummary_CL', versions: ['1', '3'] }
  ]);
  assert.deepEqual(schemaMigrationSummary(tables).unsupported_tables, [
    { table: 'AgentOpsRunSummary_CL', versions: ['3'] }
  ]);
});
