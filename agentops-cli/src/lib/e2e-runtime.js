const childProcess = require('node:child_process');
const path = require('node:path');

const { writeJsonFile: writeJson } = require('./command-output');
const { repoRoot } = require('./paths');
const { sleep } = require('./timing');

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function evidenceDir(name = timestamp()) {
  return path.join(repoRoot, '.agentops', 'e2e', name);
}

function latestEvidenceDir() {
  return path.join(repoRoot, '.agentops', 'e2e', 'latest');
}

function redactText(text = '') {
  return String(text)
    .replace(/InstrumentationKey=[^;\s"]+/gi, 'InstrumentationKey=[REDACTED]')
    .replace(/(Authorization=Bearer\s+)[^\s"]+/gi, '$1[REDACTED]')
    .replace(/([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING)[A-Z0-9_]*=)[^\s"]+/gi, '$1[REDACTED]');
}

function runAgentops(args, options = {}) {
  const result = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'agentops-cli', 'src', 'index.js'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 120000
  });
  return {
    command: ['agentops', ...args].join(' '),
    status: result.status,
    stdout: redactText(result.stdout || ''),
    stderr: redactText(result.stderr || ''),
    error: result.error ? result.error.message : null
  };
}

function safeE2eEnv(extra = {}) {
  return {
    AGENTOPS_PRIVACY_MODE: 'strict',
    AGENTOPS_CAPTURE_CONTENT: 'false',
    AGENTOPS_DISABLE_CONTENT_CAPTURE_OVERRIDE: '1',
    COPILOT_OTEL_CAPTURE_CONTENT: 'false',
    ...extra
  };
}

async function waitForLatestE2eSession(e2eId, last, options = {}) {
  const timeoutMs = options.timeoutMs || 180000;
  const intervalMs = options.intervalMs || 10000;
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let latest = null;
  let payload = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    latest = runAgentops(['latest', '--last', last, '--json']);
    try {
      payload = JSON.parse(latest.stdout);
    } catch {
      payload = null;
    }

    const ids = payload?.session?.e2e_ids || [];
    if (latest.status === 0 && (payload?.session?.e2e_id === e2eId || ids.includes(e2eId))) {
      return { latest, payload, attempts, matched: true };
    }

    await sleep(intervalMs);
  }

  return { latest, payload, attempts, matched: false };
}

module.exports = {
  evidenceDir,
  latestEvidenceDir,
  redactText,
  runAgentops,
  safeE2eEnv,
  timestamp,
  waitForLatestE2eSession,
  writeJson
};
