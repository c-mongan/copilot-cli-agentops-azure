const crypto = require('node:crypto');
const path = require('node:path');

const { optionValue } = require('../args');
const { summarizeAllowedTools } = require('./tool-classifier');

function stableHash(value, prefix = 'hash') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`;
}

function booleanFlag(args, name) {
  return args.includes(name);
}

function promptValue(args = []) {
  return optionValue(args, ['-p', '--prompt'], '');
}

function createRunMetadata(args = [], options = {}) {
  const now = options.now || new Date().toISOString();
  const cwd = options.cwd || process.cwd();
  const prompt = promptValue(args);
  const mode = optionValue(args, '--mode', optionValue(args, '--copilot-mode', 'default'));
  const model = optionValue(args, '--model', '');
  const allowedTools = summarizeAllowedTools(args);

  return {
    schemaVersion: '2',
    runId: options.runId || stableHash(`${now}:${cwd}:${args.join('\0')}`, 'run'),
    sessionId: options.sessionId || '',
    surface: 'cli',
    startedAt: now,
    privacyMode: options.privacyMode || process.env.AGENTOPS_PRIVACY_MODE || 'strict',
    contentCaptureMode: 'off',
    promptHash: prompt ? stableHash(prompt, 'prompt') : '',
    promptSizeBytes: Buffer.byteLength(prompt || '', 'utf8'),
    commandHash: stableHash(args.join('\0'), 'cmd'),
    repoHash: stableHash(options.repo || cwd, 'repo'),
    workspaceHash: stableHash(path.resolve(cwd), 'workspace'),
    modelRequested: model,
    mode,
    remote: !booleanFlag(args, '--no-remote'),
    allowAllTools: booleanFlag(args, '--allow-all-tools'),
    allowToolCount: allowedTools.count,
    allowedToolRisks: allowedTools.risks,
    testsRequested: args.some(arg => /test|lint|typecheck/i.test(arg))
  };
}

module.exports = {
  createRunMetadata,
  promptValue,
  stableHash
};
