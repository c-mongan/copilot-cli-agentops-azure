const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { generateDemoData, writeDemoData } = require('../src/lib/demo/agentops-demo-data');
const { buildContentStatus, captureModeSummary, renderContentStatus, renderOptInGuide } = require('../src/lib/content-status');

test('content status library builds opt-in status and renderer output', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-lib-'));
  try {
    const demo = generateDemoData({ runs: 2, withContent: true });
    writeDemoData(demo, tempDir);

    const blocked = buildContentStatus({ dir: tempDir, allowContent: false });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.content_rows, 4);
    assert.deepEqual(blocked.capture_modes, { redacted: 4 });
    assert.match(blocked.transcript_viewer_url, /viewPanel=26/);

    const rendered = renderContentStatus(blocked);
    assert.match(rendered, /AgentOps content capture status/);
    assert.match(rendered, /Allowed for ingest: no/);

    assert.deepEqual(captureModeSummary([{ CaptureMode: 'full' }, {}, { CaptureMode: 'full' }]), {
      full: 2,
      unknown: 1
    });
    assert.match(renderOptInGuide(), /restricted to approved viewers/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
