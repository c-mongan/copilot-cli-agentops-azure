const assert = require('node:assert/strict');
const test = require('node:test');
const {
  compareColumns,
  durableReceiptSchema,
  validateDurableReceiptAzureSchema
} = require('../src/lib/azure/durable-receipt-schema-guard');

const columns = Object.entries(durableReceiptSchema).map(([name, type]) => ({ name, type }));

test('durable receipt schema comparator reports missing and mistyped contract columns', () => {
  const result = compareColumns([
    { name: 'EventId', type: 'string' },
    { name: 'Sequence', type: 'string' }
  ], { EventId: 'string', Sequence: 'long', EstimatedCostUsd: 'long', EstimatedCostUsdReal: 'real' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.drift, [
    { column: 'Sequence', expected: 'long', actual: 'string', issue: 'type_mismatch' },
    { column: 'EstimatedCostUsd', expected: 'long', actual: null, issue: 'missing' },
    { column: 'EstimatedCostUsdReal', expected: 'real', actual: null, issue: 'missing' }
  ]);
});

test('live durable receipt guard uses read-only table show and DCR list operations', () => {
  const calls = [];
  const result = validateDurableReceiptAzureSchema({
    resourceGroup: 'rg-agentops-dev',
    workspaceName: 'law-agentops-dev',
    dcrImmutableId: 'dcr-immutable',
    runAz(args) {
      calls.push(args);
      if (args.includes('table')) {
        return { status: 0, stdout: JSON.stringify({ properties: { schema: { columns } } }), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify([{ name: 'dcr-agentops', properties: {
        immutableId: 'dcr-immutable',
        streamDeclarations: { 'Custom-AgentOpsEvents_CL': { columns } }
      } }]), stderr: '' };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.dcr_name, 'dcr-agentops');
  assert.deepEqual(calls[0].slice(0, 5), ['monitor', 'log-analytics', 'workspace', 'table', 'show']);
  assert.deepEqual(calls[1].slice(0, 4), ['monitor', 'data-collection', 'rule', 'list']);
  assert.equal(calls.some(args => args.includes('create') || args.includes('update') || args.includes('delete')), false);
});

test('live durable receipt guard fails when table and DCR types drift independently', () => {
  let call = 0;
  const result = validateDurableReceiptAzureSchema({
    resourceGroup: 'rg-agentops-dev',
    workspaceName: 'law-agentops-dev',
    dcrImmutableId: 'dcr-immutable',
    runAz() {
      call += 1;
      if (call === 1) return { status: 0, stdout: JSON.stringify({ schema: { columns: columns.map(column => column.name === 'Sequence' ? { ...column, type: 'string' } : column) } }) };
      return { status: 0, stdout: JSON.stringify([{ properties: {
        immutableId: 'dcr-immutable',
        streamDeclarations: { 'Custom-AgentOpsEvents_CL': { columns: columns.filter(column => column.name !== 'EventId') } }
      } }]) };
    }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.table.drift, [{ column: 'Sequence', expected: 'long', actual: 'string', issue: 'type_mismatch' }]);
  assert.deepEqual(result.dcr.drift, [{ column: 'EventId', expected: 'string', actual: null, issue: 'missing' }]);
});

test('live durable receipt guard skips without complete non-secret destination config', () => {
  let called = false;
  const result = validateDurableReceiptAzureSchema({ runAz() { called = true; } });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});
