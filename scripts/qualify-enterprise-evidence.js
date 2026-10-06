#!/usr/bin/env node
'use strict';
// No Azure writes or model calls. Local preparation is the default.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildProductEvidenceBundle, loadEvidenceSchemas, projectTypedRow, replaySchemaProjection } = require('../agentops-cli/src/lib/product-evidence-bundle');
const { generateDemoData } = require('../agentops-cli/src/lib/demo/agentops-demo-data');
const { projectSessionEvents } = require('../agentops-cli/src/lib/copilot/session-event-export');
const { spanRowsFromOtelSpans } = require('../agentops-cli/src/lib/copilot/session-span-export');
const MAX = 1024 * 1024;
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const HELP = 'Usage: node scripts/qualify-enterprise-evidence.js [prepare|verify] --target=<json> --dcr-file=<json> --out=<new-directory> [--bundle=<directory>]\nprepare: local synthetic producer batch only; verify: explicit read-only Azure queries. No upload command.';
function parseArgs(argv) {
  if (argv.includes('--help')) { if (argv.some(a => a !== '--help')) throw new Error('Use --help alone'); return { help: true }; }
  const options = { mode: 'prepare' };
  if (argv[0] && !argv[0].startsWith('--')) options.mode = argv.shift();
  if (!['prepare', 'verify'].includes(options.mode)) throw new Error('Unknown mode');
  for (const arg of argv) {
    const match = /^--(target|dcr-file|out|bundle)=(.+)$/.exec(arg);
    if (!match || options[match[1]]) throw new Error('Unknown, duplicate or empty option');
    options[match[1]] = match[2];
  }
  if (!options.target || !options.out || (options.mode === 'prepare' && !options['dcr-file']) || (options.mode === 'verify' && !options.bundle)) throw new Error(HELP);
  return options;
}
function readJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX) throw new Error('Input must be a regular file <=1 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function targetContract(target) {
  for (const key of ['subscriptionId', 'workspaceId']) if (!/^[a-f0-9-]{36}$/i.test(target[key] || '')) throw new Error(`Invalid target ${key}`);
  for (const key of ['resourceGroup', 'workspaceName', 'dcrName', 'dcrImmutableId']) if (!/^[A-Za-z0-9_.-]{1,128}$/.test(target[key] || '')) throw new Error(`Invalid target ${key}`);
  if (!/^https:\/\/[a-z0-9.-]+\.ingest\.monitor\.azure\.com\/?$/i.test(target.endpoint || '')) throw new Error('Invalid ingestion endpoint');
  return Object.fromEntries(['subscriptionId', 'resourceGroup', 'workspaceName', 'dcrName', 'dcrImmutableId', 'workspaceId', 'endpoint'].map(k => [k, target[k]]));
}
function assertDcr(dcr, target, schemas) {
  const p = dcr.properties || dcr;
  const resourceId = `/subscriptions/${target.subscriptionId}/resourceGroups/${target.resourceGroup}/providers/Microsoft.Insights/dataCollectionRules/${target.dcrName}`;
  if (String(dcr.id || '').toLowerCase() !== resourceId.toLowerCase() || p.immutableId !== target.dcrImmutableId) throw new Error('DCR target identity mismatch');
  const streams = p.streamDeclarations || {};
  const selected = Object.entries(schemas).filter(([table]) => table !== 'AgentOpsContent_CL');
  for (const [table, schema] of selected) {
    if (canonical(streams[schema.stream]?.columns) !== canonical(schema.columns)) throw new Error(`DCR schema mismatch: ${table}`);
    const flow = (p.dataFlows || []).find(f => f.streams?.includes(schema.stream));
    if (!flow || flow.transformKql !== schema.transform || !flow.outputStream || flow.outputStream !== schema.stream) throw new Error(`DCR transform/output mismatch: ${table}`);
    const destination = (p.destinations?.logAnalytics || []).find(d => flow.destinations?.includes(d.name));
    const workspaceResourceId = `/subscriptions/${target.subscriptionId}/resourceGroups/${target.resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${target.workspaceName}`;
    if (!destination || String(destination.workspaceResourceId).toLowerCase() !== workspaceResourceId.toLowerCase()) throw new Error('DCR workspace destination mismatch');
  }
  return selected;
}
function buildBatch(target, dcr) {
  const schemas = loadEvidenceSchemas();
  const enabled = assertDcr(dcr, target, schemas);
  const batchId = `enterprise-synthetic-${crypto.randomUUID()}`;
  const canaryMarker = `SECRET_FAKE_TEST_VALUE_${crypto.randomUUID()}`;
  const demo = generateDemoData({ runs: 8, withContent: false });
  const ids = new Map();
  const remap = value => {
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
    if (typeof value === 'string' && /^(run_demo_|session_demo_|event_|trace_|span_|insight_)/.test(value)) { if (!ids.has(value)) ids.set(value, `${batchId}-${hash(value).slice(0, 20)}`); return ids.get(value); }
    return value;
  };
  const tables = remap(demo.tables);
  const runId = `${batchId}-native`;
  const time = new Date().toISOString();
  const events = projectSessionEvents([{ type: 'session.start', timestamp: time, data: { prompt: canaryMarker } }, { type: 'session.shutdown', timestamp: time, data: {} }], { runId, sessionId: `${batchId}-session`, referencePaths: new Set() });
  const product = buildProductEvidenceBundle({ runs: [{ runId, sessionId: `${batchId}-session`, events }], architectureRows: [{ TimeGenerated: time, InsightId: `${batchId}-proposal`, RunId: runId, InsightType: 'synthetic-contract-check', Severity: 'low', SuggestedNextStep: 'Review synthetic contract evidence', Evidence: { evidenceIds: [events[0].EventId] } }], target });
  for (const table of ['AgentOpsRunSummary_CL', 'AgentOpsEvents_CL', 'AgentOpsInsights_CL', 'AgentOpsRecommendations_CL']) tables[table].push(...product.tables[table]);
  tables.AgentOpsSpans_CL = spanRowsFromOtelSpans([{ start: Date.parse(time), end: Date.parse(time) + 1, traceId: `${batchId}-trace`, spanId: `${batchId}-span`, operation: 'synthetic-contract-check', outcome: 'unknown' }], `${batchId}-session`, runId);
  for (const health of tables.AgentOpsCollectorHealth_CL) { health.Component = `${batchId}:${health.Component}`; delete health.OtlpEndpoint; }
  const streams = enabled.map(([table, schema]) => {
    const rows = (tables[table] || []).map(row => {
      // Legacy demo cost is fractional; preserve it in the maintained real field.
      if (!Number.isInteger(row.EstimatedCostUsd) && row.EstimatedCostUsd != null) row = { ...row, ...(schema.columns.some(c => c.name === 'EstimatedCostUsdReal') ? { EstimatedCostUsdReal: row.EstimatedCostUsd } : {}), EstimatedCostUsd: null };
      row = { ...row };
      for (const column of schema.columns) if (column.type === 'datetime' && row[column.name] === '') row[column.name] = null;
      return projectTypedRow(table, row, schemas);
    });
    const expected = rows.map(row => replaySchemaProjection(table, row, schemas));
    return { table, stream: schema.stream, producer: table === 'AgentOpsSpans_CL' ? 'spanRowsFromOtelSpans synthetic input' : 'existing demo/product producers synthetic inputs', state: rows.length ? 'synthetic-producer-preview' : 'schema-only-no-produced-rows', rows, expected, rowsSha256: hash(canonical(rows)), expectedSha256: hash(canonical(expected)), accepted: null, observed: null };
  });
  const batch = { version: 1, batchId, preparedAt: new Date().toISOString(), target, schemas, schemaSha256: hash(canonical(schemas)), dcrSha256: hash(canonical(dcr)), evidenceTier: 'synthetic-contract-only', streams, canary: { marker: canaryMarker, injectedInto: 'synthetic native session.start prompt; excluded by actual metadata event producer', expectedAbsent: true }, limitations: ['No live model, GitHub, feature adoption, exhaustive capture or task success qualification', 'Schema-only streams do not qualify a feature', 'API acceptance requires separate uploader receipt; query observation is independent'], accepted: null, observed: null };
  if (Buffer.byteLength(JSON.stringify(batch)) > MAX) throw new Error('Batch exceeds 1 MiB');
  return batch;
}
function parseQueryResult(payload, schema) {
  if (Array.isArray(payload)) { if (payload.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Invalid query rows'); return payload; }
  if (payload.error || payload.partialError || !Array.isArray(payload.tables) || payload.tables.length !== 1) throw new Error('Missing, partial or failed query result');
  const table = payload.tables[0];
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new Error('Invalid query table');
  const names = table.columns.map(c => c.name);
  if (schema && (canonical(names) !== canonical(schema.columns.map(c => c.name)) || table.columns.some((column, index) => column.type !== (schema.columns[index].type === 'boolean' ? 'bool' : schema.columns[index].type)))) throw new Error('Readback API schema types mismatch');
  if (new Set(names).size !== names.length) throw new Error('Duplicate query columns');
  return table.rows.map(values => { if (!Array.isArray(values) || values.length !== names.length) throw new Error('Invalid query row width'); return Object.fromEntries(names.map((name, i) => [name, values[i]])); });
}
function validateBatch(batch, target, manifest) {
  if (canonical(target) !== canonical(batch.target)) throw new Error('Bundle/selected target mismatch');
  if (!/^enterprise-synthetic-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(batch.batchId || '')) throw new Error('Invalid batch namespace');
  if (typeof batch.preparedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(batch.preparedAt) || !Number.isFinite(Date.parse(batch.preparedAt))) throw new Error('Invalid batch timestamp');
  const schemas = loadEvidenceSchemas();
  if (hash(canonical(schemas)) !== batch.schemaSha256 || canonical(schemas) !== canonical(batch.schemas)) throw new Error('Bundle/schema contract mismatch');
  const tables = Object.keys(schemas).filter(table => table !== 'AgentOpsContent_CL').sort();
  if (!Array.isArray(batch.streams) || canonical(batch.streams.map(stream => stream.table).sort()) !== canonical(tables)) throw new Error('Bundle requires the exact unique maintained noncontent stream set');
  if (!manifest || manifest.batchId !== batch.batchId || canonical(manifest.target) !== canonical(target) || !Array.isArray(manifest.streams) || canonical(manifest.streams.map(stream => stream.table).sort()) !== canonical(tables)) throw new Error('Prepared manifest identity or stream set mismatch');
  let produced = 0;
  for (const stream of batch.streams) {
    if (stream.stream !== schemas[stream.table].stream || !Array.isArray(stream.rows) || !Array.isArray(stream.expected)) throw new Error('Invalid stream contract');
    const state = stream.rows.length ? 'synthetic-producer-preview' : 'schema-only-no-produced-rows';
    if (stream.state !== state || stream.expected.length !== stream.rows.length) throw new Error('Stream state/count mismatch');
    if (hash(canonical(stream.rows)) !== stream.rowsSha256 || hash(canonical(stream.expected)) !== stream.expectedSha256) throw new Error('Batch row hash mismatch');
    if (canonical(stream.rows.map(row => replaySchemaProjection(stream.table, row, schemas))) !== canonical(stream.expected)) throw new Error('Unexpected stream projection');
    for (const row of stream.rows) {
      const identity = stream.table === 'AgentOpsCollectorHealth_CL' ? row.Component : row.RunId;
      if (typeof identity !== 'string' || !identity.startsWith(`${batch.batchId}${stream.table === 'AgentOpsCollectorHealth_CL' ? ':' : '-'}`)) throw new Error('Row identity outside prepared batch namespace');
    }
    const { rows, expected, ...metadata } = stream;
    const original = manifest.streams.find(item => item.table === stream.table);
    if (canonical(original) !== canonical({ ...metadata, rowCount: rows.length, file: `${stream.table}.jsonl` })) throw new Error('Prepared manifest stream integrity mismatch');
    produced += rows.length;
  }
  if (!produced) throw new Error('Qualification requires produced rows');
  return schemas;
}
function compareRows(expected, actual, schema) {
  for (const row of actual) {
    if (schema.columns.some(column => !Object.hasOwn(row, column.name))) throw new Error('Readback is missing a projected schema column');
    for (const { name, type } of schema.columns) {
      const value = row[name];
      if (value == null) continue;
      if ((type === 'long' && !Number.isSafeInteger(value)) || (type === 'real' && (typeof value !== 'number' || !Number.isFinite(value))) || (type === 'boolean' && typeof value !== 'boolean') || (type === 'string' && typeof value !== 'string')) throw new Error('Readback field type mismatch');
    }
  }
  const normalize = rows => rows.map(row => Object.fromEntries(schema.columns.map(({ name, type }) => {
    let value = row[name] ?? null;
    if (type === 'string' && value === null) value = '';
    if (type === 'datetime' && value !== null) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid readback datetime'); value = new Date(value).toISOString(); }
    if (type === 'dynamic' && typeof value === 'string') value = JSON.parse(value);
    if (type === 'dynamic' && value === null) value = null;
    return [name, value];
  }))).map(canonical).sort();
  const left = normalize(expected), right = normalize(actual);
  return { ok: canonical(left) === canonical(right), expectedCount: left.length, observedCount: right.length, expectedSha256: hash(canonical(left)), observedSha256: hash(canonical(right)) };
}
function queryFor(stream, batch) {
  const schema = batch.schemas[stream.table];
  const field = schema.columns.some(c => c.name === 'RunId') ? 'RunId' : 'Component';
  const values = [...new Set(stream.expected.map(row => row[field]))];
  if (!values.length || values.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(v))) throw new Error('Unbounded readback identity');
  return `${stream.table} | where TimeGenerated between (datetime(${new Date(Date.parse(batch.preparedAt) - 24 * 3600000).toISOString()}) .. datetime(${new Date(Date.parse(batch.preparedAt) + 24 * 3600000).toISOString()})) | where ${field} in (${values.map(v => `'${v}'`).join(',')}) | project ${schema.columns.map(c => c.name).join(',')} | take ${stream.expected.length + 1}`;
}
function readOnlyQueryArgs(query, target) {
  targetContract(target);
  return ['rest', '--method', 'post', '--subscription', target.subscriptionId, '--url', `https://api.loganalytics.azure.com/v1/workspaces/${target.workspaceId}/query`, '--resource', 'https://api.loganalytics.io', '--body', JSON.stringify({ query, timespan: 'P2D' }), '-o', 'json'];
}
function az(args) {
  const result = spawnSync('az', args, { encoding: 'utf8', maxBuffer: 4 * MAX, timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error('Azure read-only command failed; raw output withheld');
  return JSON.parse(result.stdout);
}
function writeDirectory(out, files) {
  if (fs.existsSync(out)) throw new Error('Output directory must be new');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(out, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
function main(argv = process.argv.slice(2)) {
  const options = parseArgs([...argv]);
  if (options.help) { console.log(HELP); return; }
  const target = targetContract(readJson(options.target));
  if (options.mode === 'prepare') {
    const batch = buildBatch(target, readJson(options['dcr-file']));
    const files = { 'qualification-batch.json': batch, 'manifest.json': { batchId: batch.batchId, target, streams: batch.streams.map(({ rows, expected, ...stream }) => ({ ...stream, rowCount: rows.length, file: `${stream.table}.jsonl` })), evidenceTier: batch.evidenceTier } };
    for (const stream of batch.streams) files[`${stream.table}.jsonl`] = stream.rows.map(row => JSON.stringify(row)).join('\n') + (stream.rows.length ? '\n' : '');
    if (Object.values(files).reduce((n, value) => n + Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)), 0) > MAX) throw new Error('All output artifacts exceed 1 MiB');
    writeDirectory(options.out, files);
    console.log(JSON.stringify({ mode: 'local-preview', batchId: batch.batchId, streams: batch.streams.map(s => ({ table: s.table, rows: s.rows.length, state: s.state })), accepted: null, observed: null }));
    return;
  }
  const batch = readJson(path.join(options.bundle, 'qualification-batch.json'));
  const preparedManifest = readJson(path.join(options.bundle, 'manifest.json'));
  validateBatch(batch, target, preparedManifest);
  const active = az(['account', 'show', '--query', '{id:id}', '-o', 'json']);
  if (String(active.id).toLowerCase() !== target.subscriptionId.toLowerCase()) throw new Error('Active subscription/target mismatch');
  const dcr = az(['monitor', 'data-collection', 'rule', 'show', '--subscription', target.subscriptionId, '-g', target.resourceGroup, '-n', target.dcrName, '-o', 'json']);
  assertDcr(dcr, target, batch.schemas);
  const workspace = az(['monitor', 'log-analytics', 'workspace', 'show', '--subscription', target.subscriptionId, '-g', target.resourceGroup, '-n', target.workspaceName, '-o', 'json']);
  if (workspace.customerId !== target.workspaceId) throw new Error('Workspace identity mismatch');
  const observations = [];
  for (const stream of batch.streams) {
    if (!stream.rows.length) { observations.push({ table: stream.table, status: 'schema-only-not-queried' }); continue; }
    if (hash(canonical(stream.rows)) !== stream.rowsSha256 || hash(canonical(stream.expected)) !== stream.expectedSha256) throw new Error('Batch row hash mismatch');
    const query = queryFor(stream, batch), started = Date.now();
    try {
      const payload = az(readOnlyQueryArgs(query, target));
      const actual = parseQueryResult(payload, batch.schemas[stream.table]);
      const comparison = compareRows(stream.expected, actual, batch.schemas[stream.table]);
      const canaryAbsent = !JSON.stringify(actual).includes(batch.canary.marker) && !JSON.stringify(actual).includes('SECRET_FAKE_TEST_VALUE');
      observations.push({ table: stream.table, query, querySha256: hash(query), responseSha256: hash(canonical(payload)), latencyMs: Date.now() - started, ...comparison, canaryAbsent, status: comparison.ok && canaryAbsent ? 'observed-exact' : 'mismatch-or-absent' });
    } catch {
      observations.push({ table: stream.table, query, querySha256: hash(query), latencyMs: Date.now() - started, expectedCount: stream.expected.length, observedCount: null, ok: false, canaryAbsent: null, status: 'query-or-typed-readback-failed', reason: 'Read-only query or strict response validation failed; raw output withheld' });
    }
  }
  const receipt = { batchId: batch.batchId, target, preparedBatchSha256: hash(canonical(batch)), preparedManifestSha256: hash(canonical(preparedManifest)), preparedStreams: batch.streams.map(({ table, stream, rowsSha256, expectedSha256, state, rows }) => ({ table, stream, rowsSha256, expectedSha256, state, rowCount: rows.length })), verifiedAt: new Date().toISOString(), schemaSha256: batch.schemaSha256, dcrSha256: hash(canonical(dcr)), accepted: null, observed: observations.every(o => ['observed-exact', 'schema-only-not-queried'].includes(o.status)), observations, canaryScope: 'bounded projected qualification rows; not whole-workspace absence', evidenceTier: 'synthetic-contract-query-readback' };
  writeDirectory(options.out, { 'readback-receipt.json': receipt });
  console.log(JSON.stringify(receipt));
  if (!receipt.observed) process.exitCode = 1;
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { parseArgs, targetContract, assertDcr, buildBatch, validateBatch, parseQueryResult, compareRows, queryFor, readOnlyQueryArgs, main };
