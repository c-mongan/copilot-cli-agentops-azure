const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { setEnvForTest } = require('./support/env');

const repoRoot = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(repoRoot, 'agentops-cli', relativePath);
}

function clearCollectorRuntimeModules() {
  for (const relativePath of [
    'src/lib/paths.js',
    'src/lib/collector-runtime.js',
    'src/lib/collector-binary-runtime.js'
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

test('collector binary runtime starts a managed process with strict config', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-binary-runtime-start-'));
  const fakeBinary = path.join(tempDir, 'otelcol-contrib');
  const restoreEnv = setEnvForTest({
    AGENTOPS_COLLECTOR_HOME: path.join(tempDir, 'collector-home'),
    APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=test'
  });
  const spawnCalls = [];
  let unrefCalled = false;

  try {
    fs.writeFileSync(fakeBinary, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(fakeBinary, 0o755);

    clearCollectorRuntimeModules();
    const runtime = require(modulePath('src/lib/collector-runtime.js'));
    const restore = [
      patch(runtime, 'healthCheck', async () => ({ ok: false })),
      patch(runtime, 'readPid', () => null),
      patch(runtime, 'findManagedCollectorProcess', () => null),
      patch(runtime, 'waitForHealth', async () => ({ ok: true, statusCode: 200 })),
      patch(childProcess, 'spawn', (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return {
          pid: 4321,
          unref() {
            unrefCalled = true;
          }
        };
      })
    ];

    try {
      const { startBinaryCollector } = require(modulePath('src/lib/collector-binary-runtime.js'));
      const result = await startBinaryCollector({
        privacy: 'strict',
        findCollectorBinary: () => ({ ok: true, path: fakeBinary })
      });

      assert.equal(result.ok, true);
      assert.equal(result.pid, 4321);
      assert.equal(result.mode, 'binary');
      assert.match(result.config, /otelcol\.binary\.strict\.yaml$/);
      assert.equal(spawnCalls.length, 1);
      assert.equal(spawnCalls[0].command, fakeBinary);
      assert.deepEqual(spawnCalls[0].args, ['--config', result.config]);
      assert.equal(spawnCalls[0].options.env.APPLICATIONINSIGHTS_CONNECTION_STRING, 'InstrumentationKey=test');
      assert.equal(spawnCalls[0].options.env.AGENTOPS_OTEL_STORAGE_DIR, path.join(tempDir, 'collector-home', 'queue'));
      assert.equal(fs.existsSync(spawnCalls[0].options.env.AGENTOPS_OTEL_STORAGE_DIR), true);
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(spawnCalls[0].options.env.AGENTOPS_OTEL_STORAGE_DIR).mode & 0o777, 0o700);
      }
      assert.equal(unrefCalled, true);
    } finally {
      restore.reverse().forEach(fn => fn());
      clearCollectorRuntimeModules();
    }
  } finally {
    restoreEnv();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collector binary runtime refuses to stop an unverified pid file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-binary-runtime-stop-'));
  const restoreEnv = setEnvForTest({
    AGENTOPS_COLLECTOR_HOME: path.join(tempDir, 'collector-home')
  });
  const killed = [];

  try {
    clearCollectorRuntimeModules();
    const runtime = require(modulePath('src/lib/collector-runtime.js'));
    fs.mkdirSync(path.dirname(runtime.pidFile()), { recursive: true });
    fs.writeFileSync(runtime.pidFile(), '1234\n');

    const restore = [
      patch(runtime, 'readPid', () => 1234),
      patch(runtime, 'processAlive', pid => pid === 1234),
      patch(runtime, 'findManagedCollectorProcess', () => null),
      patch(process, 'kill', (pid, signal) => {
        killed.push({ pid, signal });
      })
    ];

    try {
      const { stopBinaryCollector } = require(modulePath('src/lib/collector-binary-runtime.js'));
      const result = stopBinaryCollector({
        privacy: 'strict',
        findCollectorBinary: () => ({ ok: true, path: '/tmp/otelcol-contrib' })
      });

      assert.deepEqual(killed, []);
      assert.equal(result.ok, true);
      assert.equal(result.stopped, false);
      assert.equal(result.pid, undefined);
      assert.equal(fs.existsSync(runtime.pidFile()), true);
    } finally {
      restore.reverse().forEach(fn => fn());
      clearCollectorRuntimeModules();
    }
  } finally {
    restoreEnv();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native Azure endpoint guard requires explicit approval and Azure OTLP URL shapes', () => {
  clearCollectorRuntimeModules();
  const { nativeEndpointEnvironment } = require(modulePath('src/lib/collector-binary-runtime.js'));
  const endpoints = {
    AGENTOPS_AZURE_OTLP_DCR_RESOURCE_ID: '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-copilot-agentops-dev/providers/Microsoft.Insights/dataCollectionRules/dcr-copilot-agentops-dev',
    AZURE_MONITOR_OTLP_TRACES_ENDPOINT: 'https://logs.ingest.monitor.azure.com/datacollectionRules/dcr/streams/Microsoft-OTLP-Traces/otlp/v1/traces',
    AZURE_MONITOR_OTLP_LOGS_ENDPOINT: 'https://logs.ingest.monitor.azure.com/datacollectionRules/dcr/streams/Microsoft-OTLP-Logs/otlp/v1/logs',
    AZURE_MONITOR_OTLP_METRICS_ENDPOINT: 'https://metrics.metrics.ingest.monitor.azure.com/datacollectionRules/dcr/streams/microsoft-otelmetrics/otlp/v1/metrics'
  };

  assert.equal(nativeEndpointEnvironment(endpoints).ok, false);
  assert.equal(nativeEndpointEnvironment({ ...endpoints, AGENTOPS_APPROVE_NATIVE_OTLP: 'yes', AGENTOPS_AZURE_SUBSCRIPTION_ID: '11111111-1111-4111-8111-111111111111' }).ok, true);
  assert.equal(nativeEndpointEnvironment({
    ...endpoints,
    AGENTOPS_APPROVE_NATIVE_OTLP: 'yes',
    AGENTOPS_AZURE_SUBSCRIPTION_ID: '11111111-1111-4111-8111-111111111111',
    AZURE_MONITOR_OTLP_LOGS_ENDPOINT: 'https://example.com/v1/logs'
  }).ok, false);
  clearCollectorRuntimeModules();
});
