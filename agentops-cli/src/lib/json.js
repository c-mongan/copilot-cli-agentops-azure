const fs = require('node:fs');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function readJsonlIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return readJsonl(filePath);
}

module.exports = {
  readJson,
  readJsonl,
  readJsonlIfExists,
  readJsonlRows: readJsonl
};
