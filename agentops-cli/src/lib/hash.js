const crypto = require('node:crypto');

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function prefixedHash(value, prefix = 'h') {
  return `${prefix}_${hashText(String(value)).slice(0, 16)}`;
}

function prefixedHashOrEmpty(value, prefix = 'h') {
  return prefixedHash(value || '', prefix);
}

module.exports = {
  hashText,
  prefixedHash,
  prefixedHashOrEmpty
};
