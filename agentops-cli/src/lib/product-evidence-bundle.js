const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { leakPatterns, logsIngestionUri } = require('./azure/v2-ingest-plan');
const { AGENTOPS_SCHEMA_VERSION } = require('./schema/agentops-attributes');

const LIMITS = Object.freeze({ runs: 1000, events: 10000, references: 100, rowBytes: 65536, bundleBytes: 8 * 1024 * 1024 });
const OUTCOME_TABLES = ['AgentOpsRunSummary_CL', 'AgentOpsEvents_CL', 'AgentOpsEval_CL', 'AgentOpsInsights_CL', 'AgentOpsRecommendations_CL', 'AgentOpsCollectorHealth_CL'];
const { repoRoot: REPO_ROOT } = require('./paths');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function receiptHash(receipt) { return sha256(canonical(receipt)); }
function readBounded(file, maximum = LIMITS.bundleBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Evidence input must be a bounded regular file');
  return fs.readFileSync(file, 'utf8');
}
function columnsFrom(body) {
  const columns = [...body.matchAll(/\{\s*name:\s*'([^']+)'\s*,\s*type:\s*'([^']+)'\s*\}/g)].map(match => ({ name: match[1], type: match[2] }));
  if (!columns.length || new Set(columns.map(column => column.name)).size !== columns.length) throw new Error('Invalid evidence schema columns');
  if (columns.some(column => !['string', 'datetime', 'long', 'real', 'boolean', 'dynamic'].includes(column.type))) throw new Error('Unsupported evidence schema type');
  return columns;
}
// Read the maintained resource definitions (the default, non-metadataOnly path). The content table is isolated and
// deliberately never produced by this metadata-only bundle.
function loadEvidenceSchemas({ v2Source, contentSource } = {}) {
  const source = v2Source ?? fs.readFileSync(path.join(REPO_ROOT, 'infra/bicep/v2-ingestion.bicep'), 'utf8');
  const content = contentSource ?? fs.readFileSync(path.join(REPO_ROOT, 'infra/bicep/eval-content.bicep'), 'utf8');
  if (!/transformKql:\s*(?:metadataOnly\s*\?\s*'source \| project \$\{join\(map\(table\.columns, column => column\.name\), ', '\)\}'\s*:\s*)?table\.stream\s*==\s*'Custom-AgentOpsSpans_CL'\s*\?\s*spansTransformKql\s*:\s*'source'/.test(source) || !/transformKql:\s*'source'/.test(content)) throw new Error('Unsupported ingestion transform selection');
  const schemas = {};
  for (const match of source.matchAll(/name:\s*'(AgentOps\w+_CL)'\s+stream:\s*'([^']+)'\s+columns:\s*\[([\s\S]*?)\]/g)) {
    schemas[match[1]] = { stream: match[2], columns: columnsFrom(match[3]), transform: 'source' };
  }
  const spans = /var spansTransformKql = '([^']+)'/.exec(source);
  if (schemas.AgentOpsSpans_CL && spans) schemas.AgentOpsSpans_CL.transform = spans[1];
  const contentColumns = /var columns = \[([\s\S]*?)\]/.exec(content);
  if (contentColumns) schemas.AgentOpsContent_CL = { stream: 'Custom-AgentOpsContent_CL', columns: columnsFrom(contentColumns[1]), transform: 'source' };
  if (Object.keys(schemas).length !== 12) throw new Error('Expected the 12 maintained ingestion table contracts');
  for (const table of OUTCOME_TABLES) if (!schemas[table]) throw new Error(`Missing schema ${table}`);
  return schemas;
}
function validType(value, type) {
  if (value === null) return true;
  if (type === 'string') return typeof value === 'string';
  if (type === 'long') return Number.isSafeInteger(value);
  if (type === 'real') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'datetime') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  if (type === 'dynamic') return typeof value === 'object' && value !== null;
  return false;
}
function assertMetadata(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > LIMITS.rowBytes) throw new Error('Evidence row exceeds size bound');
  if (leakPatterns.some(pattern => pattern.test(text))) throw new Error('Evidence privacy scan rejected content or secret-like metadata');
  const walk = item => {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (/^(prompt|response|toolarguments|toolresult|filecontent|sourcecode|secretvalue|content|arguments|output)$/i.test(key)) throw new Error('Evidence contains a raw content field');
      if (typeof child === 'string' && child.length > 2048) throw new Error('Evidence string exceeds metadata bound');
      walk(child);
    }
  };
  walk(value);
}
function projectTypedRow(table, source, schemas) {
  const schema = schemas[table];
  if (!schema) throw new Error(`Unknown evidence table ${table}`);
  const row = {};
  for (const { name, type } of schema.columns) {
    if (!Object.hasOwn(source, name) || source[name] === undefined) continue;
    if (!validType(source[name], type)) throw new Error(`${table}.${name} must match Azure ${type}`);
    row[name] = source[name];
  }
  assertMetadata(row);
  return row;
}
// This is a narrow replay of the deployed projection, not an Azure/KQL engine.
// Unknown transform syntax fails closed rather than approximating its result.
function replaySchemaProjection(table, row, schemas) {
  const schema = schemas[table];
  const typed = projectTypedRow(table, row, schemas);
  if (Object.keys(row).some(key => !schema.columns.some(column => column.name === key))) throw new Error(`${table} contains a field absent from its deployed schema`);
  if (schema.transform === 'source') return typed;
  const match = /^source \| project (.+)$/.exec(schema.transform);
  if (!match) throw new Error('Unsupported ingestion transform');
  const projected = {};
  for (const expression of match[1].split(',').map(part => part.trim())) {
    const cast = /^(\w+)=tostring\((\w+)\)$/.exec(expression);
    if (cast) projected[cast[1]] = typed[cast[2]] == null ? '' : String(typed[cast[2]]);
    else if (/^\w+$/.test(expression)) projected[expression] = typed[expression] ?? null;
    else throw new Error('Unsupported ingestion projection expression');
  }
  return projectTypedRow(table, projected, schemas);
}
function refs(values, eventIds) {
  if (!Array.isArray(values) || !values.length || values.length > LIMITS.references) return null;
  const unique = [...new Set(values)];
  if (unique.some(id => typeof id !== 'string' || !eventIds.has(id))) return null;
  return unique.sort();
}
function targetIdentity(target = {}) {
  const identity = { endpoint: target.endpoint || null, dcrImmutableId: target.dcrImmutableId || null, workspaceId: target.workspaceId || null };
  if (identity.endpoint && !/^https:\/\/[a-z0-9.-]+\.ingest\.monitor\.azure\.(com|us|cn)\/?$/i.test(identity.endpoint)) throw new Error('Evidence target must be an Azure Logs Ingestion endpoint without credentials');
  for (const key of ['dcrImmutableId', 'workspaceId']) if (identity[key] && !/^[A-Za-z0-9-]{1,128}$/.test(identity[key])) throw new Error('Invalid evidence target identity');
  return identity;
}
function buildProductEvidenceBundle({ runs = [], evaluations = [], evaluationVerifier, architectureRows = [], healthRows = [], target = {}, schemaSources } = {}) {
  if (!Array.isArray(runs) || !runs.length || runs.length > LIMITS.runs) throw new Error('Evidence requires bounded run ledger rows');
  const schemas = loadEvidenceSchemas(schemaSources);
  const tables = Object.fromEntries(OUTCOME_TABLES.map(table => [table, []]));
  const limits = [];
  const receiptEvidence = [];
  const knownRuns = new Map();
  const eventRows = new Map();
  let eventCount = 0;
  for (const run of runs) {
    if (!run || typeof run.runId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(run.runId) || !Array.isArray(run.events)) throw new Error('Malformed evidence run ledger');
    if (knownRuns.has(run.runId)) throw new Error('Duplicate evidence run ID');
    knownRuns.set(run.runId, run);
    for (const event of run.events) {
      if (++eventCount > LIMITS.events) throw new Error('Evidence event count exceeds bound');
      if (typeof event.EventId !== 'string' || !event.EventId || event.EventId.length > 200) throw new Error('Every evidence event requires a bounded EventId');
      if (event.RunId && event.RunId !== run.runId) throw new Error('Evidence event RunId does not match ledger');
      if (event.SessionId && run.sessionId && event.SessionId !== run.sessionId) throw new Error('Evidence event SessionId does not match ledger');
      const row = projectTypedRow('AgentOpsEvents_CL', { ...event, RunId: run.runId, SessionId: event.SessionId ?? run.sessionId ?? null, SchemaVersion: AGENTOPS_SCHEMA_VERSION }, schemas);
      if (!row.TimeGenerated || !row.EventName) throw new Error('Evidence event requires timestamp and event name');
      if (eventRows.has(event.EventId)) {
        if (canonical(eventRows.get(event.EventId)) !== canonical(row)) throw new Error('Conflicting duplicate evidence event ID');
        continue;
      }
      eventRows.set(event.EventId, row);
      tables.AgentOpsEvents_CL.push(row);
    }
  }
  tables.AgentOpsEvents_CL.sort((a, b) => a.RunId.localeCompare(b.RunId) || (a.Sequence ?? 0) - (b.Sequence ?? 0) || a.EventId.localeCompare(b.EventId));
  const evaluationByRun = new Map();
  if (!Array.isArray(evaluations) || evaluations.length > LIMITS.runs) throw new Error('Evaluation receipt count exceeds bound');
  for (const receipt of evaluations) {
    const run = knownRuns.get(receipt?.runId);
    if (!run || evaluationByRun.has(receipt.runId)) throw new Error('Evaluation requires a unique matching run');
    const hash = receiptHash(receipt);
    const identityComplete = ['taskId', 'taskHash', 'datasetHash', 'graderHash'].every(key => typeof receipt[key] === 'string' && receipt[key])
      && receipt.taskId === (run.taskId || run.taskContract?.taskId)
      && ['taskHash', 'datasetHash', 'graderHash'].every(key => /^[a-f0-9]{64}$/.test(receipt[key]));
    const sourceRefs = refs(receipt.sourceEventRefs, new Set(run.events.map(event => event.EventId)));
    const verification = identityComplete && typeof evaluationVerifier === 'function' ? evaluationVerifier(receipt, run) : null;
    if (verification && typeof verification.then === 'function') throw new Error('Evidence verifier must be synchronous');
    const verified = verification?.verified === true && verification.receiptSha256 === hash && ['success', 'failed'].includes(verification.status)
      && typeof verification.passed === 'boolean' && verification.passed === (verification.status === 'success');
    const artifacts = receipt.sourceArtifacts || [];
    if (!Array.isArray(artifacts) || artifacts.length > LIMITS.references) throw new Error('Evaluation source artifact references exceed bound');
    const sourceArtifacts = artifacts.map(artifact => {
      if (!['sink', 'dataset', 'vally-result'].includes(artifact.role) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) throw new Error('Invalid evaluation source artifact metadata');
      return { role: artifact.role, sha256: artifact.sha256, bytes: artifact.bytes };
    });
    const receiptMetadata = { runId: run.runId, receiptSha256: hash, state: verified ? 'locally-regraded' : 'asserted-unverified', taskId: receipt.taskId || null,
      taskHash: receipt.taskHash || null, datasetHash: receipt.datasetHash || null, graderHash: receipt.graderHash || null, sourceArtifacts,
      model: { requested: receipt.model?.requested ?? null, observed: receipt.model?.observed ?? null }, sourceEventRefs: sourceRefs,
      evidenceTier: verified ? verification.evidenceTier || 'local-sink-grade' : 'asserted', independentlyVerifiedExecution: false, delivered: null };
    assertMetadata(receiptMetadata);
    receiptEvidence.push(receiptMetadata);
    if (!verified) limits.push({ runId: run.runId, code: 'evaluation_receipt_not_locally_verified' });
    if (!sourceRefs) limits.push({ runId: run.runId, code: 'evaluation_has_no_joined_event_refs' });
    evaluationByRun.set(run.runId, { receipt, verification, verified });
  }
  for (const run of [...runs].sort((a, b) => a.runId.localeCompare(b.runId))) {
    const events = tables.AgentOpsEvents_CL.filter(event => event.RunId === run.runId);
    const time = events.map(event => event.TimeGenerated).sort().at(-1) || run.createdAt;
    if (!validType(time, 'datetime')) throw new Error('Evidence run requires a valid recorded timestamp');
    const evaluation = evaluationByRun.get(run.runId);
    const measured = run.summary || {};
    const row = { TimeGenerated: time, RunId: run.runId, SessionId: run.sessionId || null, TraceId: measured.TraceId ?? null,
      OutcomeStatus: evaluation?.verified ? evaluation.verification.status : null,
      OutcomeReason: evaluation?.verified ? (evaluation.verification.evidenceTier === 'fixture-synthetic-sink-grade' ? 'fixture_synthetic_sink_grade' : evaluation.verification.evidenceTier === 'reported-synthetic-sink-grade' ? 'reported_synthetic_sink_grade' : 'locally_regraded_sink_receipt') : null,
      TestsRan: null, TestsPassed: null, InputTokens: null, OutputTokens: null, EstimatedCostUsd: null, EstimatedCostUsdReal: null,
      ModelRequested: null, ModelActual: null, DurationMs: null, ToolCount: null, ToolFailureCount: null, ToolDeniedCount: null,
      PrOpened: null, CiStatus: null, PrivacyMode: 'strict', ContentCaptureMode: 'off', ContentCaptureSignal: null, SchemaVersion: AGENTOPS_SCHEMA_VERSION };
    // Only explicit run totals are copied. Per-event usage/durations may overlap;
    // process completion, tests requested, and collector ACKs do not grade tasks.
    for (const key of ['InputTokens', 'OutputTokens', 'ReasoningTokens', 'CacheReadTokens', 'CacheCreationTokens', 'DurationMs', 'ToolCount', 'ToolFailureCount', 'ToolDeniedCount', 'EstimatedCostUsdReal', 'ModelRequested', 'ModelActual', 'AgentName', 'RepoHash', 'BranchHash', 'Surface', 'TaskType']) {
      if (Object.hasOwn(measured, key)) row[key] = measured[key];
    }
    tables.AgentOpsRunSummary_CL.push(projectTypedRow('AgentOpsRunSummary_CL', row, schemas));
    if (!evaluation) limits.push({ runId: run.runId, code: 'missing_evaluation_receipt' });
    // No recorder adapter currently proves exhaustive capture. Complete labels,
    // counts and snapshots in context JSON are assertions, including fixtures.
    // Keep the export limitation even when those assertions agree; the bundle
    // qualifies observed rows and sink grades, never absence of missing events.
    limits.push({ runId: run.runId, code: 'capture_partial_or_unknown',
      source: run.evidenceOrigin === 'recorded-run' || run.preRunSnapshot || run.sourceIntegrity ? 'recorded-run' : 'legacy-or-supplied-ledger',
      exhaustiveCaptureVerified: false });
    if (evaluation?.verified) {
      const scores = evaluation.verification.scores || {};
      const evalRow = { TimeGenerated: time, RunId: run.runId, TraceId: row.TraceId, EvalOverall: null, EvalBucket: null, SchemaVersion: AGENTOPS_SCHEMA_VERSION };
      for (const key of ['EvalOverall', 'Reliability', 'Security', 'TestDiscipline', 'ToolEfficiency', 'ContextEfficiency', 'CodeOutcome']) if (Object.hasOwn(scores, key)) evalRow[key] = scores[key];
      tables.AgentOpsEval_CL.push(projectTypedRow('AgentOpsEval_CL', evalRow, schemas));
    }
  }
  if (!Array.isArray(architectureRows) || architectureRows.length > LIMITS.references) throw new Error('Architecture findings exceed bound');
  const insightIds = new Map();
  for (const source of architectureRows) {
    const sourceRun = knownRuns.get(source.RunId);
    const sourceRefs = refs(source.Evidence?.evidenceIds, new Set((sourceRun?.events || []).map(event => event.EventId)));
    if (!knownRuns.has(source.RunId) || !sourceRefs) { limits.push({ code: 'architecture_finding_without_joined_evidence' }); continue; }
    const insight = projectTypedRow('AgentOpsInsights_CL', { ...source, Evidence: { evidenceIds: sourceRefs, coverageLimits: 'Local ledger observations only; capture and outcome coverage may be partial.' }, SchemaVersion: AGENTOPS_SCHEMA_VERSION }, schemas);
    if (!insight.InsightId || !insight.TimeGenerated || !insight.InsightType || !insight.Severity || !insight.SuggestedNextStep) throw new Error('Architecture finding requires ID, timestamp, type, severity and proposal');
    if (insightIds.has(insight.InsightId)) {
      if (insightIds.get(insight.InsightId) !== canonical(insight)) throw new Error('Conflicting duplicate insight ID');
      continue;
    }
    insightIds.set(insight.InsightId, canonical(insight));
    tables.AgentOpsInsights_CL.push(insight);
    tables.AgentOpsRecommendations_CL.push(projectTypedRow('AgentOpsRecommendations_CL', {
      TimeGenerated: insight.TimeGenerated, RunId: insight.RunId, RecommendationId: `proposal-${sha256(canonical(insight)).slice(0, 24)}`,
      Action: 'propose-review', Severity: insight.Severity, ObservedPattern: insight.InsightType, NextAction: insight.SuggestedNextStep,
      Validation: [{ status: 'proposal-only', sourceEventRefs: sourceRefs, evidenceLimits: 'No change applied or improvement proven; local capture may be partial.' }],
      ChangeTargetRefs: insight.ComponentRefs || [], DashboardTitles: [], DashboardCount: 0, BeforeTelemetry: {}, AfterTelemetry: {}, ObservedMetricMovement: {},
      EvalOverall: null, EvalBucket: null, SchemaVersion: AGENTOPS_SCHEMA_VERSION
    }, schemas));
  }
  if (!Array.isArray(healthRows) || healthRows.length > LIMITS.references) throw new Error('Health receipt count exceeds bound');
  for (const health of healthRows) {
    if (!health.TimeGenerated || !health.Component || !health.Status) throw new Error('Health receipt requires timestamp, component and status');
    tables.AgentOpsCollectorHealth_CL.push(projectTypedRow('AgentOpsCollectorHealth_CL', { ...health, SchemaVersion: AGENTOPS_SCHEMA_VERSION }, schemas));
  }
  const targetBound = targetIdentity(target);
  if (!targetBound.endpoint || !targetBound.dcrImmutableId || !targetBound.workspaceId) limits.push({ code: 'target_identity_unbound_no_delivery_possible' });
  const streams = [];
  let totalBytes = 0;
  for (const table of OUTCOME_TABLES) {
    for (const row of tables[table]) {
      const projected = replaySchemaProjection(table, row, schemas);
      if (canonical(projected) !== canonical(row)) throw new Error(`Ingestion transform changes outcome evidence in ${table}`);
    }
    const jsonl = tables[table].map(row => JSON.stringify(row)).join('\n') + (tables[table].length ? '\n' : '');
    totalBytes += Buffer.byteLength(jsonl);
    streams.push({ table, stream: schemas[table].stream, rows: tables[table].length, bytes: Buffer.byteLength(jsonl), sha256: sha256(jsonl), target: targetBound,
      uri: targetBound.endpoint && targetBound.dcrImmutableId ? logsIngestionUri(targetBound.endpoint, targetBound.dcrImmutableId, schemas[table].stream) : null,
      state: 'preview-only', accepted: null, delivered: null });
  }
  if (totalBytes > LIMITS.bundleBytes) throw new Error('Evidence bundle exceeds size bound');
  const manifest = { schemaVersion: 'agentops.product-evidence.v1', mode: 'local-preview-only', evidenceTier: 'local-ledger-derived', target: targetBound,
    targetBound: Boolean(targetBound.endpoint && targetBound.dcrImmutableId && targetBound.workspaceId), schemaSha256: sha256(canonical(schemas)), streams, evaluationReceipts: receiptEvidence, evidenceLimits: limits, accepted: null, delivered: null };
  assertMetadata({ schemaVersion: manifest.schemaVersion, target: manifest.target });
  if (totalBytes + Buffer.byteLength(JSON.stringify(manifest)) > LIMITS.bundleBytes) throw new Error('Evidence bundle and manifest exceed size bound');
  return { ok: true, manifest, tables };
}
function writeProductEvidenceBundle(bundle, outDir) {
  const directory = path.resolve(outDir);
  if (fs.existsSync(directory)) throw new Error('Evidence output directory must be new');
  // Validate every stream before creating output so mutation leaves no partial
  // evidence directory that could be mistaken for a qualified bundle.
  for (const stream of bundle.manifest.streams) {
    const rows = bundle.tables[stream.table];
    const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    if (rows.length !== stream.rows || sha256(jsonl) !== stream.sha256) throw new Error('Evidence bundle changed after qualification');
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = {};
  for (const stream of bundle.manifest.streams) {
    const jsonl = bundle.tables[stream.table].map(row => JSON.stringify(row)).join('\n') + (stream.rows ? '\n' : '');
    if (sha256(jsonl) !== stream.sha256) throw new Error('Evidence bundle changed after qualification');
    const file = path.join(directory, `${stream.table}.jsonl`);
    fs.writeFileSync(file, jsonl, { mode: 0o600, flag: 'wx' });
    files[stream.table] = file;
  }
  const manifestFile = path.join(directory, 'product-evidence-manifest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(bundle.manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { directory, files, manifestFile };
}
function productEvidenceFromLedger({ ledgerDir, evaluationFile, outDir, target, evaluationVerifier, evaluationKeyFile, evaluationRecordsFile, evaluationWorkspaceRoot, architectureRows = [], healthRows = [] } = {}) {
  const directory = path.resolve(ledgerDir);
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Evidence ledger must be a real directory');
  const runs = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_.:-]{1,128}$/.test(entry.name)) continue;
    const runDir = path.join(directory, entry.name);
    const contextFile = ['run-context.json', 'context.json'].map(name => path.join(runDir, name)).find(file => fs.existsSync(file));
    const eventsFile = ['AgentOpsEvents_CL.jsonl', 'events.jsonl'].map(name => path.join(runDir, name)).find(file => fs.existsSync(file));
    if (!contextFile || !eventsFile) throw new Error('Incomplete evidence run directory');
    const context = JSON.parse(readBounded(contextFile));
    if (context.runId && context.runId !== entry.name) throw new Error('Evidence context RunId differs from directory');
    const events = readBounded(eventsFile).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    const evidenceOrigin = path.basename(contextFile) === 'run-context.json' || path.basename(eventsFile) === 'AgentOpsEvents_CL.jsonl' ? 'recorded-run' : 'legacy-fixture';
    runs.push({ ...context, evidenceOrigin, runId: entry.name, events });
    if (runs.length > LIMITS.runs) throw new Error('Evidence run count exceeds bound');
  }
  const evaluationPayload = evaluationFile ? JSON.parse(readBounded(evaluationFile)) : [];
  const evaluations = Array.isArray(evaluationPayload) ? evaluationPayload : evaluationPayload.receipts || evaluationPayload.rows || [evaluationPayload];
  const replayOptions = [evaluationKeyFile, evaluationRecordsFile, evaluationWorkspaceRoot];
  if (replayOptions.some(Boolean)) {
    if (!replayOptions.every(Boolean)) throw new Error('Evaluation replay requires key, records and approved workspace root');
    if (evaluationVerifier) throw new Error('Choose one evaluation verifier');
    const { verifyHeldoutReceipt } = require(path.join(REPO_ROOT, 'evals/stockpilot/scripts/heldout'));
    evaluationVerifier = receipt => {
      const replay = verifyHeldoutReceipt(receipt, { keyFile: evaluationKeyFile, recordsFile: evaluationRecordsFile, workspaceRoot: evaluationWorkspaceRoot });
      return { ...replay, receiptSha256: receiptHash(receipt), passed: replay.replay?.passed };
    };
  }
  const bundle = buildProductEvidenceBundle({ runs, evaluations, target, evaluationVerifier, architectureRows, healthRows });
  return outDir ? { ...bundle, written: writeProductEvidenceBundle(bundle, outDir) } : bundle;
}
module.exports = { LIMITS, OUTCOME_TABLES, buildProductEvidenceBundle, loadEvidenceSchemas, productEvidenceFromLedger, projectTypedRow, receiptHash, replaySchemaProjection, writeProductEvidenceBundle };
