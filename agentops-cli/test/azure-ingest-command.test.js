const assert = require('node:assert/strict');
const test = require('node:test');

const {
  azureIngestCommand,
  runLogsIngestionUpload
} = require('../src/lib/azure-ingest-command');

test('azure ingest command library preserves command and upload exports', () => {
  assert.equal(typeof azureIngestCommand, 'function');
  assert.equal(typeof runLogsIngestionUpload, 'function');
  assert.throws(() => azureIngestCommand(['unknown']), /azure-ingest supports/);
});
