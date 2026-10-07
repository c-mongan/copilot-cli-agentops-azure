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
const bicep = fs.readFileSync(bicepPath, 'utf8').replace(/\r\n/g, '\n');
const evalSpansBicep = fs.readFileSync(path.resolve(__dirname, '../../infra/bicep/eval-spans.bicep'), 'utf8').replace(/\r\n/g, '\n');
const runtimeMigrationBicep = fs.readFileSync(path.resolve(__dirname, '../../infra/bicep/migrate-script-runtime-schema.bicep'), 'utf8').replace(/\r\n/g, '\n');

test('AgentOpsEvents Bicep preserves legacy cost type and adds ordered receipt columns', () => {
  const columns = new Map(agentOpsEventsColumnsFromBicep(bicep).map(column => [column.name, column.type]));
  assert.equal(columns.get('Status'), 'string');
  assert.equal(columns.get('EstimatedCostUsd'), 'long');
  assert.equal(columns.get('EstimatedCostUsdReal'), 'real');
  assert.equal(columns.get('EventId'), 'string');
  assert.equal(columns.get('Sequence'), 'long');
  assert.equal(columns.get('AgentId'), 'string');
  assert.equal(columns.get('ParentAgentId'), 'string');
  assert.equal(columns.get('ParentToolCallId'), 'string');
  assert.equal(columns.get('ExitCode'), 'long');
});

test('AgentOpsSpans schema adds precise nanosecond duration without changing millisecond type', () => {
  const spansStart = bicep.indexOf("name: 'AgentOpsSpans_CL'");
  const spansEnd = bicep.indexOf("name: 'AgentOpsToolCalls_CL'", spansStart);
  const spansSchema = bicep.slice(spansStart, spansEnd);
  assert.match(spansSchema, /name: 'DurationMs', type: 'long'/);
  assert.match(spansSchema, /name: 'DurationNs', type: 'long'/);
  for (const name of ['ScriptRuntimeName', 'ScriptRuntimeVersion', 'ScriptRuntimeImplementation', 'ScriptLoaderName']) {
    assert.match(spansSchema, new RegExp(`name: '${name}', type: 'string'`));
    assert.match(bicep, new RegExp(`var spansTransformKql = 'source \\| project .*${name}`));
    assert.match(evalSpansBicep, new RegExp(`transformKql: 'source \\| project .*${name}`));
    assert.match(bicep, new RegExp(`${name}=tostring\\(${name}\\)`));
    assert.match(evalSpansBicep, new RegExp(`${name}=tostring\\(${name}\\)`));
    assert.match(runtimeMigrationBicep, new RegExp(`${name}=tostring\\(${name}\\)`));
  }
  assert.match(bicep, /var spansTransformKql = 'source \| project .*DurationNs/);
  assert.match(bicep, /: table\.stream == 'Custom-AgentOpsSpans_CL' \? spansTransformKql : 'source'/);
  assert.match(evalSpansBicep, /transformKql: 'source \| project .*DurationNs/);
});

test('AgentOpsSpans schema stays in sync across v2-ingestion, eval-spans, and migrate-script-runtime-schema for model/provider/cache columns', () => {
  const spansStart = bicep.indexOf("name: 'AgentOpsSpans_CL'");
  const spansEnd = bicep.indexOf("name: 'AgentOpsToolCalls_CL'", spansStart);
  const spansSchema = bicep.slice(spansStart, spansEnd);
  const columnTypes = {
    ModelRequested: 'string',
    Provider: 'string',
    CacheReadTokens: 'long',
    CacheWriteTokens: 'long'
  };
  for (const [name, type] of Object.entries(columnTypes)) {
    assert.match(spansSchema, new RegExp(`name: '${name}', type: '${type}'`));
    assert.match(evalSpansBicep, new RegExp(`name: '${name}', type: '${type}'`));
    assert.match(bicep, new RegExp(`var spansTransformKql = 'source \\| project .*\\b${name}\\b`));
    assert.match(evalSpansBicep, new RegExp(`transformKql: 'source \\| project .*\\b${name}\\b`));
    assert.match(runtimeMigrationBicep, new RegExp(`var spansTransformKql = 'source \\| project .*\\b${name}\\b`));
  }
});

test('AgentOpsInsights schema accepts additive architecture hypothesis evidence', () => {
  const start = bicep.indexOf("name: 'AgentOpsInsights_CL'");
  const end = bicep.indexOf("name: 'AgentOpsRecommendations_CL'", start);
  const schema = bicep.slice(start, end);
  const expected = {
    Rule: 'string', ArchitectureVersion: 'string', Numerator: 'long',
    Denominator: 'long', CoverageRuns: 'long', Status: 'string',
    ComponentRefs: 'dynamic', Evidence: 'dynamic'
  };
  for (const [name, type] of Object.entries(expected)) {
    assert.match(schema, new RegExp(`name: '${name}', type: '${type}'`));
  }
  assert.match(bicep, /streamDeclarations: toObject\(effectiveTables/);
});

test('v2 Bicep declares each custom table once and spans use the exported outcome column', () => {
  const tableNames = [...bicep.matchAll(/^\s*name: '(AgentOps[A-Za-z0-9]+_CL)'$/gm)].map(match => match[1]);
  assert.equal(tableNames.length, new Set(tableNames).size);
  assert.equal(tableNames.filter(name => name === 'AgentOpsSpans_CL').length, 1);
  const spansStart = bicep.indexOf("name: 'AgentOpsSpans_CL'");
  const spansEnd = bicep.indexOf('\n  {\n    name:', spansStart);
  const spansBlock = bicep.slice(spansStart, spansEnd < 0 ? undefined : spansEnd);
  assert.match(spansBlock, /name: 'Outcome', type: 'string'/);
  assert.match(spansBlock, /name: 'ToolCallEvidence', type: 'string'/);
  assert.doesNotMatch(spansBlock, /name: 'Status', type: 'string'/);
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
  const live = agentOpsEventsColumnsFromBicep(bicep).filter(column => !['EventId', 'Sequence', 'EstimatedCostUsdReal', 'AgentId', 'ParentAgentId', 'ParentToolCallId', 'ExitCode'].includes(column.name));
  const result = validateAgentOpsEventsBicepMigration(bicep, live);
  assert.equal(result.ok, true);
  assert.deepEqual(result.contract_violations, []);
  assert.deepEqual(result.additive_columns.map(column => column.name), ['Sequence', 'EventId', 'AgentId', 'ParentAgentId', 'ParentToolCallId', 'ExitCode', 'EstimatedCostUsdReal']);
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
