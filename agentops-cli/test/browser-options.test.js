const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { browserProfileOptionsFromArgs, browserProfileRuntimeDefaults } = require('../src/lib/browser-options');

test('browser options helper parses profile args and env defaults', () => {
  const env = {
    AGENTOPS_BROWSER_EXECUTABLE: '/env/chrome',
    AGENTOPS_BROWSER_USER_DATA_DIR: '/env/profile',
    AGENTOPS_BROWSER_STORAGE_STATE: '/env/storage.json',
    AGENTOPS_BROWSER_HEADED: '0'
  };

  assert.deepEqual(browserProfileOptionsFromArgs([], env), {
    browserExecutable: '/env/chrome',
    browserUserDataDir: '/env/profile',
    storageState: '/env/storage.json',
    headed: false,
    azureCliGrafanaAuth: false
  });
  assert.deepEqual(browserProfileOptionsFromArgs([
    '--browser-executable', '/arg/chrome',
    '--browser-user-data-dir', '/arg/profile',
    '--storage-state', '/arg/storage.json',
    '--headed',
    '--azure-cli-grafana-auth'
  ], env), {
    browserExecutable: '/arg/chrome',
    browserUserDataDir: '/arg/profile',
    storageState: '/arg/storage.json',
    headed: true,
    azureCliGrafanaAuth: true
  });
  assert.deepEqual(browserProfileRuntimeDefaults(env), {
    browserExecutable: '/env/chrome',
    browserUserDataDir: '/env/profile',
    storageState: '/env/storage.json',
    headed: false,
    azureCliGrafanaAuth: false
  });

  for (const file of ['e2e-grafana.js', 'e2e-playwright.js', 'product-command.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8');
    assert.doesNotMatch(source, /AGENTOPS_BROWSER_EXECUTABLE|AGENTOPS_BROWSER_USER_DATA_DIR|AGENTOPS_BROWSER_STORAGE_STATE|AGENTOPS_BROWSER_HEADED/, file);
  }
});
