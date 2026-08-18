const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { findCollectorBinary, resolveAutoMode } = require('../src/lib/collector-discovery');

test('collector discovery resolves explicit executable binary for auto mode', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-discovery-'));
  const fakeBinary = path.join(tempDir, 'otelcol-contrib');
  fs.writeFileSync(fakeBinary, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(fakeBinary, 0o755);

  const env = { AGENTOPS_OTELCOL_BIN: fakeBinary };

  assert.deepEqual(findCollectorBinary(env), {
    path: fakeBinary,
    source: 'AGENTOPS_OTELCOL_BIN',
    ok: true,
    error: null
  });
  assert.deepEqual(resolveAutoMode(env), {
    mode: 'binary',
    reason: `using ${fakeBinary}`
  });
});
