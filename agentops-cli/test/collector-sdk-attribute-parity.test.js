const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  attributesForContext,
  canonicalSdkAttributes,
  forbiddenContentAttributes,
  scriptOutcomeAttributes,
  strictCollectorFiles,
  syncStrictCollectorFiles
} = require('../../scripts/lib/strict-collector-attributes');

test('every strict collector path preserves the canonical safe SDK event attributes', () => {
  for (const file of strictCollectorFiles()) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const contexts = ['span', ...(/- context: log\n/.test(text) ? ['log'] : [])];
    for (const context of contexts) {
      const allowed = attributesForContext(text, context);
      assert.ok(allowed.length > 0, `${path.basename(file)} ${context}`);
      for (const attribute of canonicalSdkAttributes) {
        assert.ok(allowed.includes(attribute), `${path.basename(file)} ${context} drops ${attribute}`);
      }
      if (context === 'span') {
        for (const attribute of ['agentops.script.runtime.name', 'agentops.script.runtime.version', 'agentops.script.runtime.implementation', 'agentops.script.loader.name', 'gen_ai.tool.call.id']) {
          assert.ok(allowed.includes(attribute), `${path.basename(file)} ${context} drops ${attribute}`);
        }
        for (const attribute of scriptOutcomeAttributes) {
          assert.ok(allowed.includes(attribute), `${path.basename(file)} ${context} drops ${attribute}`);
        }
      }
      for (const forbidden of forbiddenContentAttributes) {
        assert.equal(allowed.includes(forbidden), false, `${path.basename(file)} ${context} allows ${forbidden}`);
      }
    }
  }
});

test('strict collector resource allowlists retain run and session correlation IDs', () => {
  for (const file of strictCollectorFiles()) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const resources = [...text.matchAll(/- context: resource\n[\s\S]*?- keep_keys\(attributes, (\[[^\n]+\])\)/g)];
    assert.ok(resources.length > 0, `${path.basename(file)} has resource allowlists`);
    for (const resource of resources) {
      const allowed = JSON.parse(resource[1]);
      assert.ok(allowed.includes('agentops.run.id'), `${path.basename(file)} resource keeps agentops.run.id`);
      assert.ok(allowed.includes('agentops.session.id'), `${path.basename(file)} resource keeps agentops.session.id`);
      for (const attribute of ['agentops.script.runtime.name', 'agentops.script.runtime.version', 'agentops.script.runtime.implementation', 'agentops.script.loader.name']) {
        assert.ok(allowed.includes(attribute), `${path.basename(file)} resource keeps ${attribute}`);
      }
    }
  }
});

test('strict collector attribute synchronization is idempotent', () => {
  assert.deepEqual(syncStrictCollectorFiles({ write: false }).changed, []);
});

test('strict collector span allowlists keep gen_ai.agent.name only behind the agent label guard', () => {
  const label = 'attributes["gen_ai.agent.name"]';
  const removeInvalid = `- delete_key(attributes, "gen_ai.agent.name") where ${label} != nil and (not IsString(${label}) or ${label} == "")`;
  const hashCustom = `- set(${label}, SHA256(${label})) where ${label} != nil and ${label} != "copilot" and ${label} != "copilotcli" and ${label} != "claude" and not IsMatch(${label}, "^[0-9a-f]{64}$")`;
  for (const file of strictCollectorFiles()) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const span = text.match(/- context: span\n[\s\S]*?- keep_keys\(attributes, \[[^\n]+\]\)/);
    assert.ok(span, `${path.basename(file)} has a span allowlist`);
    const block = span[0];
    const keep = block.lastIndexOf('- keep_keys(attributes, ');
    assert.ok(attributesForContext(text, 'span').includes('gen_ai.agent.name'), `${path.basename(file)} span keeps gen_ai.agent.name`);
    assert.ok(block.indexOf(removeInvalid) >= 0 && block.indexOf(removeInvalid) < keep, `${path.basename(file)} removes empty and non-string agent labels before keep_keys`);
    assert.ok(block.indexOf(hashCustom) > block.indexOf(removeInvalid) && block.indexOf(hashCustom) < keep, `${path.basename(file)} hashes custom agent labels before keep_keys`);
    for (const forbidden of forbiddenContentAttributes) {
      assert.equal(attributesForContext(text, 'span').includes(forbidden), false, `${path.basename(file)} span allows ${forbidden}`);
    }
  }
});
