const crypto = require('node:crypto');

function hashValue(value) {
  if (!value) return '';
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeGenAiAttributes(attributes = {}, defaults = {}) {
  const normalized = { ...attributes };
  const model = normalized['gen_ai.request.model']
    || normalized['gen_ai.response.model']
    || normalized['agentops.model.actual']
    || normalized['agentops.model.requested']
    || defaults.model
    || 'unknown';

  normalized['gen_ai.operation.name'] = normalized['gen_ai.operation.name'] || defaults.operation || 'chat';
  normalized['gen_ai.provider.name'] = normalized['gen_ai.provider.name'] || defaults.provider || 'github.copilot';
  normalized['gen_ai.conversation.id'] = normalized['gen_ai.conversation.id']
    || normalized['agentops.session.id']
    || normalized['agentops.run.id']
    || defaults.conversationId
    || '';
  normalized['gen_ai.request.model'] = normalized['gen_ai.request.model'] || model;

  if (normalized['agentops.repo.path'] && !normalized['agentops.repo.hash']) {
    normalized['agentops.repo.hash'] = hashValue(normalized['agentops.repo.path']);
    delete normalized['agentops.repo.path'];
  }

  return normalized;
}

module.exports = {
  hashValue,
  normalizeGenAiAttributes
};
