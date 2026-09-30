const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { setEnvForTest } = require('./support/env');

const repoRoot = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(repoRoot, 'agentops-cli', relativePath);
}

function clearCollectorStatusModules() {
  for (const relativePath of [
    'src/lib/paths.js',
    'src/lib/collector-docker.js',
    'src/lib/collector-runtime.js',
    'src/lib/collector-binary-runtime.js',
    'src/lib/collector-status.js'
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

test('collector status helper composes auto binary status with stale pid details', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-status-'));
  const fakeBinary = path.join(tempDir, 'otelcol-contrib');
  const restoreEnv = setEnvForTest({
    AGENTOPS_COLLECTOR_HOME: path.join(tempDir, 'collector-home')
  });

  try {
    fs.writeFileSync(fakeBinary, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(fakeBinary, 0o755);

    clearCollectorStatusModules();
    const docker = require(modulePath('src/lib/collector-docker.js'));
    const runtime = require(modulePath('src/lib/collector-runtime.js'));
    const binaryRuntime = require(modulePath('src/lib/collector-binary-runtime.js'));
    const config = path.join(repoRoot, 'collector', 'otelcol.binary.strict.yaml');
    const restore = [
      patch(docker, 'dockerCliAvailable', () => true),
      patch(docker, 'dockerComposeAvailable', () => true),
      patch(docker, 'dockerDaemonAvailable', () => false),
      patch(docker, 'composeHasLocalhostBindings', () => true),
      patch(runtime, 'healthCheck', async () => ({ ok: true, statusCode: 200 })),
      patch(runtime, 'readPid', () => 1111),
      patch(runtime, 'processAlive', pid => pid === 2222),
      patch(runtime, 'findManagedCollectorProcess', () => 2222),
      patch(runtime, 'findCollectorProcessByConfig', () => 2222),
      patch(binaryRuntime, 'findRunningBinaryCollector', () => ({ pid: 2222, privacy: 'strict', config }))
    ];

    try {
      const { collectorStatus } = require(modulePath('src/lib/collector-status.js'));
      const result = await collectorStatus({
        findCollectorBinary: () => ({
          ok: true,
          path: fakeBinary,
          source: 'AGENTOPS_OTELCOL_BIN',
          error: null
        }),
        resolveAutoMode: () => ({ mode: 'binary', reason: `using ${fakeBinary}` })
      });

      assert.equal(result.mode, 'auto');
      assert.equal(result.effectiveMode, 'binary');
      assert.equal(result.running, true);
      assert.equal(result.privacyMode, 'strict');
      assert.equal(result.privacyVerified, true);
      assert.equal(result.config, config);
      assert.equal(result.binary.pid, 2222);
      assert.equal(result.binary.discoveredPid, 2222);
      assert.equal(result.binary.running, true);
      assert.equal(result.docker.daemon, false);
      assert.match(result.details.join('\n'), /auto: using/);
      assert.match(result.details.join('\n'), /Binary PID file was stale; found running collector PID 2222/);
      assert.match(result.endpoint, /4318$/);
      assert.match(result.healthUrl, /13133$/);

      const explicit = await collectorStatus({
        options: { mode: 'binary' },
        env: { AGENTOPS_PRIVACY_MODE: 'compat' },
        findCollectorBinary: () => ({
          ok: true,
          path: fakeBinary,
          source: 'AGENTOPS_OTELCOL_BIN',
          error: null
        }),
        resolveAutoMode: () => ({ mode: 'binary', reason: `using ${fakeBinary}` })
      });
      assert.equal(explicit.privacyMode, 'strict', 'running config must win over a stale privacy environment value');
      assert.equal(explicit.config, config);
    } finally {
      restore.reverse().forEach(fn => fn());
      clearCollectorStatusModules();
    }
  } finally {
    restoreEnv();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collector health without a verified managed process does not claim a privacy mode', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-status-unverified-'));
  const fakeBinary = path.join(tempDir, 'otelcol-contrib');
  const restoreEnv = setEnvForTest({ AGENTOPS_COLLECTOR_HOME: path.join(tempDir, 'collector-home') });
  try {
    fs.writeFileSync(fakeBinary, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(fakeBinary, 0o755);
    clearCollectorStatusModules();
    const docker = require(modulePath('src/lib/collector-docker.js'));
    const runtime = require(modulePath('src/lib/collector-runtime.js'));
    const binaryRuntime = require(modulePath('src/lib/collector-binary-runtime.js'));
    const restore = [
      patch(docker, 'dockerCliAvailable', () => true),
      patch(docker, 'dockerComposeAvailable', () => true),
      patch(docker, 'dockerDaemonAvailable', () => false),
      patch(docker, 'composeHasLocalhostBindings', () => true),
      patch(runtime, 'healthCheck', async () => ({ ok: true, statusCode: 200 })),
      patch(runtime, 'readPid', () => null),
      patch(runtime, 'findManagedCollectorProcess', () => null),
      patch(runtime, 'findCollectorProcessByConfig', () => null),
      patch(binaryRuntime, 'findRunningBinaryCollector', () => null),
      patch(binaryRuntime, 'findRunningLocalCollector', () => null),
      patch(binaryRuntime, 'findRunningNativeCollector', () => null)
    ];
    try {
      const { collectorStatus } = require(modulePath('src/lib/collector-status.js'));
      const result = await collectorStatus({
        findCollectorBinary: () => ({ ok: true, path: fakeBinary }),
        resolveAutoMode: () => ({ mode: 'binary', reason: 'using test binary' })
      });
      assert.equal(result.running, true, 'the health endpoint is reachable');
      assert.equal(result.privacyMode, 'unknown');
      assert.equal(result.privacyVerified, false);
      assert.equal(result.config, null);
      assert.match(result.details.join('\n'), /configuration and privacy mode could not be verified/);
    } finally {
      restore.reverse().forEach(fn => fn());
      clearCollectorStatusModules();
    }
  } finally {
    restoreEnv();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
