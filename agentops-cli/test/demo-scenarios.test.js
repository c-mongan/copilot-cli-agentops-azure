const assert = require('node:assert/strict');
const test = require('node:test');

const { baseScenarios, chooseScenarios, contextProfile } = require('../src/lib/demo/agentops-demo-scenarios');

test('demo scenario helpers filter optional scenario families', () => {
  assert.ok(baseScenarios.some(scenario => scenario.status === 'failed'));
  assert.ok(baseScenarios.some(scenario => scenario.privacyDrops));
  assert.ok(baseScenarios.some(scenario => scenario.github.opened));

  assert.equal(chooseScenarios({ withFailures: false }).some(scenario => scenario.status === 'failed'), false);
  assert.equal(chooseScenarios({ withPrivacyDrops: false }).some(scenario => scenario.privacyDrops), false);
  assert.equal(chooseScenarios({ withGithubOutcomes: false }).some(scenario => scenario.github.opened), false);
});

test('demo scenario helpers return deterministic context profiles', () => {
  const expensive = contextProfile({ name: 'expensive-failed-run' }, 0);
  assert.equal(expensive.ContextWindowPct, 94);
  assert.equal(expensive.CacheReadTokens, 25000);
  assert.equal(expensive.PermissionWaitMs, 18000);

  const fallback = contextProfile({ name: 'new-scenario' }, 2);
  assert.equal(fallback.ContextWindowPct, 46);
  assert.equal(fallback.CacheReadTokens, 3726);
  assert.equal(fallback.CacheCreationTokens, 758);
});
