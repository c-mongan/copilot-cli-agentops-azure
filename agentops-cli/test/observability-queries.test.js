const assert = require('node:assert/strict');
const test = require('node:test');

const { logAnalyticsTargetWarning } = require('../src/lib/observability-queries');

test('logAnalyticsTargetWarning accepts a Log Analytics workspace GUID', () => {
  assert.equal(logAnalyticsTargetWarning('11111111-2222-3333-4444-555555555555'), null);
});

test('logAnalyticsTargetWarning flags an Azure Data Explorer Kusto cluster URI as the wrong target', () => {
  const warning = logAnalyticsTargetWarning('https://mycluster.kusto.windows.net');
  assert.match(warning, /Azure Data Explorer Kusto cluster URI/);
  assert.match(warning, /not an ADX cluster endpoint/);
});

test('logAnalyticsTargetWarning flags any non-GUID target as suspect', () => {
  const warning = logAnalyticsTargetWarning('my-adx-database');
  assert.match(warning, /does not look like a Log Analytics workspace ID/);
});

test('logAnalyticsTargetWarning flags a missing workspace id', () => {
  const warning = logAnalyticsTargetWarning('');
  assert.match(warning, /No Log Analytics workspace ID is configured/);
});
