#!/usr/bin/env node
const { syncStrictCollectorFiles } = require('./lib/strict-collector-attributes');

const check = process.argv.includes('--check');
const result = syncStrictCollectorFiles({ write: !check });
if (check && result.changed.length) {
  process.stderr.write(`Strict collector attribute drift: ${result.changed.join(', ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
