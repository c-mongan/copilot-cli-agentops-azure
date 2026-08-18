const {
  composeFile,
  dockerComposeArgs,
  dockerDaemonAvailable,
  dockerProjectName
} = require('./collector-docker');
const { resolveConnectionString } = require('./collector-connection');
const { run } = require('./shell');

function dockerError(result) {
  return (result.stderr || result.stdout || `docker compose exited ${result.status}`).trim();
}

function startDockerCollector({ privacy = 'strict' } = {}) {
  const connection = resolveConnectionString();
  if (!connection.ok) return { ok: false, mode: 'docker', error: connection.error };
  if (!dockerDaemonAvailable()) return { ok: false, mode: 'docker', error: 'Docker daemon is not reachable.' };
  const result = run('docker', dockerComposeArgs(['up', '-d', '--force-recreate']), {
    env: {
      APPLICATIONINSIGHTS_CONNECTION_STRING: connection.value,
      AGENTOPS_PRIVACY_MODE: privacy
    },
    timeout: 60000
  });
  return {
    ok: result.status === 0,
    mode: 'docker',
    privacyMode: privacy,
    composeFile,
    projectName: dockerProjectName,
    error: result.status === 0 ? null : dockerError(result)
  };
}

function stopDockerCollector({ privacy = 'strict' } = {}) {
  const result = run('docker', dockerComposeArgs(['down']), { timeout: 60000 });
  return {
    ok: result.status === 0,
    mode: 'docker',
    error: result.status === 0 ? null : dockerError(result)
  };
}

module.exports = {
  startDockerCollector,
  stopDockerCollector
};
