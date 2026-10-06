#!/usr/bin/env node
'use strict';

// Metadata inspection only. Importing this module never starts a runtime.
const fs = require('node:fs');
const path = require('node:path');
const libraryRoot = fs.existsSync(path.join(__dirname, '..', 'agentops-cli', 'src', 'lib', 'copilot-resolver.js'))
  ? path.join(__dirname, '..', 'agentops-cli', 'src', 'lib')
  : path.join(__dirname, '..', 'src', 'lib');
const { resolveCopilotBinary } = require(path.join(libraryRoot, 'copilot-resolver'));

const PINS = Object.freeze({ nativeCli: '1.0.91', sdk: '1.0.16', vallyCli: '0.17.0', vally: '0.17.0', vallyRuntimeCli: '1.0.85', vallySdk: '1.0.14' });
const SUPPORT = Object.freeze({
  node: ['node script.js', 'node script.cjs', 'node script.mjs'],
  python: ['python script.py', 'python3 script.py'],
  unsupported: ['python -m module', 'python -c code', 'python -I script.py', 'python -S script.py', 'python [options] script.py', 'node -e code', 'node -p code', 'node --loader loader script', 'node --import loader script', 'tsx script.ts', 'ts-node script.ts', 'TypeScript/JSX/TSX loaders'],
  windows: 'Direct child lifecycle tests are runnable; POSIX process-group tests skip. Python PATH wrapper and descendant cleanup parity remain unqualified.'
});

function packageMetadata(directory, expectedName, pin) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (manifest.name !== expectedName) return { state: 'unknown', reason: 'package identity differs', pin };
    return { state: manifest.version === pin ? 'matches_pin' : 'version_mismatch', version: manifest.version, pin, packagePath: path.join(directory, 'package.json') };
  } catch { return { state: 'unavailable', pin }; }
}

function readRuntimeQualification({ root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  const harness = path.join(root, 'evals', 'stockpilot', 'node_modules');
  const cli = resolveCopilotBinary({ env });
  return {
    schemaVersion: 1,
    qualification: 'metadata_only',
    host: { platform: process.platform, architecture: process.arch, node: process.version, nodeMinimumMet: Number(process.versions.node.split('.')[0]) >= 20, windowsExecution: process.platform === 'win32' ? 'available_for_local_tests' : 'unavailable_on_this_host' },
    pins: PINS,
    components: {
      nativeCli: { state: cli.ok ? 'resolved_version_unverified' : 'unavailable', path: cli.path, pin: PINS.nativeCli },
      sdk: packageMetadata(path.join(root, 'packages', 'agentops-copilot-sdk', 'node_modules', '@github', 'copilot-sdk'), '@github/copilot-sdk', PINS.sdk),
      vallyCli: packageMetadata(path.join(harness, '@microsoft', 'vally-cli'), '@microsoft/vally-cli', PINS.vallyCli),
      vally: packageMetadata(path.join(harness, '@microsoft', 'vally'), '@microsoft/vally', PINS.vally),
      vallyRuntimeCli: packageMetadata(path.join(harness, '@github', 'copilot'), '@github/copilot', PINS.vallyRuntimeCli),
      vallySdk: packageMetadata(path.join(harness, '@github', 'copilot-sdk'), '@github/copilot-sdk', PINS.vallySdk)
    },
    support: SUPPORT,
    limitations: ['Metadata agreement does not prove execution, telemetry delivery, model behavior, SDK/CLI compatibility or Windows parity.', 'No installs, network calls, models, Collector launch, cloud writes or configuration changes occur.']
  };
}

function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: node scripts/check-runtime-matrix.js [--json]\nRead-only local runtime metadata. Missing components remain explicit; no runtimes are launched.\n');
    return;
  }
  if (args.some(argument => argument !== '--json')) throw new Error('Supported options: --json, --help');
  process.stdout.write(`${JSON.stringify(readRuntimeQualification(), null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { PINS, SUPPORT, readRuntimeQualification, main };
