const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkAzureSubscription, normalizedSubscriptionId } = require('./subscription-guard');
const { allowedEvidenceTables, createDurableEvidenceSpool } = require('./durable-evidence-spool');
const { logsIngestionUri, streamNameFor } = require('./v2-ingest-plan');

const { configuredDeliveryLimits, readPrivateFile, reserveSharedPublishBytes } = require('../copilot/delivery-limits');

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
  const authenticationMode = options.authenticationMode || 'azure-cli';
  if (!['azure-cli', 'embedded'].includes(authenticationMode)) throw new Error('Durable Logs Ingestion authentication mode is invalid');
  if (options.tokenProvider !== undefined && typeof options.tokenProvider !== 'function') {
    throw new Error('Durable Logs Ingestion requires a callable token provider');
  }
  // An embedded identity provider has no Azure CLI account. Its destination
  // must be approved explicitly by its host, never inferred from ambient env.
  // This checks local destination consent, not ownership of a DCR: Azure RBAC
  // remains the authority for the endpoint/immutable DCR pair.
  const subscription = authenticationMode === 'embedded'
    ? approvedEmbeddedSubscription(options)
    : checkAzureSubscription({
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
    const body = JSON.stringify([row]);
    const send = async () => {
      if (options.abortSignal?.aborted) return { status: 0, error: 'publishing-cancelled', headers: {} };
      const reservation = reserveSharedPublishBytes(options, {
        subscriptionId: subscription.expected, logsIngestionEndpoint: endpoint, dcrImmutableId
      }, Buffer.byteLength(body));
      if (!reservation.allowed) return { status: 429, error: reservation.reason, headers: {} };
      const token = await tokenProvider();
      if (options.abortSignal?.aborted) return { status: 0, error: 'publishing-cancelled', headers: {} };
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Durable Logs Ingestion token provider returned no usable token');
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, timeoutSignal]) : timeoutSignal;
      return boundedResponse(await fetchImpl(uri, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
      redirect: 'error',
      signal
      }));
    };
    let response = await send();
    if ([401, 403].includes(Number(response?.status))) {
      response = await send();
    }
    return response;
  };
}

function approvedEmbeddedSubscription(options) {
  const expected = normalizedSubscriptionId(options.expectedSubscriptionId);
  const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (typeof options.tokenProvider !== 'function') {
    throw new Error('Durable Logs Ingestion requires a callable token provider');
  }
  if (!guid.test(expected) || !Array.isArray(options.approvedSubscriptionIds)
    || !options.approvedSubscriptionIds.map(normalizedSubscriptionId).includes(expected)) {
    throw new Error('Azure subscription guard refused the write: embedded publishing requires an explicit subscription ID and approved subscription list.');
  }
  return { ok: true, expected, active: '', mode: 'embedded-destination-approval' };
}

async function drainDurableLogsIngestion(options = {}) {
  const spool = createDurableEvidenceSpool({
    directory: options.directory,
    maxBytes: configuredDeliveryLimits(options).maxQueueBytes,
    ttlMs: configuredDeliveryLimits(options).ttlMs,
    now: typeof options.now === 'function' ? options.now : () => Number(options.now ?? Date.now()),
    sleep: options.sleep
  });
  const uploader = createDurableLogsIngestionUploader(options);
  return spool.drain(uploader, {
    maxAttempts: options.maxAttempts,
    runId: options.runId,
    eventIds: options.eventIds
  });
}

function jsonArrayUploadFile(jsonlFile, tempDir, table) {
  const rows = readPrivateFile(jsonlFile, 256 * 1024 * 1024)
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  const file = path.join(tempDir, `${table}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rows)}\n`, { mode: 0o600 });
  return file;
}

// Azure CLI reparses JSON and emits Python json.dumps: ASCII escapes and
// structural whitespace. Reserve an upper bound rather than the smaller UTF-8
// file size. Each numeric token gets 12 extra bytes for float representation.
function azureCliPayloadUpperBound(jsonText) {
  const ascii = jsonText.replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  let quoted = false, escaped = false, separators = 0, numbers = 0;
  for (let index = 0; index < ascii.length; index += 1) {
    const character = ascii[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === ',' || character === ':') separators += 1;
    else if (character === '-' || /[0-9]/.test(character)) {
      numbers += 1;
      while (index + 1 < ascii.length && /[0-9eE+.\-]/.test(ascii[index + 1])) index += 1;
    }
  }
  return Buffer.byteLength(ascii) + separators + 12 * numbers;
}

function runLogsIngestionUpload(plan, options = {}) {
  if (!plan.ok) return { ...plan, ok: false, executed: false };
  const limits = configuredDeliveryLimits(options);
  if (!limits.maxPublishBytesPerDay) return { ...plan, ok: false, executed: false, uploads: [], errors: [...(plan.errors || []), 'publishing_ceiling: explicit publishing allowance is required'] };
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const subscription = checkAzureSubscription({
    spawnSync,
    env: options.env,
    expectedSubscriptionId: options.expectedSubscriptionId,
    approvedSubscriptionIds: options.approvedSubscriptionIds,
    requireActive: !(plan.content_only || plan.spans_only || plan.events_only)
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
      const uri = new URL(upload.uri);
      validatedPublicLogsEndpoint(uri.origin);
      const match = uri.pathname.match(/^\/dataCollectionRules\/(dcr-[A-Za-z0-9-]+)\/streams\/(Custom-[A-Za-z0-9_]+)$/);
      if (uri.username || uri.password || uri.hash || !match || match[2] !== streamNameFor(upload.table)
        || uri.searchParams.get('api-version') !== '2023-01-01' || [...uri.searchParams.keys()].some(key => key !== 'api-version')) throw new Error('invalid canonical Logs Ingestion upload URI');
      const dcrImmutableId = match[1];
      const reservation = reserveSharedPublishBytes(options, {
        subscriptionId: subscription.expected, logsIngestionEndpoint: uri.origin, dcrImmutableId
      }, azureCliPayloadUpperBound(readPrivateFile(bodyFile, 256 * 1024 * 1024)));
      if (!reservation.allowed) {
        uploads.push({ ...upload, ok: false, status: null, error: reservation.reason });
        continue;
      }
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
  azureCliPayloadUpperBound,
  azureCliAccessToken,
  boundedResponse,
  createDurableLogsIngestionUploader,
  drainDurableLogsIngestion,
  jsonArrayUploadFile,
  renderLogsIngestionUploadResult,
  runLogsIngestionUpload,
  validatedPublicLogsEndpoint
};
