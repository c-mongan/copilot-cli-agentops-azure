const { optionValue, hasFlag } = require('./args');
const collectorRelease = require('./collector-release');
const { collectorConfigPath } = require('./paths');

const collectorModes = ['auto', 'local', 'docker', 'binary', 'azure-native', 'none'];
const privacyModes = ['strict', 'compat'];
const defaultCollectorVersion = collectorRelease.defaultCollectorVersion();

function parseCollectorOptions(args = [], env = process.env) {
  const mode = optionValue(args, ['--mode'], env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const privacy = optionValue(args, ['--privacy'], env.AGENTOPS_PRIVACY_MODE || 'strict');
  return {
    mode: normalizeMode(mode),
    privacy: normalizePrivacy(privacy),
    json: hasFlag(args, '--json'),
    poison: hasFlag(args, '--poison'),
    force: hasFlag(args, '--force'),
    purge: hasFlag(args, '--purge'),
    version: optionValue(args, ['--version'], env.AGENTOPS_OTELCOL_VERSION || defaultCollectorVersion),
    unsafeNoCollector: hasFlag(args, '--unsafe-no-collector') || env.AGENTOPS_ALLOW_NO_COLLECTOR === '1'
  };
}

function normalizeMode(mode) {
  const value = String(mode || 'auto').toLowerCase();
  if (!collectorModes.includes(value)) throw new Error(`Unsupported collector mode: ${mode}`);
  return value;
}

function normalizePrivacy(privacy) {
  const value = String(privacy || 'strict').toLowerCase();
  if (!privacyModes.includes(value)) throw new Error(`Unsupported privacy mode: ${privacy}`);
  return value;
}

function defaultConfigPathFor(mode, privacy) {
  if (mode === 'azure-native') {
    if (normalizePrivacy(privacy) !== 'strict') throw new Error('azure-native mode only supports strict privacy mode.');
    return collectorConfigPath({ target: 'azuremonitor.native', privacy: 'strict' });
  }
  return collectorConfigPath({
    target: mode === 'local' ? 'local' : mode === 'binary' ? 'binary' : 'azuremonitor',
    privacy
  });
}

function collectorConfigPathsFor(mode, privacy) {
  if (mode !== 'azure-native') return [defaultConfigPathFor(mode, privacy)];
  if (normalizePrivacy(privacy) !== 'strict') {
    throw new Error('azure-native mode only supports strict privacy mode.');
  }
  return [
    collectorConfigPath({ target: 'local', privacy: 'strict' }),
    collectorConfigPath({ target: 'azuremonitor.native', privacy: 'strict' })
  ];
}

module.exports = {
  collectorModes,
  collectorConfigPathsFor,
  defaultConfigPathFor,
  defaultCollectorVersion,
  normalizeMode,
  normalizePrivacy,
  parseCollectorOptions,
  privacyModes
};
