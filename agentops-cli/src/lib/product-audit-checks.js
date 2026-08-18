const fs = require('node:fs');
const path = require('node:path');

const { repoRoot } = require('./paths');

function resolvedProductPath(relativePath, root = repoRoot) {
  const direct = path.join(root, relativePath);
  if (fs.existsSync(direct)) return direct;
  if (relativePath.startsWith('agentops-cli/')) {
    const packageLocal = path.join(root, relativePath.slice('agentops-cli/'.length));
    if (fs.existsSync(packageLocal)) return packageLocal;
  }
  return direct;
}

function exists(relativePath, root = repoRoot) {
  return fs.existsSync(resolvedProductPath(relativePath, root));
}

function fileIncludes(relativePath, terms, root = repoRoot) {
  if (!exists(relativePath, root)) return false;
  const body = fs.readFileSync(resolvedProductPath(relativePath, root), 'utf8');
  return terms.every(term => body.includes(term));
}

function check(name, ok, evidence = [], missing = []) {
  return {
    name,
    ok: Boolean(ok),
    evidence,
    missing
  };
}

function requiredFilesCheck(name, files, root = repoRoot) {
  const missing = files.filter(file => !exists(file, root));
  return check(name, missing.length === 0, files.filter(file => !missing.includes(file)), missing);
}

module.exports = {
  check,
  exists,
  fileIncludes,
  resolvedProductPath,
  requiredFilesCheck
};
