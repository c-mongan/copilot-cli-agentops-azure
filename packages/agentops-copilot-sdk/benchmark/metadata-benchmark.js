#!/usr/bin/env node
'use strict';

const { createAgentOpsSessionObserver, createOtlpJsonExporter } = require('../src');

const DEFAULT_EVENTS = 1000;
const DEFAULT_WARMUP = 100;
const MAX_EVENTS = 10000;

function positiveInteger(value, fallback, maximum = MAX_EVENTS) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[rank];
}

function milliseconds(nanoseconds) {
  return Number((nanoseconds / 1e6).toFixed(6));
}

function summarize(latenciesNs, elapsedNs, count) {
  const seconds = elapsedNs / 1e9;
  return {
    events: count,
    latency_ms: {
      p50: milliseconds(percentile(latenciesNs, 0.50)),
      p95: milliseconds(percentile(latenciesNs, 0.95))
    },
    elapsed_ms: milliseconds(elapsedNs),
    throughput_events_per_second: seconds > 0 ? Number((count / seconds).toFixed(2)) : 0
  };
}

function syntheticEvent(index) {
  return {
    id: `benchmark-event-${index}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)).toISOString(),
    type: 'assistant.usage',
    data: {
      model: 'benchmark-model',
      inputTokens: 100 + (index % 10),
      outputTokens: 10 + (index % 3),
      totalTokens: 110 + (index % 10),
      durationMs: 25 + (index % 5)
    }
  };
}

function syntheticRow(index) {
  return {
    TimeGenerated: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)).toISOString(),
    EventId: `benchmark-event-${index}`,
    RunId: 'benchmark-run',
    SessionId: 'benchmark-session',
    TraceId: 'benchmark-trace',
    EventName: 'assistant.usage',
    Surface: 'sdk',
    PrivacyMode: 'strict',
    ContentCaptureMode: 'off',
    ModelActual: 'benchmark-model',
    InputTokens: 100 + (index % 10),
    OutputTokens: 10 + (index % 3)
  };
}

async function runBenchmark(options = {}) {
  const events = positiveInteger(options.events, DEFAULT_EVENTS);
  const warmup = positiveInteger(options.warmup, DEFAULT_WARMUP);
  const nowNs = options.nowNs || (() => Number(process.hrtime.bigint()));
  const fetchImpl = options.fetchImpl || (async () => ({ ok: true, status: 200 }));

  let captured = 0;
  const observer = createAgentOpsSessionObserver({
    runId: 'benchmark-run',
    sessionId: 'benchmark-session',
    traceId: 'benchmark-trace',
    emit: () => { captured += 1; }
  });
  for (let index = 0; index < warmup; index += 1) observer.observe(syntheticEvent(index));
  captured = 0;

  const captureLatencies = [];
  const captureStart = nowNs();
  for (let index = 0; index < events; index += 1) {
    const started = nowNs();
    observer.observe(syntheticEvent(index + warmup));
    captureLatencies.push(Math.max(0, nowNs() - started));
  }
  const captureElapsed = Math.max(0, nowNs() - captureStart);

  const previousFetch = global.fetch;
  const exportLatencies = [];
  let requests = 0;
  global.fetch = async (...args) => {
    requests += 1;
    return fetchImpl(...args);
  };
  let exportSummary;
  try {
    const exporter = createOtlpJsonExporter({
      otlpEndpoint: 'http://127.0.0.1:4318',
      maxAttempts: 1,
      maxPendingEvents: events
    });
    const exportStart = nowNs();
    for (let index = 0; index < events; index += 1) {
      const started = nowNs();
      exporter.emit(syntheticRow(index));
      exportLatencies.push(Math.max(0, nowNs() - started));
    }
    await exporter.flush();
    const exportElapsed = Math.max(0, nowNs() - exportStart);
    exportSummary = {
      ...summarize(exportLatencies, exportElapsed, events),
      requests,
      delivery: exporter.deliveryStatus()
    };
  } finally {
    global.fetch = previousFetch;
  }

  return {
    benchmark: 'agentops-copilot-sdk-metadata-only',
    methodology: {
      transport: 'in-process successful OTLP HTTP mock; no network or Azure writes',
      content_capture: 'off',
      thresholds: 'none; measurements are descriptive',
      events,
      warmup_events: warmup
    },
    capture: { ...summarize(captureLatencies, captureElapsed, events), observed_events: captured },
    export: exportSummary
  };
}

if (require.main === module) {
  runBenchmark({
    events: positiveInteger(process.env.AGENTOPS_BENCH_EVENTS, DEFAULT_EVENTS),
    warmup: positiveInteger(process.env.AGENTOPS_BENCH_WARMUP, DEFAULT_WARMUP)
  }).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`), error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { percentile, positiveInteger, runBenchmark, summarize };
