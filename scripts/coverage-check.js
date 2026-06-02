#!/usr/bin/env node

const childProcess = require('node:child_process');

const threshold = Number(process.env.AGENTOPS_COVERAGE_LINES || 80);
const result = childProcess.spawnSync(process.execPath, [
  '--test',
  '--experimental-test-coverage'
], {
  cwd: process.cwd(),
  encoding: 'utf8'
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  process.exitCode = result.status || 1;
  return;
}

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const match = output.match(/all files\s+\|\s+([0-9.]+)/i);
if (!match) {
  process.stderr.write('Unable to find all-files line coverage in Node test output.\n');
  process.exitCode = 1;
  return;
}

const lineCoverage = Number(match[1]);
if (!Number.isFinite(lineCoverage) || lineCoverage < threshold) {
  process.stderr.write(`Line coverage ${lineCoverage}% is below required ${threshold}%.\n`);
  process.exitCode = 1;
  return;
}

process.stdout.write(`Line coverage ${lineCoverage}% meets required ${threshold}%.\n`);
