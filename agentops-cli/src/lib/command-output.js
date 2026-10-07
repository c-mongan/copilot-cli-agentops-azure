const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function jsonOutput(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonlOutput(rows, { trailingNewline = rows.length > 0 } = {}) {
  return `${rows.map(row => JSON.stringify(row)).join('\n')}${trailingNewline ? '\n' : ''}`;
}

function writeJson(value, stdout = process.stdout) {
  stdout.write(jsonOutput(value));
}

function writeJsonOrRender(value, json, render, stdout = process.stdout) {
  stdout.write(json ? jsonOutput(value) : render(value));
}

// Replaces the user's home directory prefix in string values with "~" so JSON
// that gets shared or pasted does not reveal the account name. The paths stay
// usable from a shell.
function shortenHomePaths(value, home = os.homedir()) {
  const root = String(home || '').replace(/[\\/]+$/, '');
  if (!root || root === path.parse(root).root) return value;
  const shorten = item => {
    if (typeof item === 'string') {
      if (item === root) return '~';
      for (const separator of new Set([path.sep, '/'])) {
        if (item.startsWith(`${root}${separator}`)) return `~${separator}${item.slice(root.length + 1)}`;
      }
      return item;
    }
    if (Array.isArray(item)) return item.map(shorten);
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, shorten(entry)]));
    }
    return item;
  };
  return shorten(value);
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, jsonOutput(value));
  return filePath;
}

function writeJsonlFile(filePath, rows, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, jsonlOutput(rows, options));
  return filePath;
}

function appendJsonlFile(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, jsonlOutput([row]));
  return filePath;
}

module.exports = {
  appendJsonlFile,
  jsonOutput,
  shortenHomePaths,
  jsonlOutput,
  writeJson,
  writeJsonFile,
  writeJsonlFile,
  writeJsonOrRender
};
