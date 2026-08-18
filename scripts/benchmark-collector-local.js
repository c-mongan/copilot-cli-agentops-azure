#!/usr/bin/env node
'use strict';

const { runCollectorBenchmark } = require('../agentops-cli/src/lib/collector-benchmark');

runCollectorBenchmark({
  events: process.env.AGENTOPS_COLLECTOR_BENCH_EVENTS,
  warmup: process.env.AGENTOPS_COLLECTOR_BENCH_WARMUP
}).then(report => {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}, error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
