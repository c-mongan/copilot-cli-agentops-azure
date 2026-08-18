const fs = require('node:fs');
const path = require('node:path');

const { tableNames } = require('../demo/agentops-demo-data');
const {
  renderAzureIngestPlan,
  renderLogsIngestionUploadPlan,
  renderSharedStorageUploadPlan
} = require('./v2-ingest-render');
const {
  schemaMigrationPolicy,
  schemaMigrationSummary,
  schemaVersionFor,
  schemaVersioningSummary
} = require('./v2-schema-versioning');

const requiredColumns = {
  AgentOpsRunSummary_CL: ['TimeGenerated', 'RunId', 'SessionId', 'TraceId', 'OutcomeStatus'],
  AgentOpsEvents_CL: ['TimeGenerated', 'RunId', 'SessionId', 'EventName'],
  AgentOpsToolCalls_CL: ['RunId', 'ToolName', 'Status'],
  AgentOpsMcpCalls_CL: ['RunId', 'McpServerHash', 'ToolName', 'ToolRisk'],
  AgentOpsPrivacy_CL: ['RunId', 'ContentKind', 'Action', 'DroppedCount'],
  AgentOpsEval_CL: ['RunId', 'EvalOverall', 'EvalBucket'],
  AgentOpsGithubOutcomes_CL: ['RunId', 'RepoHash', 'PrOpened', 'CiStatus'],
  AgentOpsInsights_CL: ['InsightType', 'Severity', 'RunId', 'SuggestedNextStep'],
  AgentOpsRecommendations_CL: ['TimeGenerated', 'RecommendationId', 'Action', 'Severity', 'ObservedPattern', 'NextAction'],
  AgentOpsSavedViews_CL: ['TimeGenerated', 'SavedViewId', 'Name', 'Url', 'QueryHash'],
  AgentOpsAlertHandoffs: ['schema_version', 'alert', 'status'],
  AgentOpsCollectorHealth_CL: ['Component', 'Status', 'SchemaVersion'],
  AgentOpsContent_CL: ['TimeGenerated', 'RunId', 'SessionId', 'TraceId', 'Role', 'ContentKind', 'CaptureMode']
};

const optionalEmptyTables = new Set([
  'AgentOpsToolCalls_CL',
  'AgentOpsMcpCalls_CL',
  'AgentOpsPrivacy_CL',
  'AgentOpsEval_CL',
  'AgentOpsGithubOutcomes_CL',
  'AgentOpsInsights_CL',
  'AgentOpsRecommendations_CL',
  'AgentOpsSavedViews_CL',
  'AgentOpsCollectorHealth_CL',
  'AgentOpsContent_CL'
]);

const logsIngestionResource = 'https://monitor.azure.com/';

const leakPatterns = [
  /SECRET_FAKE_TEST_VALUE/i,
  /api_key\s*=/i,
  /this should never leave local machine/i,
  /cat ~\/\.ssh\/id_rsa/i,
  /gen_ai\.input\.messages/i,
  /gen_ai\.output\.messages/i,
  /gen_ai\.system_instructions/i,
  /gen_ai\.tool\.definitions/i,
  /prompt\s*=/i,
  /tool_args\s*=/i,
  /file_content\s*=/i
];

const secretLeakPatterns = [
  /SECRET_FAKE_TEST_VALUE/i,
  /api_key\s*=/i,
  /cat ~\/\.ssh\/id_rsa/i
];

function readJsonl(file) {
  if (!fs.existsSync(file)) return { rows: [], parseErrors: [`missing file: ${file}`] };
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  const parseErrors = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push(`${file}:${index + 1}: ${error.message}`);
    }
  });
  return { rows, parseErrors, text };
}

function columnsFor(rows) {
  const columns = new Set();
  for (const row of rows) {
    for (const column of Object.keys(row || {})) columns.add(column);
  }
  return [...columns].sort();
}

function isIsoDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function inferAzureColumnType(values) {
  const sample = values.find(value => value !== null && value !== undefined && value !== '');
  if (sample === undefined) return 'string';
  if (sample instanceof Date || isIsoDateString(sample)) return 'datetime';
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'number') return Number.isInteger(sample) ? 'long' : 'real';
  if (Array.isArray(sample) || typeof sample === 'object') return 'dynamic';
  return 'string';
}

function columnTypesFor(rows, columns) {
  return Object.fromEntries(columns.map(column => [
    column,
    inferAzureColumnType(rows.map(row => row?.[column]))
  ]));
}

function streamNameFor(table) {
  return `Custom-${table}`;
}

function scanForLeaks(table, text, options = {}) {
  if (!text) return [];
  const patterns = table === 'AgentOpsContent_CL' && options.allowContent ? secretLeakPatterns : leakPatterns;
  return patterns
    .filter(pattern => pattern.test(text))
    .map(pattern => ({ table, pattern: pattern.source }));
}

function validateTable(table, dir, options = {}) {
  const file = path.join(dir, `${table}.jsonl`);
  const { rows, parseErrors, text } = readJsonl(file);
  const columns = columnsFor(rows);
  const columnTypes = columnTypesFor(rows, columns);
  const errors = [...parseErrors];
  const warnings = [];
  const required = requiredColumns[table] || [];
  const schemaVersion = schemaVersionFor(table, rows);

  if (!(rows.length === 0 && optionalEmptyTables.has(table))) {
    for (const column of required) {
      if (!columns.includes(column)) errors.push(`${table}: missing required column ${column}`);
    }
  }
  if (rows.length === 0) warnings.push(`${table}: no rows yet; dashboards will show empty-state guidance for this table`);
  if (schemaVersion.checked && schemaVersion.missing_rows > 0) {
    warnings.push(`${table}: ${schemaVersion.missing_rows} row(s) missing SchemaVersion; dashboards will flag schema coverage`);
  }
  if (schemaVersion.checked && schemaVersion.mismatched_versions.length > 0) {
    warnings.push(`${table}: schema version mismatch ${schemaVersion.mismatched_versions.join(', ')}; expected ${schemaVersion.expected}`);
  }
  for (const action of schemaVersion.migration.actions) warnings.push(`${table}: ${action}`);

  return {
    file,
    rows: rows.length,
    columns,
    columnTypes,
    streamName: streamNameFor(table),
    required_columns: required,
    schema_version: schemaVersion,
    warnings,
    errors,
    leaks: scanForLeaks(table, text, options)
  };
}

function buildAzureIngestPlan({ dir, allowContent = false } = {}) {
  const absoluteDir = path.resolve(dir);
  const errors = [];
  const warnings = [];
  const tables = {};
  const leaks = [];

  for (const table of tableNames) {
    const result = validateTable(table, absoluteDir, { allowContent });
    tables[table] = {
      file: result.file,
      rows: result.rows,
      columns: result.columns,
      column_types: result.columnTypes,
      stream_name: result.streamName,
      required_columns: result.required_columns,
      schema_version: result.schema_version
    };
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    leaks.push(...result.leaks);
  }

  if (leaks.length > 0) {
    errors.push(`privacy scan found ${leaks.length} content-like or secret-like match(es)`);
  }

  const contentRows = tables.AgentOpsContent_CL?.rows || 0;
  if (contentRows > 0 && !allowContent) {
    errors.push('AgentOpsContent_CL has rows; rerun with --allow-content only for an explicitly approved content-capture workspace');
  }

  const requiredRows = ['AgentOpsRunSummary_CL', 'AgentOpsEvents_CL'];
  for (const table of requiredRows) {
    if ((tables[table]?.rows || 0) === 0) errors.push(`${table}: required table has no rows`);
  }

  const schemaMigration = schemaMigrationSummary(tables);
  for (const table of schemaMigration.unsupported_tables) {
    errors.push(`${table.table}: unsupported newer schema version(s) ${table.versions.join(', ')}; ${schemaMigrationPolicy.unsupported_newer_version_action}`);
  }

  return {
    ok: errors.length === 0,
    dir: absoluteDir,
    tables,
    warnings,
    errors,
    privacy: {
      ok: leaks.length === 0 && (contentRows === 0 || allowContent),
      leaks
    },
    content_capture: {
      allowed: allowContent,
      rows: contentRows,
      warning: contentRows > 0 ? 'Content rows may include prompts or responses. Use a separate restricted workspace/dashboard for shared environments.' : ''
    },
    schema_versioning: schemaVersioningSummary(tables),
    schema_migration_policy: schemaMigration,
    azure: {
      workspace: '<log-analytics-workspace>',
      table_suffix: '_CL',
      ingestion_path: 'Azure Monitor Logs Ingestion API with a Data Collection Rule and one stream per AgentOps table',
      streams: Object.fromEntries(Object.keys(tables).map(table => [table, tables[table].stream_name])),
      grafana_folder: 'AgentOps for Azure'
    },
    next: [
      'agentops dashboard validate',
      'agentops dashboard links-check',
      'agentops validate-azure --last 24h',
      'agentops open'
    ]
  };
}

function normalizeLogsEndpoint(endpoint) {
  return String(endpoint || '').trim().replace(/\/+$/g, '');
}

function logsIngestionUri(endpoint, dcrImmutableId, stream, apiVersion = '2023-01-01') {
  return `${normalizeLogsEndpoint(endpoint)}/dataCollectionRules/${encodeURIComponent(dcrImmutableId)}/streams/${encodeURIComponent(stream)}?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildLogsIngestionUploadPlan({
  dir,
  endpoint,
  dcrImmutableId,
  allowContent = false,
  apiVersion = '2023-01-01'
} = {}) {
  const ingestPlan = buildAzureIngestPlan({ dir, allowContent });
  const normalizedEndpoint = normalizeLogsEndpoint(endpoint);
  const immutableId = String(dcrImmutableId || '').trim();
  const errors = [...ingestPlan.errors];
  const uploads = [];

  if (!normalizedEndpoint) errors.push('logs-upload requires --endpoint <logs-ingestion-endpoint>');
  if (!immutableId) errors.push('logs-upload requires --dcr-immutable-id <immutable-id>');

  for (const [table, summary] of Object.entries(ingestPlan.tables)) {
    if (summary.rows === 0) continue;
    if (table === 'AgentOpsContent_CL' && !allowContent) continue;
    const uri = normalizedEndpoint && immutableId
      ? logsIngestionUri(normalizedEndpoint, immutableId, summary.stream_name, apiVersion)
      : null;
    uploads.push({
      table,
      file: summary.file,
      rows: summary.rows,
      stream: summary.stream_name,
      uri,
      command: [
        'az',
        'rest',
        '--method',
        'post',
        '--uri',
        uri || '<logs-ingestion-uri>',
        '--resource',
        logsIngestionResource,
        '--headers',
        'Content-Type=application/json',
        '--body',
        `@<${table}.json>`
      ]
    });
  }

  if (uploads.length === 0) errors.push('logs-upload found no non-empty AgentOps tables to upload');

  return {
    schema_version: 'agentops.logs-ingestion-upload-plan.v1',
    mode: 'dry-run-unless---yes',
    ok: errors.length === 0,
    dir: ingestPlan.dir,
    endpoint: normalizedEndpoint || null,
    dcr_immutable_id: immutableId || null,
    api_version: apiVersion,
    uploads,
    warnings: ingestPlan.warnings,
    errors,
    privacy: ingestPlan.privacy,
    content_capture: ingestPlan.content_capture,
    guardrails: [
      'Dry run by default: no Azure writes happen unless --yes is provided.',
      'Rows are uploaded through Azure Monitor Logs Ingestion API with Azure CLI credentials.',
      'Run azure-ingest plan first and keep content rows disabled unless using an approved restricted content workspace.'
    ],
    next: [
      'Review the upload list and privacy scan.',
      'Run the same command with --yes only after confirming the DCR streams map to the AgentOps custom tables.',
      'Run agentops product audit --live --require-rows after ingestion latency has passed.'
    ]
  };
}

const sharedStorageTables = [
  'AgentOpsRecommendations_CL',
  'AgentOpsSavedViews_CL',
  'AgentOpsAlertHandoffs'
];

function validateSharedStorageFile(table, file) {
  const { rows, parseErrors, text } = readJsonl(file);
  const columns = columnsFor(rows);
  const errors = [...parseErrors];
  const required = requiredColumns[table] || [];

  for (const column of required) {
    if (!columns.includes(column)) errors.push(`${table}: missing required column ${column}`);
  }

  const leaks = scanForLeaks(table, text);
  return {
    table,
    file,
    rows: rows.length,
    columns,
    required_columns: required,
    errors,
    leaks
  };
}

function storageBlobName(prefix, table, file) {
  const normalizedPrefix = String(prefix || '').trim().replace(/^\/+|\/+$/g, '');
  const parts = [normalizedPrefix, table, path.basename(file)].filter(Boolean);
  return parts.join('/');
}

function buildSharedStorageUploadPlan({ dir, account, container = 'agentops-shared', prefix = 'agentops-shared' } = {}) {
  const absoluteDir = path.resolve(dir || '.');
  const storageAccount = String(account || '').trim();
  const containerName = String(container || '').trim();
  const errors = [];
  const warnings = [];
  const artifacts = [];
  const leaks = [];

  if (!storageAccount) errors.push('shared upload-plan requires --account <storage-account-name>');
  if (!containerName) errors.push('shared upload-plan requires --container <container-name>');

  for (const table of sharedStorageTables) {
    const file = path.join(absoluteDir, `${table}.jsonl`);
    if (!fs.existsSync(file)) {
      warnings.push(`${table}: file not found; skipping`);
      continue;
    }

    const validation = validateSharedStorageFile(table, file);
    errors.push(...validation.errors);
    leaks.push(...validation.leaks);
    if (validation.rows === 0) warnings.push(`${table}: no rows to share`);

    artifacts.push({
      table,
      file,
      rows: validation.rows,
      blob: storageBlobName(prefix, table, file),
      command: [
        'az',
        'storage',
        'blob',
        'upload',
        '--auth-mode',
        'login',
        '--account-name',
        storageAccount || '<storage-account-name>',
        '--container-name',
        containerName || '<container-name>',
        '--name',
        storageBlobName(prefix, table, file),
        '--file',
        file,
        '--overwrite',
        'true'
      ]
    });
  }

  for (const manifestName of ['recommendations-manifest.json', 'saved-views-manifest.json', 'alert-handoffs-manifest.json']) {
    const file = path.join(absoluteDir, manifestName);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const manifestLeaks = scanForLeaks(manifestName, text);
    leaks.push(...manifestLeaks);
    artifacts.push({
      table: 'manifest',
      file,
      rows: null,
      blob: storageBlobName(prefix, 'manifests', file),
      command: [
        'az',
        'storage',
        'blob',
        'upload',
        '--auth-mode',
        'login',
        '--account-name',
        storageAccount || '<storage-account-name>',
        '--container-name',
        containerName || '<container-name>',
        '--name',
        storageBlobName(prefix, 'manifests', file),
        '--file',
        file,
        '--overwrite',
        'true'
      ]
    });
  }

  if (artifacts.filter(item => item.table !== 'manifest').length === 0) {
    errors.push('no shared artifacts found; export recommendations, saved views, or alert handoffs first');
  }
  if (leaks.length > 0) {
    errors.push(`privacy scan found ${leaks.length} content-like or secret-like match(es)`);
  }

  return {
    schema_version: 'agentops.shared-storage-upload-plan.v1',
    mode: 'preview-only-blob-upload-plan',
    ok: errors.length === 0,
    dir: absoluteDir,
    storage: {
      account: storageAccount || null,
      container: containerName || null,
      prefix: String(prefix || '').trim()
    },
    artifacts,
    warnings,
    errors,
    privacy: {
      ok: leaks.length === 0,
      leaks,
      mode: 'metadata-only shared artifacts; prompts, responses, tool arguments, tool results, source code, and file contents are not allowed'
    },
    guardrails: [
      'Preview-only: this command does not upload blobs or create Azure resources.',
      'Use Azure RBAC and --auth-mode login; do not use account keys in shared workflows.',
      'Keep shared storage limited to metadata-only recommendation, saved-view, and alert-handoff exports.'
    ],
    next: [
      'Review the artifact list and privacy scan.',
      'Create or deploy the shared storage account and container if needed.',
      'Run the listed az storage blob upload commands only after owner approval.'
    ]
  };
}

module.exports = {
  buildAzureIngestPlan,
  buildLogsIngestionUploadPlan,
  buildSharedStorageUploadPlan,
  columnTypesFor,
  inferAzureColumnType,
  logsIngestionUri,
  renderAzureIngestPlan,
  renderLogsIngestionUploadPlan,
  renderSharedStorageUploadPlan,
  requiredColumns,
  leakPatterns,
  streamNameFor
};
