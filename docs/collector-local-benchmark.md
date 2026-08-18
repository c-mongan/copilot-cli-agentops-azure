# Local strict collector performance benchmark

Run:

```bash
node scripts/benchmark-collector-local.js
```

The benchmark starts the installed `otelcol-contrib` with the processor block copied at runtime from `collector/otelcol.local.strict.yaml`. It sends synthetic metadata over loopback OTLP/HTTP and uses a temporary loopback OTLP/HTTP sink. No Azure exporter, connection string, content, prompt, completion, tool payload, or external network destination is configured.

It reports p50 and p95 for two related observations:

- receiver acknowledgement: elapsed time until the collector accepts the OTLP request after the receiver and processor pipeline;
- local sink acknowledgement: elapsed time until the temporary local exporter sink receives and acknowledges that event.

The default is 10 warm-up events and 100 sequential measured events. Inputs are hard-capped at 500 so the test stays bounded:

```bash
AGENTOPS_COLLECTOR_BENCH_WARMUP=25 \
AGENTOPS_COLLECTOR_BENCH_EVENTS=250 \
node scripts/benchmark-collector-local.js
```

The benchmark also verifies that an allowlisted event ID reaches the sink and a synthetic disallowed metadata field does not. It does not inject or capture user content.

Results are descriptive and have no approved threshold. They include loopback HTTP, collector processing, batching, and a local sink. They do not measure SDK capture, WAN latency, Azure Monitor ingestion, KQL availability, Grafana rendering, or end-user latency. Compare results only with the same collector version, hardware, workload settings, and machine power state.
