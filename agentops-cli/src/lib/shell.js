const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function executableNames(command, platform = process.platform) {
  if (platform !== 'win32' || path.extname(command)) return [command];
  const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean);
  return pathExt.flatMap(ext => [`${command}${ext.toLowerCase()}`, `${command}${ext.toUpperCase()}`]);
}

function commandCandidates(command, options = {}) {
  const platform = options.platform || process.platform;
  const pathValue = options.pathValue || process.env.PATH || '';
  const names = executableNames(command, platform);
  const seen = new Set();
  const candidates = [];

  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (!fs.existsSync(candidate)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

function commandExists(command, options = {}) {
  return commandCandidates(command, options).length > 0;
}

function isExecutable(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  if (process.platform === 'win32') return true;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, args = [], options = {}) {
  return childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env || {}) }
  });
}

function runInherited(command, args = [], options = {}) {
  const result = childProcess.spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
    env: { ...process.env, ...(options.env || {}) }
  });
  if (result.error) throw result.error;
  return result;
}

module.exports = {
  commandCandidates,
  commandExists,
  isExecutable,
  run,
  runInherited
};
