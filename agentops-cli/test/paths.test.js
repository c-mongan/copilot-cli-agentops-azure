const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { defaultUserAgentOpsPath } = require('../src/lib/paths');

test('paths helper owns default user AgentOps file paths', () => {
  assert.equal(defaultUserAgentOpsPath('config.json', '/home/example'), path.join('/home/example', '.agentops', 'config.json'));
  assert.equal(defaultUserAgentOpsPath('nested/file.json', '/home/example'), path.join('/home/example', '.agentops', 'nested/file.json'));

  for (const file of ['agentops-config.js', 'legacy-runtime.js', 'recommendation-store.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8');
    assert.doesNotMatch(source, /path\.join\(os\.homedir\(\), '\.agentops'/, file);
  }
});
