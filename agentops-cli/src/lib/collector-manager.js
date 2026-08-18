const {
  defaultConfigPathFor,
  defaultCollectorVersion,
  normalizeMode,
  normalizePrivacy,
  parseCollectorOptions
} = require('./collector-options');
const { validateCollectorArtifacts, validateOwaspFixtures } = require('./collector-artifacts');
const {
  composeFile,
  composeHasLocalhostBindings,
  dockerComposeArgs,
  dockerProjectName
} = require('./collector-docker');
const { findCollectorBinary, resolveAutoMode } = require('./collector-discovery');
const { resolveConnectionString } = require('./collector-connection');
const {
  installBinary: installCollectorBinary,
  uninstallBinary: uninstallCollectorBinary,
  validateBinaryConfig
} = require('./collector-binary-install');
const {
  collectorPackageInfo,
  installedCollectorBinaryPath,
  parseChecksumFile,
  sha256File,
  verifyChecksum
} = require('./collector-binary-release');
const { collectorStatus } = require('./collector-status');
const { validateCollectorConfig } = require('./collector-config-validation');
const { startCollector } = require('./collector-start');
const { stopCollector } = require('./collector-stop');
const { smokeCollector } = require('./collector-smoke');
const { healthCheck } = require('./collector-runtime');

const configPathFor = defaultConfigPathFor;


async function installBinary(options = {}) {
  return installCollectorBinary(options);
}

function uninstallBinary(options = {}) {
  return uninstallCollectorBinary(options, { stopCollector: stop });
}

async function status(options = {}) {
  return collectorStatus({ options, findCollectorBinary, resolveAutoMode, configPathFor });
}

async function start(options = {}) {
  return startCollector({ options, resolveAutoMode, findCollectorBinary });
}

function stop(options = {}) {
  return stopCollector({ options, resolveAutoMode, findCollectorBinary });
}

function validate(options = {}) {
  return validateCollectorConfig({ options, findCollectorBinary, resolveAutoMode, configPathFor });
}

async function smoke(options = {}) {
  return smokeCollector({ options, status, findCollectorBinary });
}

module.exports = {
  composeFile,
  composeHasLocalhostBindings,
  configPathFor,
  collectorPackageInfo,
  defaultCollectorVersion,
  dockerComposeArgs,
  dockerProjectName,
  findCollectorBinary,
  healthCheck,
  installBinary,
  installedCollectorBinaryPath,
  normalizeMode,
  normalizePrivacy,
  parseChecksumFile,
  parseCollectorOptions,
  resolveAutoMode,
  resolveConnectionString,
  sha256File,
  smoke,
  start,
  status,
  stop,
  uninstallBinary,
  validate,
  validateBinaryConfig,
  validateCollectorArtifacts,
  validateOwaspFixtures,
  verifyChecksum
};
