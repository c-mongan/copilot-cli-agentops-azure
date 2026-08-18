const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('remaining command libraries expose command entrypoints and helpers', () => {
  const { collectorCommand, renderCollector } = require('../src/lib/collector-command');
  const { e2eCommand } = require('../src/lib/e2e-command');
  const { runSummaryCommand } = require('../src/lib/run-summary-command');
  const { dashboardCommand } = require('../src/lib/dashboard-command');
  const { productCommand, productAuditWithVisual } = require('../src/lib/product-command');
  const { securityCommand, renderSecurityAudit } = require('../src/lib/security-command');
  const { explainCommand, hasV2Args } = require('../src/lib/explain-command');
  const { githubEnrichCommand } = require('../src/lib/github-enrich-command');
  const { askContextCommand, legacyAskContext } = require('../src/lib/ask-context-command');
  const { contentCommand } = require('../src/lib/content-command');
  const { mcpProxyCommand, splitCommand } = require('../src/lib/mcp-proxy-command');
  const { openCommand } = require('../src/lib/open-command');
  const { schemaCommand } = require('../src/lib/schema-command');
  const { doctorCommand } = require('../src/lib/doctor-command');
  const { healthCommand } = require('../src/lib/health-command');
  const { statusCommand } = require('../src/lib/status-command');

  assert.equal(typeof collectorCommand, 'function');
  assert.equal(typeof renderCollector, 'function');
  assert.equal(typeof e2eCommand, 'function');
  assert.equal(typeof runSummaryCommand, 'function');
  assert.equal(typeof dashboardCommand, 'function');
  assert.equal(typeof productCommand, 'function');
  assert.equal(typeof productAuditWithVisual, 'function');
  assert.equal(typeof securityCommand, 'function');
  assert.equal(typeof renderSecurityAudit, 'function');
  assert.equal(typeof explainCommand, 'function');
  assert.equal(typeof hasV2Args, 'function');
  assert.equal(typeof githubEnrichCommand, 'function');
  assert.equal(typeof askContextCommand, 'function');
  assert.equal(typeof legacyAskContext, 'function');
  assert.equal(typeof contentCommand, 'function');
  assert.equal(typeof mcpProxyCommand, 'function');
  assert.equal(typeof splitCommand, 'function');
  assert.equal(typeof openCommand, 'function');
  assert.equal(typeof schemaCommand, 'function');
  assert.equal(typeof doctorCommand, 'function');
  assert.equal(typeof healthCommand, 'function');
  assert.equal(typeof statusCommand, 'function');
});

test('doctor command uses shared option parsing helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'doctor-command.js'), 'utf8');
  assert.doesNotMatch(source, /function valueAfter\(/);
});
