const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  demoOptionsFromArgs,
  demoVerifyOutputPlan,
  parseRuns
} = require('../src/lib/demo-command');

test('demo command library parses run counts and scenario flags', () => {
  assert.equal(parseRuns('12'), 12);
  assert.throws(() => parseRuns('0'), /--runs must be an integer between 1 and 1000/);
  assert.deepEqual(demoOptionsFromArgs(['--without-failures', '--with-content']), {
    withFailures: false,
    withPrivacyDrops: true,
    withGithubOutcomes: true,
    withContent: true
  });
  assert.throws(
    () => demoOptionsFromArgs(['--with-github-outcomes', '--without-github-outcomes']),
    /either --with-github-outcomes or --without-github-outcomes/
  );
});

test('demo verification is workspace-read-only unless persistent output is explicit', () => {
  const preview = demoVerifyOutputPlan([], { repoRoot: '/repo', tempRoot: os.tmpdir() });
  assert.equal(preview.writeArtifacts, false);
  assert.equal(preview.artifactMode, 'temporary');
  assert.match(preview.outDir, /agentops-demo-verify-/);
  assert.throws(
    () => demoVerifyOutputPlan(['--out', '/repo/demo']),
    /output paths require --write/
  );

  const persistent = demoVerifyOutputPlan(['--write', '--out', '/repo/demo', '--insights-out', '/repo/insights'], {
    repoRoot: '/repo',
    tempRoot: os.tmpdir()
  });
  assert.equal(persistent.writeArtifacts, true);
  assert.equal(persistent.artifactMode, 'persistent');
  assert.equal(persistent.outDir, path.resolve('/repo/demo'));
  assert.equal(persistent.insightsOutDir, path.resolve('/repo/insights'));
});
