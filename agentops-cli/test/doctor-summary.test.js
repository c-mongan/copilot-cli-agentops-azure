const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { setEnvForTest } = require('./support/env');

function patch(object, key, value) {
  const original = object[key];
  object[key] = value;
  return () => {
    object[key] = original;
  };
}

test('doctor summary library reports blocking stored connection strings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-doctor-lib-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, 'APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=fake');

  const legacy = require('../src/legacy');
  const collector = require('../src/lib/collector-manager');
  const resolver = require('../src/lib/copilot-resolver');
  const restoreEnv = setEnvForTest({ AGENTOPS_CONFIG_PATH: configPath });
  const restore = [
    patch(legacy, 'doctor', () => [{ name: 'base-check', ok: true }]),
    patch(collector, 'status', async () => ({
      running: true,
      mode: 'auto',
      effectiveMode: 'binary',
      details: ['binary selected'],
      safeLocalhostBinding: true,
      health: { statusCode: 200 },
      binary: { ok: true, error: null }
    })),
    patch(resolver, 'resolveCopilotBinary', () => ({ ok: true, path: '/bin/copilot', error: null }))
  ];

  try {
    const { doctorSummary, renderDoctor } = require('../src/lib/doctor-summary');
    const summary = await doctorSummary({ localOnly: true });

    assert.equal(summary.ok, false);
    assert.equal(summary.checks.find(item => item.name === 'connection-string-not-on-disk').ok, false);
    assert.match(renderDoctor(summary), /connection-string-not-on-disk: failed/);
  } finally {
    restore.reverse().forEach(fn => fn());
    restoreEnv();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
