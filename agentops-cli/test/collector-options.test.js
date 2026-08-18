const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  collectorModes,
  collectorConfigPathsFor,
  defaultConfigPathFor,
  normalizeMode,
  normalizePrivacy,
  parseCollectorOptions,
  privacyModes
} = require('../src/lib/collector-options');
const { collectorConfigPath } = require('../src/lib/paths');

test('collector option helpers normalize modes privacy and CLI flags', () => {
  assert.deepEqual(collectorModes, ['auto', 'local', 'docker', 'binary', 'azure-native', 'none']);
  assert.deepEqual(privacyModes, ['strict', 'compat']);
  assert.equal(normalizeMode('DOCKER'), 'docker');
  assert.equal(normalizeMode(''), 'auto');
  assert.equal(normalizePrivacy('COMPAT'), 'compat');
  assert.equal(normalizePrivacy(''), 'strict');
  assert.throws(() => normalizeMode('podman'), /Unsupported collector mode: podman/);
  assert.throws(() => normalizePrivacy('loose'), /Unsupported privacy mode: loose/);

  assert.deepEqual(parseCollectorOptions([
    '--mode',
    'binary',
    '--privacy',
    'compat',
    '--json',
    '--poison',
    '--force',
    '--purge',
    '--version',
    'v0.151.0',
    '--unsafe-no-collector'
  ], {}), {
    mode: 'binary',
    privacy: 'compat',
    json: true,
    poison: true,
    force: true,
    purge: true,
    version: 'v0.151.0',
    unsafeNoCollector: true
  });

  assert.deepEqual(parseCollectorOptions([], {
    AGENTOPS_COLLECTOR_MODE: 'none',
    AGENTOPS_PRIVACY_MODE: 'compat',
    AGENTOPS_OTELCOL_VERSION: 'v0.150.0',
    AGENTOPS_ALLOW_NO_COLLECTOR: '1'
  }), {
    mode: 'none',
    privacy: 'compat',
    json: false,
    poison: false,
    force: false,
    purge: false,
    version: 'v0.150.0',
    unsafeNoCollector: true
  });
});

test('collector option helpers own default config path resolution', () => {
  assert.equal(defaultConfigPathFor('binary', 'strict'), collectorConfigPath({ target: 'binary', privacy: 'strict' }));
  assert.equal(defaultConfigPathFor('docker', 'compat'), collectorConfigPath({ target: 'azuremonitor', privacy: 'compat' }));
  assert.equal(defaultConfigPathFor('azure-native', 'strict'), collectorConfigPath({ target: 'azuremonitor.native', privacy: 'strict' }));
  assert.deepEqual(collectorConfigPathsFor('azure-native', 'strict'), [
    collectorConfigPath({ target: 'local', privacy: 'strict' }),
    collectorConfigPath({ target: 'azuremonitor.native', privacy: 'strict' })
  ]);
  assert.throws(() => collectorConfigPathsFor('azure-native', 'compat'), /only supports strict/);

  for (const file of ['collector-config-validation.js', 'collector-manager.js', 'collector-status.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8');
    assert.doesNotMatch(source, /function defaultConfigPathFor\(/);
    assert.doesNotMatch(source, /function configTargetForMode\(/);
  }
});
