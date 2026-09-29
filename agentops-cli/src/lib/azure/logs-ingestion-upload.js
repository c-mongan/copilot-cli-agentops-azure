const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkAzureSubscription } = require('./subscription-guard');
const { allowedEvidenceTables, createDurableEvidenceSpool } = require('./durable-evidence-spool');
const { logsIngestionUri, streamNameFor } = require('./v2-ingest-plan');

const logsIngestionResource = 'https://monitor.azure.com/';
const defaultRequestTimeoutMs = 30000;
const maximumRequestTimeoutMs = 120000;

function validatedPublicLogsEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(String(value || '').trim()); } catch {
    throw new Error('Durable Logs Ingestion requires a valid Azure public Monitor ingestion endpoint');
  }
  if (endpoint.protocol !== 'https:'
    || !endpoint.hostname.toLowerCase().endsWith('.ingest.monitor.azure.com')
    || endpoint.username || endpoint.password || endpoint.hash || endpoint.search
    || (endpoint.pathname !== '/' && endpoint.pathname !== '')) {
    throw new Error('Durable Logs Ingestion requires an Azure public Monitor ingestion endpoint with no credentials, path, query, or fragment');
  }
  return endpoint.origin;
}

function requestTimeoutMs(value) {
  if (value === undefined || value === null || value === '') return defaultRequestTimeoutMs;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximumRequestTimeoutMs) {
    throw new Error(`Durable Logs Ingestion timeoutMs must be an integer from 1 to ${maximumRequestTimeoutMs}`);
  }
  return parsed;
}

async function boundedResponse(response) {
  if (response?.body && typeof response.body.cancel === 'function') {
    try { await response.body.cancel(); } catch { /* status still drives retry classification */ }
  }
  return { status: Number(response?.status || 0), headers: response?.headers || {} };
}

function azureCliAccessToken(options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync('az', [
    'account', 'get-access-token',
    '--subscription', options.subscriptionId,
    '--resource', logsIngestionResource,
    '--query', 'accessToken',
    '-o', 'tsv'
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const token = String(result.stdout || '').trim();
  if (result.error || result.status !== 0 || !token) {
    throw new Error(`Could not obtain an Azure Monitor Logs Ingestion token${result.error ? `: ${result.error.message}` : ` (az exited ${result.status})`}`);
  }
  return token;
}

function createDurableLogsIngestionUploader(options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const subscription = checkAzureSubscription({
    spawnSync,
    env: options.env,
    expectedSubscriptionId: options.expectedSubscriptionId,
    approvedSubscriptionIds: options.approvedSubscriptionIds
  });
  if (!subscription.ok) throw new Error(subscription.error);
  const endpoint = validatedPublicLogsEndpoint(options.endpoint);
  const dcrImmutableId = String(options.dcrImmutableId || '').trim();
  if (!/^dcr-[A-Za-z0-9-]+$/.test(dcrImmutableId)) throw new Error('Durable Logs Ingestion requires a valid DCR immutable ID');
  const timeoutMs = requestTimeoutMs(options.timeoutMs);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Durable Logs Ingestion requires fetch');
  const tokenProvider = options.tokenProvider || (() => azureCliAccessToken({
    spawnSync,
    subscriptionId: subscription.expected
  }));

  return async (row, context = {}) => {
    if (!allowedEvidenceTables.has(context.table)) {
      return { status: 400, error: 'table-not-allowlisted' };
    }
    const uri = logsIngestionUri(endpoint, dcrImmutableId, streamNameFor(context.table));
    const send = async token => {
      if (typeof token !== 'string' || !token.trim()) throw new Error('Durable Logs Ingestion token provider returned no token');
      return boundedResponse(await fetchImpl(uri, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([row]),
      signal: AbortSignal.timeout(timeoutMs)
      }));
    };
    let response = await send(await tokenProvider());
    if ([401, 403].includes(Number(response?.status))) {
      response = await send(await tokenProvider());
    }
    return response;
  };
}

async function drainDurableLogsIngestion(options = {}) {
  const spool = createDurableEvidenceSpool({
    directory: options.directory,
    maxBytes: options.maxBytes,
    ttlMs: options.ttlMs,
    now: options.now,
    sleep: options.sleep
  });
  const uploader = createDurableLogsIngestionUploader(options);
  return spool.drain(uploader, { maxAttempts: options.maxAttempts });
}

function jsonArrayUploadFile(jsonlFile, tempDir, table) {
  const rows = fs.readFileSync(jsonlFile, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  const file = path.join(tempDir, `${table}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rows)}\n`, { mode: 0o600 });
  return file;
}

function runLogsIngestionUpload(plan, options = {}) {
  if (!plan.ok) return { ...plan, ok: false, executed: false };
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const subscription = checkAzureSubscription({
    spawnSync,
    env: options.env,
    expectedSubscriptionId: options.expectedSubscriptionId,
    approvedSubscriptionIds: options.approvedSubscriptionIds,
    requireActive: !plan.content_only
  });
  if (!subscription.ok) {
    return {
      ...plan,
      ok: false,
      executed: false,
      subscription_guard: subscription,
      uploads: [],
      errors: [...plan.errors, subscription.error]
    };
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-logs-upload-'));
  const uploads = [];
  let response;
  try {
    for (const upload of plan.uploads) {
      const bodyFile = jsonArrayUploadFile(upload.file, tempDir, upload.table);
      const args = [
        'rest',
        '--subscription',
        subscription.expected,
        '--method',
        'post',
        '--uri',
        upload.uri,
        '--resource',
        logsIngestionResource,
        '--headers',
        'Content-Type=application/json',
        '--body',
        `@${bodyFile}`
      ];
      const result = spawnSync('az', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      uploads.push({
        ...upload,
        status: result.status,
        ok: !result.error && result.status === 0,
        error: result.error ? result.error.message : '',
        stderr: result.stderr ? String(result.stderr).slice(0, 2000) : ''
      });
    }

    const ok = uploads.every(upload => upload.ok);
    response = {
      ...plan,
      ok,
      executed: true,
      subscription_guard: subscription,
      temporary_payloads_cleaned: true,
      uploads,
      errors: ok ? plan.errors : [
        ...plan.errors,
        ...uploads.filter(upload => !upload.ok).map(upload => `${upload.table}: az rest failed with status ${upload.status}${upload.error ? ` (${upload.error})` : ''}`)
      ]
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return response;
}

function renderLogsIngestionUploadResult(result) {
  const lines = [];
  lines.push('AgentOps Logs Ingestion upload');
  lines.push('');
  lines.push(`Status: ${result.ok ? 'uploaded' : 'failed'}`);
  lines.push(`Directory: ${result.dir}`);
  lines.push('');
  lines.push('Uploads:');
  for (const upload of result.uploads) {
    lines.push(`- ${upload.table}: ${upload.rows} row(s), ${upload.ok ? 'ok' : `failed status ${upload.status}`}`);
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  azureCliAccessToken,
  boundedResponse,
  createDurableLogsIngestionUploader,
  drainDurableLogsIngestion,
  jsonArrayUploadFile,
  renderLogsIngestionUploadResult,
  runLogsIngestionUpload,
  validatedPublicLogsEndpoint
};
