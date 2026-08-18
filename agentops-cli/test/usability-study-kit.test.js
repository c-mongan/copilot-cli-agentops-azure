const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const protocolPath = path.join(root, 'docs', 'usability-study-kit.md');
const schemaPath = path.join(root, 'docs', 'usability-study-evidence.schema.json');

test('usability protocol covers the canonical first-run and primary-view tasks without claiming results', () => {
  const protocol = fs.readFileSync(protocolPath, 'utf8');

  for (const command of ['agentops init --full', 'agentops init --full --yes', 'agentops copilot']) {
    assert.match(protocol, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const surface of ['Today', 'Runs', 'Run Story', 'Privacy']) {
    assert.match(protocol, new RegExp(`### Task [0-9]+: .*${surface}|### Task [0-9]+: [^\n]*`, 'i'));
    assert.match(protocol, new RegExp(surface, 'i'));
  }
  for (const evidence of ['start and end timestamps', 'elapsed milliseconds', 'help requests', 'error categories']) {
    assert.match(protocol, new RegExp(evidence, 'i'));
  }
  assert.match(protocol, /No participant results are included/i);
  assert.match(protocol, /does not prove human usability/i);
  assert.match(protocol, /Do not record prompts, terminal output, code, tool arguments, tool results/i);
  assert.match(protocol, /SUS-style/i);
});

test('usability evidence schema requires real consent and metadata-only structured outcomes', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  assert.equal(schema.properties.human_participant.const, true);
  assert.equal(schema.properties.consent_confirmed.const, true);
  assert.equal(schema.properties.environment.properties.privacy_mode.const, 'strict');
  assert.equal(schema.properties.environment.properties.content_capture.const, 'off');
  assert.equal(schema.properties.tasks.minItems, 7);
  assert.equal(schema.properties.tasks.maxItems, 7);
  assert.equal(schema.properties.tasks.prefixItems.length, 7);
  assert.equal(schema.properties.tasks.items, false);
  assert.equal(schema.properties.privacy_comprehension.minItems, 6);
  assert.equal(schema.properties.privacy_comprehension.maxItems, 6);
  assert.equal(schema.properties.privacy_comprehension.prefixItems.length, 6);
  assert.equal(schema.properties.privacy_comprehension.items, false);
  assert.equal(schema.$defs.task.additionalProperties, false);
  assert.equal(schema.$defs.privacyAnswer.additionalProperties, false);

  const serialized = JSON.stringify(schema).toLowerCase();
  for (const forbidden of ['prompt_text', 'terminal_output', 'tool_arguments', 'tool_results', 'email', 'participant_name']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not be an evidence field`);
  }
});
