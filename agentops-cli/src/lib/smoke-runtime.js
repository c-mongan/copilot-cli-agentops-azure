const childProcess = require('node:child_process');
const http = require('node:http');
const https = require('node:https');

const { otlpHttpEndpoint } = require('./collector-endpoints');
const {
  DEFAULT_CLOUD_SMOKE_WAIT_MS,
  durationToMs,
  realCopilotSmokeArgs,
  realCopilotSmokeCommand
} = require('./smoke-cli');
const { validateKqlDuration } = require('./kql');
const { smokeAzureQuery } = require('./smoke-payloads');
const { sleep } = require('./timing');

function postJson(url, payload, options = {}) {
  return new Promise(resolve => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'POST',
      timeout: options.timeoutMs || 2500,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        statusCode: res.statusCode,
        body: responseBody
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', error => resolve({ ok: false, error: error.message }));
    req.end(body);
  });
}

function runRealCopilotSmoke(options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const command = options.copilotCommand || 'copilot';
  const args = realCopilotSmokeArgs();
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      AGENTOPS_PRIVACY_MODE: 'strict',
      AGENTOPS_CAPTURE_CONTENT: 'false',
      COPILOT_OTEL_ENABLED: 'true',
      COPILOT_OTEL_EXPORTER_TYPE: 'otlp-http',
      COPILOT_OTEL_SOURCE_NAME: 'github.copilot',
      COPILOT_OTEL_CAPTURE_CONTENT: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: options.endpoint || otlpHttpEndpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_SERVICE_NAME: 'github-copilot',
      OTEL_RESOURCE_ATTRIBUTES: 'agent.framework=github-copilot,agent.runtime=github-copilot-cli,agentops.profile=native-smoke'
    },
    encoding: 'utf8',
    timeout: durationToMs(options.copilotTimeoutMs ?? options.timeout, 120000),
    maxBuffer: 1024 * 1024
  });
  const status = result.status === null || result.status === undefined ? 1 : result.status;
  return {
    ok: status === 0 && !result.error,
    status,
    signal: result.signal || null,
    error: result.error?.message || null,
    duration_ms: Date.now() - started,
    command: realCopilotSmokeCommand(),
    cwd: options.cwd || process.cwd()
  };
}

function openUrlInBrowser(url, options = {}) {
  if (!url) return { ok: false, reason: 'missing-url' };
  if (options.openUrl) return options.openUrl(url);
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const platform = options.platform || process.platform;
  const command = platform === 'darwin' ? 'open' : (platform === 'win32' ? 'cmd' : 'xdg-open');
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: durationToMs(options.openTimeoutMs, 5000),
    maxBuffer: 1024 * 1024
  });
  const status = result.status === null || result.status === undefined ? 1 : result.status;
  return {
    ok: status === 0 && !result.error,
    command: [command, ...args].join(' '),
    status,
    error: result.error?.message || null,
    url
  };
}

async function waitForLatestRunSummary(options = {}) {
  const last = validateKqlDuration(options.last || '2h');
  const waitMs = durationToMs(options.waitMs ?? options.wait, DEFAULT_CLOUD_SMOKE_WAIT_MS);
  const pollMs = Math.max(1, durationToMs(options.pollMs ?? options.poll, 10000));
  const latestFn = options.latestSummary || options.latestSummaryFromArgs;
  if (!latestFn) throw new Error('latestSummaryFromArgs is required');
  const sleepFn = options.sleep || sleep;
  const started = Date.now();
  const attempts = [];

  while (true) {
    let summary;
    try {
      const value = latestFn({ last });
      summary = typeof value?.then === 'function' ? await value : value;
    } catch (error) {
      summary = { session: null, error: error.message };
    }
    const visible = Boolean(summary?.session?.grafana_url);
    attempts.push({
      visible,
      session_id: summary?.session?.id || null,
      error: summary?.error || null
    });
    if (visible) {
      return {
        ok: true,
        status: 'found',
        summary,
        attempts,
        elapsed_ms: Date.now() - started
      };
    }

    const elapsed = Date.now() - started;
    if (waitMs === 0 || elapsed >= waitMs) break;
    await sleepFn(Math.min(pollMs, waitMs - elapsed));
  }

  return {
    ok: false,
    status: attempts.some(attempt => !attempt.error) ? 'not_found' : 'query_failed',
    summary: null,
    attempts,
    elapsed_ms: Date.now() - started
  };
}

async function verifySmokeInAzure(id, options = {}) {
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const workspace = options.workspaceId || options.defaultWorkspaceId;
  const waitMs = durationToMs(options.waitMs ?? options.wait, DEFAULT_CLOUD_SMOKE_WAIT_MS);
  const pollMs = Math.max(1, durationToMs(options.pollMs ?? options.poll, 10000));
  const sleepFn = options.sleep || sleep;
  const queryFn = options.runQuery || options.runAzureLogAnalyticsQuery;
  if (!queryFn) throw new Error('runAzureLogAnalyticsQuery is required');
  const started = Date.now();
  const attempts = [];

  while (true) {
    let resolved;
    try {
      const queryResult = queryFn(query, {
        workspaceId: workspace,
        spawnSync: options.spawnSync
      });
      resolved = typeof queryResult?.then === 'function' ? await queryResult : queryResult;
    } catch (error) {
      resolved = { ok: false, rows: [], error: error.message };
    }
    const rows = Array.isArray(resolved?.rows) ? resolved.rows : [];
    const attempt = {
      ok: Boolean(resolved?.ok),
      rows: rows.length,
      error: resolved?.error || null
    };
    attempts.push(attempt);

    if (attempt.ok && rows.length > 0) {
      return {
        ok: true,
        status: 'found',
        workspace_id: workspace,
        query,
        rows: rows.length,
        attempts,
        elapsed_ms: Date.now() - started
      };
    }

    const elapsed = Date.now() - started;
    if (waitMs === 0 || elapsed >= waitMs) break;
    await sleepFn(Math.min(pollMs, waitMs - elapsed));
  }

  return {
    ok: false,
    status: attempts.some(attempt => attempt.ok) ? 'not_found' : 'query_failed',
    workspace_id: workspace,
    query,
    rows: 0,
    attempts,
    elapsed_ms: Date.now() - started
  };
}

module.exports = {
  openUrlInBrowser,
  postJson,
  runRealCopilotSmoke,
  verifySmokeInAzure,
  waitForLatestRunSummary
};
