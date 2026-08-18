const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createLocalStatus } = require('../src/lib/local-status');

test('plain Copilot shadow must actually invoke AgentOps', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-shadow-status-'));
  const shadow = path.join(tempDir, 'copilot');
  const status = createLocalStatus({ root: path.resolve(__dirname, '..', '..'), defaultInstallDir: tempDir });

  try {
    fs.writeFileSync(shadow, '#!/usr/bin/env bash\nexport COPILOT_CLI_BIN="/opt/bin/copilot"\nexec "$COPILOT_CLI_BIN" "$@"\n');
    assert.equal(status.shadowObservesCopilot(shadow), false);

    fs.writeFileSync(shadow, '#!/usr/bin/env bash\nexec "/repo/scripts/copilot-agentops" "$@"\n');
    assert.equal(status.shadowObservesCopilot(shadow), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
