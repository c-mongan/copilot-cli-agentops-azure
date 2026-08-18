const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  agentOpsEventsColumnsFromBicep,
  validateAdditiveSchemaMigration,
  validateAgentOpsEventsBicepMigration
} = require('../src/lib/azure/v2-ingestion-schema-safety');

const bicepPath = path.resolve(__dirname, '../../infra/bicep/v2-ingestion.bicep');
const bicep = fs.readFileSync(bicepPath, 'utf8');

test('AgentOpsEvents Bicep preserves legacy cost type and adds ordered receipt columns', () => {
  const columns = new Map(agentOpsEventsColumnsFromBicep(bicep).map(column => [column.name, column.type]));
  assert.equal(columns.get('EstimatedCostUsd'), 'long');
  assert.equal(columns.get('EstimatedCostUsdReal'), 'real');
  assert.equal(columns.get('EventId'), 'string');
  assert.equal(columns.get('Sequence'), 'long');
});

test('migration guard accepts a purely additive desired schema', () => {
  const live = [
    { name: 'TimeGenerated', type: 'datetime' },
    { name: 'EstimatedCostUsd', type: 'long' },
    { name: 'ExistingProductionColumn', type: 'string' }
  ];
  const desired = [...live, { name: 'EventId', type: 'string' }];
  const result = validateAdditiveSchemaMigration(live, desired);
  assert.equal(result.ok, true);
  assert.deepEqual(result.additive_columns, [{ name: 'EventId', type: 'string' }]);
  assert.deepEqual(result.violations, []);
});

test('migration guard rejects removal and immutable type changes independently', () => {
  const result = validateAdditiveSchemaMigration([
    { name: 'KeepMe', type: 'string' },
    { name: 'EstimatedCostUsd', type: 'long' }
  ], [
    { name: 'EstimatedCostUsd', type: 'real' },
    { name: 'EventId', type: 'string' }
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    { column: 'KeepMe', live_type: 'string', desired_type: null, issue: 'would_remove_live_column' },
    { column: 'EstimatedCostUsd', live_type: 'long', desired_type: 'real', issue: 'would_change_existing_type' }
  ]);
});

test('real v2 Bicep is additive against an injected compatible live schema', () => {
  const live = agentOpsEventsColumnsFromBicep(bicep).filter(column => !['EventId', 'Sequence', 'EstimatedCostUsdReal'].includes(column.name));
  const result = validateAgentOpsEventsBicepMigration(bicep, live);
  assert.equal(result.ok, true);
  assert.deepEqual(result.contract_violations, []);
  assert.deepEqual(result.additive_columns.map(column => column.name), ['Sequence', 'EventId', 'EstimatedCostUsdReal']);
});

test('Bicep migration preflight fails closed when an injected live column would be lost', () => {
  const live = [
    ...agentOpsEventsColumnsFromBicep(bicep),
    { name: 'LiveOnlyColumn', type: 'guid' }
  ];
  const result = validateAgentOpsEventsBicepMigration(bicep, live);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    { column: 'LiveOnlyColumn', live_type: 'guid', desired_type: null, issue: 'would_remove_live_column' }
  ]);
});
