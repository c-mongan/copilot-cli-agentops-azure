const fs = require('node:fs');
const path = require('node:path');

const { collectorDir } = require('./paths');
const { commandExists, run } = require('./shell');

const dockerProjectName = 'agentops-azuremonitor';
const composeFile = path.join(collectorDir, 'docker-compose.azuremonitor.yaml');

function dockerComposeArgs(extra = []) {
  return [
    'compose',
    '--project-name',
    dockerProjectName,
    '--project-directory',
    collectorDir,
    '-f',
    composeFile,
    ...extra
  ];
}

function composeHasLocalhostBindings(filePath = composeFile) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  return [
    '127.0.0.1:4318:4318',
    '127.0.0.1:4317:4317',
    '127.0.0.1:13133:13133'
  ].every(binding => text.includes(binding)) && !/["']?0\.0\.0\.0:43(17|18):/.test(text);
}

function dockerCliAvailable() {
  return commandExists('docker');
}

function dockerDaemonAvailable() {
  if (!dockerCliAvailable()) return false;
  const result = run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5000 });
  return result.status === 0;
}

function dockerComposeAvailable() {
  if (!dockerCliAvailable()) return false;
  const result = run('docker', ['compose', 'version'], { timeout: 5000 });
  return result.status === 0;
}

module.exports = {
  composeFile,
  composeHasLocalhostBindings,
  dockerCliAvailable,
  dockerComposeArgs,
  dockerComposeAvailable,
  dockerDaemonAvailable,
  dockerProjectName
};
