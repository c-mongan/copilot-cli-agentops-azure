const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeExecutionConfiguration,
  observedLaunchExecutionConfiguration,
  suppliedExecutionConfiguration
} = require('../src/lib/copilot/execution-configuration');

test('observed execution configuration is deterministic across reordered safe settings', () => {
  const first = observedLaunchExecutionConfiguration([
    '--model', 'gpt-5.4-mini', '--allow-tool', 'read_file', '--allow-tool=web_fetch',
    '--disable-mcp-server', 'remote-one', '--agent', 'reviewer', '-p', 'first prompt'
  ]);
  const second = observedLaunchExecutionConfiguration([
    '-p', 'different prompt', '--agent=reviewer', '--disable-mcp-server=remote-one',
    '--allow-tool=web_fetch', '--allow-tool', 'read_file', '--model=gpt-5.4-mini',
    '--session-id', 'different-session'
  ]);
  assert.equal(first.configurationVersion, second.configurationVersion);
  assert.equal(first.configurationVersion, '57bc034843a9e1ad');
  assert.equal(first.executionConfigurationHash, first.configurationVersion);
  assert.match(first.configurationVersion, /^[a-f0-9]{16}$/);
  assert.equal(first.completeness, 'partial');
  assert.deepEqual(first.scope, { model: 'observed', tools: 'observed', mcp: 'observed', skills: 'observed' });
  assert.equal(first.observedSettings.model.requested, 'gpt-5.4-mini');
  assert.deepEqual(first.observedSettings.tools.allowed, ['read_file', 'web_fetch']);
});

test('execution configuration excludes prompt, secret-bearing, path, and config-file contents', () => {
  const first = observedLaunchExecutionConfiguration([
    '--model', 'gpt-5.4-mini', '--plugin-dir', '/private/alice/plugin',
    '--additional-mcp-config', '/private/alice/mcp-with-token.json',
    '--secret-env-vars', 'API_TOKEN', '-p', 'PRIVATE_PROMPT_ONE'
  ]);
  const second = observedLaunchExecutionConfiguration([
    '--model', 'gpt-5.4-mini', '--plugin-dir', '/different/path',
    '--additional-mcp-config', '/different/config.json',
    '--secret-env-vars', 'OTHER_SECRET', '-p', 'PRIVATE_PROMPT_TWO'
  ]);
  assert.equal(first.configurationVersion, second.configurationVersion);
  const serialized = JSON.stringify(first);
  for (const secret of ['PRIVATE_PROMPT_ONE', 'API_TOKEN', '/private/alice', 'mcp-with-token']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(first.observedSettings.mcp.additionalConfigCount, 1);
  assert.equal(first.observedSettings.skills.pluginDirectoryCount, 1);
  assert.equal(first.observedSettings.secretArgumentCount, 1);
  assert.equal(first.excluded.configFileContents, true);
});

test('launches without explicit relevant settings retain unknown configuration identity', () => {
  const identity = observedLaunchExecutionConfiguration(['-p', 'synthetic', '--session-id', 'session-a']);
  assert.equal(identity.configurationVersion, null);
  assert.equal(identity.source, 'unknown');
  assert.equal(identity.completeness, 'unknown');
  assert.equal(identity.observedSettings, null);
});

test('a changed safe setting changes the execution configuration identity', () => {
  const first = observedLaunchExecutionConfiguration(['--model', 'gpt-5.4-mini']);
  const second = observedLaunchExecutionConfiguration(['--model', 'gpt-5.5']);
  assert.notEqual(first.configurationVersion, second.configurationVersion);
});

test('supplied configuration identity preserves explicit authority without accepting config blobs', () => {
  const identity = suppliedExecutionConfiguration({
    executionConfigurationHash: 'a'.repeat(64),
    completeness: 'authoritative',
    scope: { model: 'authoritative', tools: 'authoritative', mcp: 'authoritative', skills: 'authoritative' },
    secret: 'must-not-survive'
  });
  assert.equal(identity.configurationVersion, 'a'.repeat(64));
  assert.equal(identity.executionConfigurationHash, identity.configurationVersion);
  assert.equal(identity.completeness, 'authoritative');
  assert.equal(identity.verification, 'caller_asserted');
  assert.equal(identity.excluded.ambientConfiguration, false);
  assert.equal(JSON.stringify(identity).includes('must-not-survive'), false);
  assert.deepEqual(normalizeExecutionConfiguration(identity), identity);
  assert.throws(() => suppliedExecutionConfiguration({ configurationVersion: 'not-a-hash', completeness: 'authoritative' }), /hexadecimal hash/);
});

test('supplied identity defaults to unknown completeness and scope', () => {
  const identity = suppliedExecutionConfiguration({ configurationVersion: 'b'.repeat(16) });
  assert.equal(identity.completeness, 'unknown');
  assert.deepEqual(identity.scope, { model: 'unknown', tools: 'unknown', mcp: 'unknown', skills: 'unknown' });
  assert.equal(identity.excluded.ambientConfiguration, true);
});

test('persisted configuration identifier lists are bounded', () => {
  const args = ['--model', 'gpt-5.4-mini'];
  for (let index = 0; index < 80; index += 1) args.push('--allow-tool', `tool-${String(index).padStart(2, '0')}`);
  const identity = observedLaunchExecutionConfiguration(args);
  assert.equal(identity.observedSettings.tools.allowed.length, 64);
  assert.equal(identity.observedSettings.excludedValueCount, 16);
});

test('launches without relevant flags normalize to unknown instead of failing delivery', () => {
  const unknown = observedLaunchExecutionConfiguration(['-p', 'Run the tests and explain any failure']);
  assert.equal(unknown.source, 'unknown');
  const normalized = normalizeExecutionConfiguration(unknown);
  assert.equal(normalized.source, 'unknown');
  assert.equal(normalized.configurationVersion, null);
  assert.equal(normalizeExecutionConfiguration(JSON.parse(JSON.stringify(unknown))).source, 'unknown');
  assert.throws(() => normalizeExecutionConfiguration({ source: 'unknown', configurationVersion: 'not-a-hash' }), /lowercase hexadecimal hash/);
});
