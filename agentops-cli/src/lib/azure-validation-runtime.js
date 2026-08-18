const childProcess = require('node:child_process');
const { commandCandidates } = require('./shell');

function azAvailable(options = {}) {
  if (options.azAvailable !== undefined) return Boolean(options.azAvailable);
  if (options.spawnSync) return true;
  return (options.commandCandidates || commandCandidates)('az').length > 0;
}

function runAz(args, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  return spawnSync('az', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function parseJsonOutput(result) {
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
}

function checkResult(name, ok, extra = {}) {
  return { name, ok: Boolean(ok), ...extra };
}

function azErrorDetail(result, fallback) {
  return (result.stderr || result.stdout || fallback || `az exited with status ${result.status}`).trim();
}

module.exports = {
  azAvailable,
  azErrorDetail,
  checkResult,
  commandCandidates,
  parseJsonOutput,
  runAz
};
