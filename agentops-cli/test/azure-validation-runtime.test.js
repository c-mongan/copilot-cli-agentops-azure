const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { setEnvForTest } = require('./support/env');

const {
  azAvailable,
  azErrorDetail,
  checkResult,
  commandCandidates,
  parseJsonOutput,
  runAz
} = require('../src/lib/azure-validation-runtime');

test('commandCandidates finds commands on PATH once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-az-runtime-'));
  const commandName = `agentops-az-${process.pid}`;
  const commandPath = path.join(dir, process.platform === 'win32' ? `${commandName}.cmd` : commandName);
  const restoreEnv = setEnvForTest({
    PATH: [dir, dir, process.env.PATH || ''].filter(Boolean).join(path.delimiter)
  });

  fs.writeFileSync(commandPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');

  try {
    assert.deepEqual(commandCandidates(commandName), [commandPath]);
  } finally {
    restoreEnv();
  }
});

test('azAvailable honors injected availability and command lookup', () => {
  assert.equal(azAvailable({ azAvailable: 0 }), false);
  assert.equal(azAvailable({ azAvailable: 'yes' }), true);
  assert.equal(azAvailable({ spawnSync: () => ({ status: 0 }) }), true);
  assert.equal(azAvailable({ commandCandidates: name => name === 'az' ? ['/usr/local/bin/az'] : [] }), true);
  assert.equal(azAvailable({ commandCandidates: () => [] }), false);
});

test('runAz shells out to az with json-safe defaults', () => {
  let observed = null;
  const result = runAz(['account', 'show', '-o', 'json'], {
    spawnSync: (command, args, options) => {
      observed = { command, args, options };
      return { status: 0, stdout: '{"id":"sub"}' };
    }
  });

  assert.deepEqual(result, { status: 0, stdout: '{"id":"sub"}' });
  assert.equal(observed.command, 'az');
  assert.deepEqual(observed.args, ['account', 'show', '-o', 'json']);
  assert.equal(observed.options.encoding, 'utf8');
  assert.equal(observed.options.maxBuffer, 10 * 1024 * 1024);
});

test('parseJsonOutput returns parsed JSON or null', () => {
  assert.deepEqual(parseJsonOutput({ stdout: '{"ok":true}' }), { ok: true });
  assert.deepEqual(parseJsonOutput({ stdout: '' }), {});
  assert.equal(parseJsonOutput({ stdout: '{bad json' }), null);
});

test('checkResult and azErrorDetail normalize validation output', () => {
  assert.deepEqual(checkResult('azure-account', 1, { detail: 'logged in' }), {
    name: 'azure-account',
    ok: true,
    detail: 'logged in'
  });
  assert.equal(azErrorDetail({ stderr: ' failed\n', stdout: 'ignored', status: 1 }, 'fallback'), 'failed');
  assert.equal(azErrorDetail({ stderr: '', stdout: ' output\n', status: 1 }, 'fallback'), 'output');
  assert.equal(azErrorDetail({ stderr: '', stdout: '', status: 7 }, 'fallback'), 'fallback');
  assert.equal(azErrorDetail({ stderr: '', stdout: '', status: 7 }), 'az exited with status 7');
});
