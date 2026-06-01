const crypto = require('node:crypto');

function stableHashJson(value, prefix = 'schema') {
  const json = JSON.stringify(value ?? null);
  return `${prefix}_${crypto.createHash('sha256').update(json).digest('hex').slice(0, 16)}`;
}

function jsonByteSize(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function argsSchemaHash(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return stableHashJson(typeof args, 'schema');
  const shape = Object.fromEntries(Object.keys(args).sort().map(key => [key, typeof args[key]]));
  return stableHashJson(shape, 'schema');
}

module.exports = {
  argsSchemaHash,
  jsonByteSize,
  stableHashJson
};
