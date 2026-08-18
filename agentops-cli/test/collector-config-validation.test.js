const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(repoRoot, 'agentops-cli', relativePath);
}

function clearCollectorValidationModules() {
  for (const relativePath of [
    'src/lib/collector-artifacts.js',
    'src/lib/collector-config-validation.js',
    'src/lib/shell.js'
  ]) {
    const absolutePath = modulePath(relativePath);
    delete require.cache[require.resolve(absolutePath)];
  }
}

function patch(object, property, value) {
  const original = object[property];
  object[property] = value;
  return () => {
    object[property] = original;
  };
}

test('collector config validation carries artifact failures through binary validation', () => {
  clearCollectorValidationModules();
  const artifacts = require(modulePath('src/lib/collector-artifacts.js'));
  const shell = require(modulePath('src/lib/shell.js'));
  const config = path.join(repoRoot, 'collector', 'otelcol.binary.strict.yaml');
  const calls = [];
  const restore = [
    patch(artifacts, 'validateCollectorArtifacts', () => ({
      ok: false,
      errors: ['processor missing allowlist']
    })),
    patch(shell, 'run', (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    })
  ];

  try {
    const { validateCollectorConfig } = require(modulePath('src/lib/collector-config-validation.js'));
    const result = validateCollectorConfig({
      options: { mode: 'binary', privacy: 'strict' },
      findCollectorBinary: () => ({ ok: true, path: '/tmp/otelcol-contrib' }),
      resolveAutoMode: () => ({ mode: 'binary', reason: 'explicit mode' }),
      configPathFor: () => config
    });

    assert.equal(result.ok, false);
    assert.equal(result.mode, 'binary');
    assert.equal(result.privacyMode, 'strict');
    assert.equal(result.config, config);
    assert.equal(result.error, 'processor missing allowlist');
    assert.deepEqual(calls, [{
      command: '/tmp/otelcol-contrib',
      args: ['validate', '--config', config],
      options: {
        timeout: 30000,
        env: { AGENTOPS_OTEL_STORAGE_DIR: path.join(os.tmpdir(), 'agentops-otel-queue') }
      }
    }]);
  } finally {
    restore.reverse().forEach(fn => fn());
    clearCollectorValidationModules();
  }
});
