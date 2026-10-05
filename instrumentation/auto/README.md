# Scoped library tracing

This module adds early startup tracing for an **approved project process**. It uses the project's installed OpenTelemetry packages. It does not install packages, change shell profiles, replace `sitecustomize`, or inject code into other processes.

```text
Approved entry + selected interpreter + installed OTel packages
                         |
                  early bootstrap
                         |
              supported library operations
                         |
              loopback HTTP/protobuf
                         |
          local Collector filter -> approved storage
```

## Companion integration

`plan.cjs` exports `prepareAutoInstrumentation(options)`:

```js
const { prepareAutoInstrumentation } = require('./plan.cjs');
const plan = prepareAutoInstrumentation({
  runtime: 'node', // or python
  executable: '/absolute/path/to/node',
  projectRoot: '/absolute/path/to/project',
  entry: '/absolute/path/to/project/app.cjs',
  args: ['an argument'],
  endpoint: 'http://127.0.0.1:4318',
  runId: 'approved-run',
  mode: 'cjs' // or esm for JavaScript
});
// Only after project consent and plan.supported:
// spawn(plan.command, plan.args, {
//   cwd: plan.cwd, env: { ...process.env, ...plan.env }, shell: false
// });
```

The result contains `supported`, `command`, `args`, `cwd`, an environment overlay, `requirements`, and `limitations`. A missing package returns `supported: false`. The companion must show these requirements and must not run an unsupported plan. Dependency probes use the selected executable. The entry and executable must be absolute paths. A resolved entry must be inside the approved project. Arguments are passed as an array. No shell command is rewritten.

Preserve the selected Python executable path. A virtual environment executable can be a symlink. Replacing its path with the resolved base interpreter would lose the selected environment.

Each process uses one local Collector base URL. Export uses HTTP/protobuf, regardless of the Copilot CLI protocol. Metrics and logs are disabled. Stable HTTP semantic conventions are requested with `OTEL_SEMCONV_STABILITY_OPT_IN=http`. Automatic resource detection is disabled for Node. Python resource defaults and library span attributes can still include paths, URLs, and host data. **The local Collector filter is required before storage or Azure delivery.** This bootstrap is not a privacy filter.

## Project setup

Published package versions were checked against npm and PyPI metadata on 2026-10-03. Exact suggestions are in `dependencies.json`. These versions are optional project dependencies. They are not global dependencies.

- Node: `@opentelemetry/auto-instrumentations-node@0.80.0`, `@opentelemetry/sdk-node@0.222.0`, and `@opentelemetry/exporter-trace-otlp-proto@0.222.0`. The published engine range is `^18.19.0 || >=20.6.0`. Local tests used Node **22.23.0**.
- Python: `opentelemetry-sdk==1.45.0`, `opentelemetry-exporter-otlp-proto-http==1.45.0`, and instrumentors for the libraries in use. Requests proof used `opentelemetry-instrumentation-requests==0.66b0` and `requests==2.32.5`, on Python **3.14.6**. The package family supports Python 3.10 or newer; those other interpreters were not tested here.

The Node bootstrap configures the SDK before application imports. ESM also uses the installed instrumentation hook. It patches core HTTP/HTTPS before ESM binds those exports. Filesystem and DNS instrumentation are disabled to reduce local noise. Other instrumentors apply only to supported installed libraries.

The Python bootstrap creates the SDK and loads installed `opentelemetry_instrumentor` entry points before `runpy` starts the script. `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS` can disable selected instrumentors. It does not replace project startup hooks. If a project already configures an OTel provider, use that provider's supported configuration instead of this bootstrap to avoid competing providers.

## Scope and context

The existing `instrumentation/node/preload.cjs` and `instrumentation/python/` observers remain available for manifest and hash scoped root spans and explicit internal steps. They require no OTel package setup. This module is an optional library tracing path. It does not replace or edit those observers. The companion must select the appropriate path. Do not stack bootstraps and assume that their separate contexts are linked.

Python accepts an explicitly supplied, validated `traceparent` through the plan and restores that context before the entry runs. This was verified by matching the exported trace ID and parent span ID. Node library spans do **not** automatically inherit the existing stdlib observer's context. A shared run ID is a logical link only. Applications must use OTel context propagation to obtain a physical parent relationship.

This does not trace every function, business step, child process, or unsupported package. TypeScript must be compiled to JavaScript for this qualified path. `tsx`, `ts-node`, and native TypeScript execution are not qualified by this module. Python `-m`, Node `-e`, REPLs, and command string wrapping are not supported. Cross-platform paths use Node and Python platform path libraries. Windows and Linux execution were not qualified in these macOS checks. Signal termination, forced exit and crashes can lose buffered spans. Normal termination flush was tested; crash recovery was not.

## Verification

```sh
node --test instrumentation/auto/test/plan.test.cjs
```

The five tests check missing requirements, exporter restrictions, symlink scope escape, invalid command/context/TypeScript inputs, and Electron dependency-probe isolation.

The integration test requires a disposable environment with dependencies installed under `<proof-root>/node` and a Python virtual environment under `<proof-root>/python`:

```sh
AGENTOPS_AUTO_PROOF_ROOT='/absolute/path/to/disposable/environment' \
  node --test instrumentation/auto/test/http.integration.cjs
```

On 2026-10-03, all three integration cases passed: real Node CommonJS HTTP, real Node ESM HTTP, and real Python Requests HTTP spans. The receiver decoded actual OTLP protobuf exports. Python's supplied parent context matched exactly. The applications contacted a loopback fixture server. No model, Azure account, normal user profile, or external application endpoint was used.

The real Collector integration additionally proves three HTTP library spans (CommonJS, ESM, Python), their approved run IDs and the safe `agentops.operation.kind=http` classification. A synthetic secret canary in the request URL was absent from the filtered receipt. Run this check with an existing pinned Collector binary:

```sh
AGENTOPS_AUTO_PROOF_ROOT='/absolute/path/to/disposable/environment' \
AGENTOPS_AUTO_COLLECTOR_BINARY='/absolute/path/to/otelcol-contrib' \
  node --test instrumentation/auto/test/collector.integration.cjs
```

This proves library emission, local transport and the shared Collector HTTP semantic filter. It does not prove Azure readback, Copilot tool injection, production workloads, or diagnostic benefit. The GUI script command is covered by seven mocked flow tests; rendered GUI qualification is separate.
