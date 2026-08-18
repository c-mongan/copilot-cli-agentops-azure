const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const azureConfigs = [
  'collector/otelcol.binary.strict.yaml',
  'collector/otelcol.binary.compat.yaml',
  'collector/otelcol.azuremonitor.strict.yaml',
  'collector/otelcol.azuremonitor.compat.yaml',
  'collector/otelcol.azuremonitor.yaml'
];

test('every Azure Monitor collector path uses a bounded persistent sending queue', () => {
  for (const relative of azureConfigs) {
    const config = fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
    assert.match(config, /file_storage:/, `${relative} needs file storage`);
    assert.match(config, /directory: \$\{env:AGENTOPS_OTEL_STORAGE_DIR\}/, `${relative} needs explicit storage location`);
    assert.match(config, /sending_queue:\n\s+enabled: true\n\s+storage: file_storage\n\s+queue_size: 1000/, `${relative} needs bounded persistent queue`);
    assert.match(config, /extensions: \[health_check, file_storage\]/, `${relative} must start file storage`);
  }
});

test('Docker Azure collector persists the queue outside the container', () => {
  const compose = fs.readFileSync(path.join(root, 'collector', 'docker-compose.azuremonitor.yaml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(compose, /AGENTOPS_OTEL_STORAGE_DIR: \/var\/lib\/agentops\/queue/);
  assert.match(compose, /agentops-otel-queue:\/var\/lib\/agentops\/queue/);
});

test('Native Azure preview overlays the strict local privacy config without duplicating it', () => {
  const base = fs.readFileSync(path.join(root, 'collector', 'otelcol.local.strict.yaml'), 'utf8').replace(/\r\n/g, '\n');
  const overlay = fs.readFileSync(path.join(root, 'collector', 'otelcol.azuremonitor.native.strict.yaml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(base, /error_mode: propagate/);
  assert.match(base, /sending_queue:\n\s+enabled: true\n\s+storage: file_storage\n\s+queue_size: 1000/);
  assert.match(overlay, /azure_auth:/);
  assert.match(overlay, /use_default: true/);
  assert.match(overlay, /otlp_http\/azuremonitor:/);
  assert.match(overlay, /AZURE_MONITOR_OTLP_TRACES_ENDPOINT/);
  assert.match(overlay, /AZURE_MONITOR_OTLP_LOGS_ENDPOINT/);
  assert.match(overlay, /AZURE_MONITOR_OTLP_METRICS_ENDPOINT/);
  assert.match(overlay, /storage: file_storage/);
  assert.match(overlay, /otelcol\.local\.strict\.yaml/);
});

test('strict local privacy config clears signal-level content fields before export', () => {
  const config = fs.readFileSync(path.join(root, 'collector', 'otelcol.local.strict.yaml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(config, /set\(name, "agentops\.span"\) where name != nil/);
  assert.match(config, /set\(status\.message, "redacted by AgentOps strict privacy mode"\)/);
  assert.match(config, /set\(name, "agentops\.event"\) where name != nil/);
  assert.match(config, /set\(name, "agentops\.metric"\) where name != nil/);
});
