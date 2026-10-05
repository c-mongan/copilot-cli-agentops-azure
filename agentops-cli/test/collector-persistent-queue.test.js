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
  // Metric identity is retained only behind an exact name/type/unit gate.
  // The runnable real-Collector regression checks values and secret canaries.
  assert.doesNotMatch(config, /set\(name, "agentops\.metric"\)/);
  assert.match(config, /filter\/native_metrics:\n\s+error_mode: propagate/);
  assert.match(config, /\(name != "gen_ai\.client\.token\.usage" or type != METRIC_DATA_TYPE_HISTOGRAM or unit != "tokens"\)/);
  assert.match(config, /\(name != "gen_ai\.client\.operation\.duration" or type != METRIC_DATA_TYPE_HISTOGRAM or unit != "s"\)/);
  assert.match(config, /\(name != "github\.copilot\.tool\.call\.count" or type != METRIC_DATA_TYPE_SUM or unit != "calls"\)/);
  const gate = config.split('  filter/native_metrics:')[1].split('  batch:')[0];
  const instrumentNames = [...gate.matchAll(/\(name != "([^"]+)" or type != METRIC_DATA_TYPE_(?:HISTOGRAM|SUM) or unit != "[^"]+"\)/g)];
  assert.equal(instrumentNames.length, 14, 'Only the approved native instruments are accepted');
  assert.equal((gate.match(/\) and \(/g) || []).length, 13, 'Unknown names fail every pair and are dropped');
  for (const pipeline of ['metrics', 'metrics/receipt']) {
    const block = config.split('service:\n')[1].split(`    ${pipeline}:\n`)[1].split('    logs')[0];
    assert.match(block, /processors: \[[^\]]*filter\/native_metrics, transform\/privacy_strict/);
  }
  assert.match(config, /set\(description, ""\)/);
  assert.match(config, /Len\(exemplars\) > 0/);
  assert.match(config, /Len\(links\) > 0/);
  assert.equal((config.match(/set\(resource\.schema_url, ""\)/g) || []).length, 3);
  assert.equal((config.match(/set\(scope\.schema_url, ""\)/g) || []).length, 3);
  assert.equal((config.match(/keep_keys\(scope\.attributes, \[\]\)/g) || []).length, 3);
  assert.match(config, /set\(trace_state, ""\)/);
  assert.match(config, /set\(severity_text, ""\)/);
  assert.match(config, /set\(event_name, "agentops\.event"\)/);
});
