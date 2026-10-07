#!/usr/bin/env node
'use strict';
// Offline-only drift check. Install Bicep separately; never calls Azure.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const BICEP_VERSION = '0.38.33';
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => key !== '_generator').map(key => [key, normalize(value[key])]));
}
function check() {
  const root = path.resolve(__dirname, '..');
  const compiler = process.env.BICEP_CLI || path.join(os.homedir(), '.azure/bin', process.platform === 'win32' ? 'bicep.exe' : 'bicep');
  const version = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
  assert.ifError(version.error);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^Bicep CLI version 0\.38\.33\b/, `Use pinned Bicep ${BICEP_VERSION}`);
  const result = spawnSync(compiler, ['build', path.join(root, 'infra/bicep/azuredeploy.bicep'), '--stdout'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), '', 'Bicep compilation must have no warnings');
  const committed = JSON.parse(fs.readFileSync(path.join(root, 'infra/azuredeploy.json'), 'utf8'));
  assert.deepEqual(normalize(committed), normalize(JSON.parse(result.stdout)), 'Committed Deploy to Azure ARM template is stale; rebuild with the pinned compiler');
  process.stdout.write(`Deploy to Azure template matches Bicep ${BICEP_VERSION}; no compilation warnings.\n`);
}
if (require.main === module) check();
module.exports = { normalize };
