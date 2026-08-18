const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  composeFile,
  composeHasLocalhostBindings,
  dockerComposeArgs,
  dockerProjectName
} = require('../src/lib/collector-docker');

test('collector Docker helpers build stable compose command arguments', () => {
  const args = dockerComposeArgs(['config']);

  assert.equal(args[0], 'compose');
  assert.equal(args[args.indexOf('--project-name') + 1], dockerProjectName);
  assert.equal(args[args.indexOf('-f') + 1], composeFile);
  assert.equal(path.isAbsolute(composeFile), true);
  assert.deepEqual(args.slice(-1), ['config']);
});

test('collector Docker helpers require localhost-only compose bindings', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-compose-bindings-'));
  const good = path.join(tempDir, 'good.yaml');
  const bad = path.join(tempDir, 'bad.yaml');

  try {
    fs.writeFileSync(good, [
      'ports:',
      '  - "127.0.0.1:4318:4318"',
      '  - "127.0.0.1:4317:4317"',
      '  - "127.0.0.1:13133:13133"'
    ].join('\n'));
    fs.writeFileSync(bad, [
      'ports:',
      '  - "0.0.0.0:4318:4318"',
      '  - "127.0.0.1:4317:4317"',
      '  - "127.0.0.1:13133:13133"'
    ].join('\n'));

    assert.equal(composeHasLocalhostBindings(good), true);
    assert.equal(composeHasLocalhostBindings(bad), false);
    assert.equal(composeHasLocalhostBindings(path.join(tempDir, 'missing.yaml')), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
