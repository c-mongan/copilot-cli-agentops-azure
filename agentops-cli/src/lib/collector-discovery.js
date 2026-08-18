const path = require('node:path');

const { collectorHome } = require('./paths');
const { commandCandidates, isExecutable } = require('./shell');
const {
  dockerCliAvailable,
  dockerComposeAvailable,
  dockerDaemonAvailable
} = require('./collector-docker');

function findCollectorBinary(env = process.env) {
  const configured = env.AGENTOPS_OTELCOL_BIN;
  if (configured) {
    const resolved = path.resolve(configured);
    return {
      path: resolved,
      source: 'AGENTOPS_OTELCOL_BIN',
      ok: isExecutable(resolved),
      error: isExecutable(resolved) ? null : `AGENTOPS_OTELCOL_BIN is not executable: ${resolved}`
    };
  }

  const installedNames = process.platform === 'win32'
    ? ['otelcol-contrib.exe', 'otelcol-contrib', 'otelcol.exe', 'otelcol']
    : ['otelcol-contrib', 'otelcol'];
  for (const name of installedNames) {
    const candidate = path.join(collectorHome, 'bin', name);
    if (isExecutable(candidate)) {
      return { path: candidate, source: 'AGENTOPS_COLLECTOR_HOME', ok: true, error: null };
    }
  }

  for (const name of ['otelcol-contrib', 'otelcol']) {
    const candidate = commandCandidates(name)[0];
    if (candidate && isExecutable(candidate)) {
      return { path: candidate, source: 'PATH', ok: true, error: null };
    }
  }

  return {
    path: null,
    source: null,
    ok: false,
    error: 'No otelcol-contrib or otelcol binary found on PATH. Set AGENTOPS_OTELCOL_BIN or install a Collector binary.'
  };
}

function resolveAutoMode(env = process.env) {
  const binary = findCollectorBinary(env);
  if (binary.ok) return { mode: 'binary', reason: `using ${binary.path}` };
  if (dockerCliAvailable() && dockerComposeAvailable() && dockerDaemonAvailable()) {
    return { mode: 'docker', reason: 'using Docker Compose fallback' };
  }
  return {
    mode: null,
    reason: [
      binary.error,
      dockerCliAvailable() && dockerComposeAvailable()
        ? 'Docker daemon is not reachable.'
        : 'Docker Compose is not available.',
      'Run `agentops collector install-binary`, or start/install Docker, then rerun the command.'
    ].join(' ')
  };
}

module.exports = {
  findCollectorBinary,
  resolveAutoMode
};
