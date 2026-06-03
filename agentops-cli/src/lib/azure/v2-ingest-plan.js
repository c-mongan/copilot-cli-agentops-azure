const fs = require('node:fs');
const path = require('node:path');

const { tableNames } = require('../demo/agentops-demo-data');

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

  if (!(rows.length === 0 && optionalEmptyTables.has(table))) {
    for (const column of required) {
      if (!columns.includes(column)) errors.push(`${table}: missing required column ${column}`);
    }
  }
  if (rows.length === 0) warnings.push(`${table}: no rows yet; dashboards will show empty-state guidance for this table`);

  return {
    file,
    rows: rows.length,
    columns,
    columnTypes,
    streamName: streamNameFor(table),
    required_columns: required,
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
      required_columns: result.required_columns
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

const sharedStorageTables = [
  'AgentOpsRecommendations_CL',
  'AgentOpsSavedViews_CL'
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

  for (const manifestName of ['recommendations-manifest.json', 'saved-views-manifest.json']) {
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
    errors.push('no shared artifacts found; export recommendations or saved views first');
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
      'Keep shared storage limited to metadata-only recommendation and saved-view exports.'
    ],
    next: [
      'Review the artifact list and privacy scan.',
      'Create or deploy the shared storage account and container if needed.',
      'Run the listed az storage blob upload commands only after owner approval.'
    ]
  };
}

function renderSharedStorageUploadPlan(plan) {
  const lines = [];
  lines.push('AgentOps shared storage upload plan');
  lines.push('');
  lines.push(`Status: ${plan.ok ? 'ready' : 'not ready'}`);
  lines.push(`Directory: ${plan.dir}`);
  lines.push(`Storage: ${plan.storage.account || '<storage-account-name>'}/${plan.storage.container || '<container-name>'}`);
  lines.push(`Privacy scan: ${plan.privacy.ok ? 'passed' : 'failed'}`);
  lines.push('');
  lines.push('Artifacts:');
  for (const artifact of plan.artifacts) {
    lines.push(`- ${artifact.table}: ${artifact.rows === null ? 'manifest' : `${artifact.rows} row(s)`} -> ${artifact.blob}`);
  }
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of plan.errors) lines.push(`- ${error}`);
  }
  if (plan.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  lines.push('Commands:');
  for (const artifact of plan.artifacts) lines.push(`- ${artifact.command.join(' ')}`);
  lines.push('');
  lines.push('Next:');
  for (const command of plan.next) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

function renderAzureIngestPlan(plan) {
  const lines = [];
  lines.push('AgentOps V2 Azure ingestion plan');
  lines.push('');
  lines.push(`Status: ${plan.ok ? 'ready' : 'not ready'}`);
  lines.push(`Directory: ${plan.dir}`);
  lines.push(`Privacy scan: ${plan.privacy.ok ? 'passed' : 'failed'}`);
  lines.push(`Content rows: ${plan.content_capture.rows}${plan.content_capture.allowed ? ' (explicitly allowed)' : ''}`);
  lines.push('');
  lines.push('Tables:');
  for (const [table, summary] of Object.entries(plan.tables)) {
    lines.push(`- ${table}: ${summary.rows} row(s), ${summary.columns.length} column(s), stream ${summary.stream_name}`);
  }
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of plan.errors) lines.push(`- ${error}`);
  }
  if (plan.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  lines.push('Azure path: create Log Analytics custom tables/DCR streams for AgentOps*_CL, ingest these JSONL rows, then import the V2 Grafana dashboards.');
  lines.push('Next:');
  for (const command of plan.next) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildAzureIngestPlan,
  buildSharedStorageUploadPlan,
  columnTypesFor,
  inferAzureColumnType,
  renderAzureIngestPlan,
  renderSharedStorageUploadPlan,
  requiredColumns,
  leakPatterns,
  streamNameFor
};
