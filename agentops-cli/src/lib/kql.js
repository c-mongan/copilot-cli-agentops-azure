function validateKqlDuration(value) {
  if (!/^[1-9][0-9]*(s|m|h|d)$/.test(value)) {
    throw new Error('--last must be a duration like 30m, 24h, or 7d');
  }
  return value;
}

function escapeKqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

module.exports = {
  escapeKqlString,
  validateKqlDuration
};
