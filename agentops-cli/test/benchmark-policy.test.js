const assert = require('node:assert/strict');
const test = require('node:test');

const {
  benchmarkAllowedToolPolicyViolations,
  benchmarkProfileAllowsBroadArgs,
  hasBroadPermissionArg,
  normalizeBenchmarkPermissionProfile,
  validateBenchmarkToolPolicy
} = require('../src/lib/benchmark-policy');

test('benchmark permission helpers normalize broad-arg policy', () => {
  assert.equal(normalizeBenchmarkPermissionProfile(), 'least-privilege');
  assert.equal(normalizeBenchmarkPermissionProfile(null), 'least-privilege');
  assert.equal(normalizeBenchmarkPermissionProfile(''), 'least-privilege');
  assert.equal(normalizeBenchmarkPermissionProfile('read-only'), 'read-only');

  assert.equal(benchmarkProfileAllowsBroadArgs('allow-all-isolated'), true);
  assert.equal(benchmarkProfileAllowsBroadArgs('least-privilege'), false);
  assert.equal(hasBroadPermissionArg(['--foo', '--allow-all']), true);
  assert.equal(hasBroadPermissionArg(['--foo', '--yolo']), true);
  assert.equal(hasBroadPermissionArg(['--foo']), false);
});

test('validateBenchmarkToolPolicy normalizes blocked risks', () => {
  assert.equal(validateBenchmarkToolPolicy(undefined), null);
  assert.equal(validateBenchmarkToolPolicy({}), null);
  assert.deepEqual(validateBenchmarkToolPolicy({ blockedRisks: ['network', 'browser-control', 'network', ' '] }), {
    blockedRisks: ['browser-control', 'network']
  });
});

test('validateBenchmarkToolPolicy rejects invalid policies', () => {
  assert.throws(
    () => validateBenchmarkToolPolicy(null, 'task.json'),
    /toolPolicy must be an object/
  );
  assert.throws(
    () => validateBenchmarkToolPolicy({ blockedRisks: ['network', 'unknown-risk'] }, 'task.json'),
    /toolPolicy\.blockedRisks must use known risks/
  );
});

test('benchmarkAllowedToolPolicyViolations deduplicates blocked allowed tools by risk', () => {
  const violations = benchmarkAllowedToolPolicyViolations(
    ['--allow-tool', 'web_fetch', '--allow-tool=write_file', '--allow-tool=web_fetch', '--allow-tool=read_file'],
    { blockedRisks: ['network', 'write-file'] }
  );

  assert.deepEqual(violations, [
    { name: 'web_fetch', risk: 'network' },
    { name: 'write_file', risk: 'write-file' }
  ]);
  assert.deepEqual(benchmarkAllowedToolPolicyViolations(['--allow-tool=web_fetch'], null), []);
});
