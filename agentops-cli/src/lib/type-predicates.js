function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  asArray,
  isPlainObject,
  isStringArray
};
