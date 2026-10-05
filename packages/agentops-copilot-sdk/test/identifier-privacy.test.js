const test = require('node:test');
const assert = require('node:assert/strict');
const { createSafeEventNormalizer } = require('../src/event-envelope');

test('model and provider identifiers admit ordinary names', () => {
  const event = createSafeEventNormalizer()({
    EventName: 'model.call', ModelRequested: 'gpt-4.1', ModelActual: 'anthropic/claude-sonnet-4.5:0', Provider: 'azure-openai'
  });
  assert.equal(event.ModelRequested, 'gpt-4.1');
  assert.equal(event.ModelActual, 'anthropic/claude-sonnet-4.5:0');
  assert.equal(event.Provider, 'azure-openai');
});

test('credential-bearing model and provider values are dropped before export', () => {
  const poison = [
    'https://user:hunter2@example.invalid/v1/models/gpt-4',
    'gpt-4?api_key=sk-test-123',
    'api_key=sk-live-abcdef',
    'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x',
    'model token=abc',
    'x'.repeat(200)
  ];
  const normalize = createSafeEventNormalizer();
  for (const value of poison) {
    const event = normalize({ EventName: 'model.call', ModelRequested: value, ModelActual: value, Provider: value });
    for (const field of ['ModelRequested', 'ModelActual', 'Provider']) {
      assert.equal(field in event, false, `${field} retained poison value ${JSON.stringify(value.slice(0, 40))}`);
    }
    assert.doesNotMatch(JSON.stringify(event), /hunter2|sk-|eyJ|token=/);
  }
});
