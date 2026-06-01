const { resolveCopilotBinary } = require('../copilot-resolver');

function resolveRealCopilot(options = {}) {
  return resolveCopilotBinary(options);
}

module.exports = {
  resolveRealCopilot
};
