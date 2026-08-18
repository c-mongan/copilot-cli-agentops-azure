const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(repoRoot, 'agentops-cli', relativePath);
}

function clearDockerRuntimeModules() {
  for (const relativePath of [
    'src/lib/collector-connection.js',
    'src/lib/collector-docker.js',
    'src/lib/collector-docker-runtime.js',
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

test('collector Docker runtime starts and stops compose with expected env and args', () => {
  clearDockerRuntimeModules();
  const connection = require(modulePath('src/lib/collector-connection.js'));
  const docker = require(modulePath('src/lib/collector-docker.js'));
  const shell = require(modulePath('src/lib/shell.js'));
  const calls = [];
  const restore = [
    patch(connection, 'resolveConnectionString', () => ({ ok: true, value: 'InstrumentationKey=test' })),
    patch(docker, 'dockerDaemonAvailable', () => true),
    patch(shell, 'run', (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    })
  ];

  try {
    const {
      startDockerCollector,
      stopDockerCollector
    } = require(modulePath('src/lib/collector-docker-runtime.js'));

    const started = startDockerCollector({ privacy: 'compat' });
    const stopped = stopDockerCollector({ privacy: 'compat' });

    assert.equal(started.ok, true);
    assert.equal(started.mode, 'docker');
    assert.equal(started.privacyMode, 'compat');
    assert.equal(stopped.ok, true);
    assert.equal(stopped.mode, 'docker');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args.slice(-3), ['up', '-d', '--force-recreate']);
    assert.equal(calls[0].options.timeout, 60000);
    assert.equal(calls[0].options.env.APPLICATIONINSIGHTS_CONNECTION_STRING, 'InstrumentationKey=test');
    assert.equal(calls[0].options.env.AGENTOPS_PRIVACY_MODE, 'compat');
    assert.deepEqual(calls[1].args.slice(-1), ['down']);
    assert.equal(calls[1].options.timeout, 60000);
  } finally {
    restore.reverse().forEach(fn => fn());
    clearDockerRuntimeModules();
  }
});
