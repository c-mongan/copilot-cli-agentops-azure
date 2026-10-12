'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createDemo } = require('../start-ui-demo');
const { createUiServer } = require('../../agentops-cli/src/lib/ui/server');

test('synthetic demo uses the actual UI and preserves failure versus denial semantics', async () => {
  const demo = createDemo();
  const server = createUiServer({ copilotHome: demo.copilotHome, agentOpsHome: demo.agentOpsHome, allowContent: false });
  try {
    const { url } = await server.listen(0);
    const response = await fetch(`${url}api/runs`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.runs.length, 3);
    assert.equal(body.allowContent, false);
    assert.deepEqual(body.runs.map(run => run.status), ['attention', 'failed', 'ok']);
    assert.ok(body.runs.every(run => run.repo.name.startsWith('synthetic-demo-')));
    assert.equal(body.runs[0].denials, 1);
    assert.equal(body.runs[0].failures, 0);
    assert.equal(body.runs[0].p95ToolMs, 12000);
    assert.equal(body.runs[1].failures, 1);
  } finally {
    await server.close();
    demo.cleanup();
  }
  assert.equal(fs.existsSync(demo.root), false);
});
