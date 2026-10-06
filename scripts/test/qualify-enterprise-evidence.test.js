const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, buildBatch, validateBatch, parseQueryResult, compareRows, queryFor, readOnlyQueryArgs } = require('../qualify-enterprise-evidence');
const { loadEvidenceSchemas } = require('../../agentops-cli/src/lib/product-evidence-bundle');
const target = { subscriptionId: '11111111-1111-1111-1111-111111111111', workspaceId: '22222222-2222-2222-2222-222222222222', endpoint: 'https://synthetic.ingest.monitor.azure.com', resourceGroup: 'synthetic', workspaceName: 'synthetic', dcrName: 'synthetic', dcrImmutableId: 'dcr-synthetic' };
function dcr() {
 const schemas = loadEvidenceSchemas();
 return { id: `/subscriptions/${target.subscriptionId}/resourceGroups/synthetic/providers/Microsoft.Insights/dataCollectionRules/synthetic`, immutableId: target.dcrImmutableId, streamDeclarations: Object.fromEntries(Object.entries(schemas).filter(([t]) => t !== 'AgentOpsContent_CL').map(([,s]) => [s.stream, { columns: s.columns }])), destinations: { logAnalytics: [{ name: 'sink', workspaceResourceId: `/subscriptions/${target.subscriptionId}/resourceGroups/synthetic/providers/Microsoft.OperationalInsights/workspaces/synthetic` }] }, dataFlows: Object.entries(schemas).filter(([t]) => t !== 'AgentOpsContent_CL').map(([,s]) => ({ streams: [s.stream], destinations: ['sink'], outputStream: s.stream, transformKql: s.transform })) };
}
test('help and invalid flags are validated without reading inputs', () => {
 assert.deepEqual(parseArgs(['--help']), { help: true });
 assert.throws(() => parseArgs(['--target=/missing', '--out=/missing', '--upload']), /Unknown/);
});
test('actual synthetic producers yield bounded unique metadata batch and scoped queries', () => {
 const batch = buildBatch(target, dcr());
 assert.equal(batch.streams.length, 11);
 assert.ok(Buffer.byteLength(JSON.stringify(batch)) < 1024 * 1024);
 assert.equal(batch.accepted, null);
 assert.equal(batch.observed, null);
 assert.equal(batch.streams.some(s => s.table === 'AgentOpsContent_CL'), false);
 assert.ok(batch.streams.find(s => s.table === 'AgentOpsRecommendations_CL').rows.length);
 assert.ok(batch.streams.find(s => s.table === 'AgentOpsSpans_CL').rows.length);
 const next = buildBatch(target, dcr());
 assert.notEqual(batch.batchId, next.batchId);
 for (const stream of batch.streams.filter(s => s.rows.length)) {
  const query = queryFor(stream, batch);
  assert.match(query, /where (RunId|Component) in/);
  assert.match(query, /TimeGenerated between/);
  const schema = batch.schemas[stream.table];
  const projectedRows = stream.expected.map(row => Object.fromEntries(schema.columns.map(c => [c.name, row[c.name] ?? null])));
  assert.equal(compareRows(stream.expected, projectedRows, schema).ok, true);
 }
 assert.equal(JSON.stringify(batch.streams).includes(target.endpoint), false);
});
test('query table parser and all-field comparison reject absent, duplicate and changed values', () => {
 const schema = { columns: [{ name: 'RunId', type: 'string' }, { name: 'Number', type: 'long' }, { name: 'When', type: 'datetime' }, { name: 'Evidence', type: 'dynamic' }] };
 const expected = [{ RunId: 'a', Number: 1, When: '2026-10-02T10:00:00Z', Evidence: { b: 1, a: 2 } }];
 const actual = parseQueryResult({ tables: [{ columns: schema.columns, rows: [['a', 1, '2026-10-02T10:00:00.000Z', '{"a":2,"b":1}']] }] });
 assert.equal(compareRows(expected, actual, schema).ok, true);
 assert.equal(compareRows(expected, [], schema).ok, false);
 assert.equal(compareRows(expected, [...actual, ...actual], schema).ok, false);
 assert.throws(() => compareRows(expected, [{ ...actual[0], Number: '1' }], schema), /type mismatch/);
 assert.throws(() => compareRows(expected, [{ RunId: 'a' }], schema), /missing/);
 assert.throws(() => parseQueryResult({ error: {}, tables: [] }), /failed/);
 assert.throws(() => parseQueryResult({ tables: [{ columns: schema.columns, rows: [['a']] }] }), /width/);
});
test('mismatched target and transforms fail closed', () => {
 const mismatch = dcr(); mismatch.immutableId = 'wrong';
 assert.throws(() => buildBatch(target, mismatch), /identity mismatch/);
 const altered = dcr(); altered.dataFlows[0].transformKql = 'source | take 1';
 assert.throws(() => buildBatch(target, altered), /transform/);
});

function manifestFor(batch) {
 return { batchId: batch.batchId, target: batch.target, streams: batch.streams.map(({ rows, expected, ...metadata }) => ({ ...metadata, rowCount: rows.length, file: `${metadata.table}.jsonl` })), evidenceTier: batch.evidenceTier };
}
test('complete prepared batch identity and manifest hashes are checked before any cloud command', () => {
 const batch = buildBatch(target, dcr());
 const manifest = manifestFor(batch);
 assert.doesNotThrow(() => validateBatch(batch, target, manifest));
 for (const streams of [[], batch.streams.slice(1), [...batch.streams.slice(1), batch.streams[1]]]) {
  assert.throws(() => validateBatch({ ...batch, streams }, target, manifest), /exact unique/);
 }
 const changed = structuredClone(batch);
 changed.streams[0].rows[0].RunId = 'outside-batch';
 assert.throws(() => validateBatch(changed, target, manifest), /hash mismatch/);
 const dropped = structuredClone(batch);
 dropped.streams[0].rows = []; dropped.streams[0].expected = [];
 assert.throws(() => validateBatch(dropped, target, manifest), /state\/count mismatch/);
 const changedManifest = structuredClone(manifest); changedManifest.streams[0].rowsSha256 = '0'.repeat(64);
 assert.throws(() => validateBatch(batch, target, changedManifest), /integrity mismatch/);
 const wrongTarget = { ...target, subscriptionId: '33333333-3333-3333-3333-333333333333' };
 assert.throws(() => validateBatch(batch, wrongTarget, manifest), /target mismatch/);
});
test('numeric and boolean datetimes cannot normalize into valid string dates', () => {
 const schema = { columns: [{ name: 'When', type: 'datetime' }] };
 const expected = [{ When: '1970-01-01T00:00:00.000Z' }];
 for (const When of [0, true, false, '1970-01-01', '1970-01-01T00:00:00+00:00']) assert.throws(() => compareRows(expected, [{ When }], schema), /datetime/);
 assert.equal(compareRows(expected, [{ When: '1970-01-01T00:00:00Z' }], schema).ok, true);
});
test('explicit known schema-only streams are valid but an entirely empty batch is rejected', () => {
 const crypto = require('node:crypto');
 const emptyHash = crypto.createHash('sha256').update('[]').digest('hex');
 const batch = buildBatch(target, dcr());
 const zeroStream = stream => ({ ...stream, rows: [], expected: [], rowsSha256: emptyHash, expectedSha256: emptyHash, state: 'schema-only-no-produced-rows' });
 batch.streams[0] = zeroStream(batch.streams[0]);
 assert.doesNotThrow(() => validateBatch(batch, target, manifestFor(batch)));
 batch.streams = batch.streams.map(zeroStream);
 assert.throws(() => validateBatch(batch, target, manifestFor(batch)), /requires produced rows/);
});

test('read-only REST transport preserves API typed values rather than CLI string flattening', () => {
 const schema = { columns: [{ name: 'Number', type: 'long' }, { name: 'Allowed', type: 'boolean' }, { name: 'When', type: 'datetime' }] };
 const expected = [{ Number: null, Allowed: false, When: '2026-10-02T10:00:00Z' }];
 const api = { tables: [{ columns: [{ name: 'Number', type: 'long' }, { name: 'Allowed', type: 'bool' }, { name: 'When', type: 'datetime' }], rows: [[null, false, '2026-10-02T10:00:00Z']] }] };
 assert.equal(compareRows(expected, parseQueryResult(api, schema), schema).ok, true);
 assert.throws(() => compareRows(expected, parseQueryResult([{ Number: 'None', Allowed: 'False', When: '2026-10-02T10:00:00Z' }]), schema), /type mismatch/);
 const changed = structuredClone(api); changed.tables[0].columns[0].type = 'string';
 assert.throws(() => parseQueryResult(changed, schema), /schema types mismatch/);
 const query = 'AgentOpsInsights_CL | take 1';
 const args = readOnlyQueryArgs(query, target);
 assert.equal(args[0], 'rest'); assert.equal(args[args.indexOf('--method') + 1], 'post');
 assert.equal(args[args.indexOf('--resource') + 1], 'https://api.loganalytics.io');
 assert.equal(args[args.indexOf('--subscription') + 1], target.subscriptionId);
 assert.equal(args[args.indexOf('--url') + 1], `https://api.loganalytics.azure.com/v1/workspaces/${target.workspaceId}/query`);
 assert.deepEqual(JSON.parse(args[args.indexOf('--body') + 1]), { query, timespan: 'P2D' });
});
