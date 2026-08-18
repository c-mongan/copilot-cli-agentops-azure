const { hasFlag, optionValue } = require('./args');

function browserProfileRuntimeDefaults(env = process.env) {
  return {
    browserExecutable: env.AGENTOPS_BROWSER_EXECUTABLE || '',
    browserUserDataDir: env.AGENTOPS_BROWSER_USER_DATA_DIR || '',
    storageState: env.AGENTOPS_BROWSER_STORAGE_STATE || '',
    headed: env.AGENTOPS_BROWSER_HEADED === '1',
    azureCliGrafanaAuth: false
  };
}

function browserProfileOptionsFromArgs(args = [], env = process.env) {
  const defaults = browserProfileRuntimeDefaults(env);
  return {
    browserExecutable: optionValue(args, '--browser-executable', defaults.browserExecutable),
    browserUserDataDir: optionValue(args, '--browser-user-data-dir', defaults.browserUserDataDir),
    storageState: optionValue(args, '--storage-state', defaults.storageState),
    headed: hasFlag(args, '--headed') || defaults.headed,
    azureCliGrafanaAuth: hasFlag(args, '--azure-cli-grafana-auth')
  };
}

module.exports = {
  browserProfileOptionsFromArgs,
  browserProfileRuntimeDefaults
};
