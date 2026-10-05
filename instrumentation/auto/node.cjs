/* Explicit early-start preload. Resolve packages from the approved project. */
'use strict';
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const root = fs.realpathSync(process.env.AGENTOPS_AUTO_PROJECT_ROOT || '');
const entry = fs.realpathSync(process.argv[1]);
const relative = path.relative(root, entry);
if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('AgentOps entry outside approved project');
const local = createRequire(path.join(root, 'package.json'));
const { NodeSDK } = local('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = local('@opentelemetry/exporter-trace-otlp-proto');
const { getNodeAutoInstrumentations } = local('@opentelemetry/auto-instrumentations-node');
const { resourceFromAttributes } = local('@opentelemetry/resources');
const sdk = new NodeSDK({
  autoDetectResources: false,
  resource: resourceFromAttributes({ 'service.name': 'agentops.project', 'agentops.run.id': String(process.env.OTEL_RESOURCE_ATTRIBUTES || '').replace(/^agentops.run.id=/, '') }),
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, headers: {} }),
  metricReaders: [], logRecordProcessors: [],
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false }
  })]
});
sdk.start();
// Patch core HTTP before ESM binds its exports.
require("node:http");
require("node:https");
require("node:module").syncBuiltinESMExports();
// beforeExit preserves natural termination while giving batched spans time to flush.
let stopping = false;
process.on('beforeExit', () => {
  if (stopping) return;
  stopping = true;
  sdk.shutdown().catch(() => { process.stderr.write('AgentOps library trace flush failed\n'); });
});
