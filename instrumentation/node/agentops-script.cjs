const stateKey = Symbol.for('copilot-agentops.script-tracing');

function step(name, callback) {
  if (typeof callback !== 'function') throw new TypeError('agentops step requires a callback');
  const exporter = globalThis[stateKey];
  return exporter ? exporter.step(name, callback) : callback();
}

module.exports = { step };
