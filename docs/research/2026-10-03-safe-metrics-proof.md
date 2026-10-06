# Safe native metric qualification — 2026-10-03

The local strict Collector now preserves approved metric identity. It no longer renames all metrics to `agentops.metric`. Unknown names, wrong numeric types and wrong units are dropped before the privacy transform. Span and log privacy rules are unchanged.

## Policy

The 14 exact instrument name/type/unit pairs come from the [pinned official CLI metric reference](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/reference/copilot-cli-reference/cli-command-reference.md#genai-convention-metrics). They include the native token histogram, duration histograms, tool-call counter and code-line counters. The token instrument is a histogram, not a counter.

Descriptions and arbitrary datapoint labels are removed. Only `gen_ai.operation.name`, `gen_ai.token.type` and boolean `success` remain. Operation values are limited to `chat`, `invoke_agent`, `execute_tool` and `invoke_workflow`. Token types are limited to `input` and `output`. Model, tool, agent and error labels are not restored.

Datapoints with exemplars are dropped. Collector 0.151.0 cannot clear an exemplar slice with an OTTL `[]` value: it validates, but returns a runtime type error. `nil` does not clear that slice. The tested fail-closed rule uses `Len(exemplars) > 0`. This also drops valid points with exemplars. It protects against content in exemplar filtered attributes, but reduces metric coverage. Unknown or removed data must not be described as zero usage.

## Actual Collector proof

Commands:

```sh
node scripts/qualify-safe-metrics.js
node --test scripts/test/qualify-safe-metrics.test.js
```

The script requires an existing cached Collector 0.151.0. It accepts `AGENTOPS_COLLECTOR_BINARY` to select another cached binary. It performs no download, model request, Azure request or user-profile change. It creates temporary local evidence, selects temporary loopback ports and stops its own Collector.

The fixture traverses the actual production local pipeline and its receipt relay. Both apply the same metric filter and privacy transform. The resulting receipt contains exactly three approved instruments:

| Instrument | Verified result |
|---|---|
| `gen_ai.client.token.usage` | Histogram name, `tokens` unit, numeric sum and valid input/chat labels retained |
| `gen_ai.client.operation.duration` | Histogram name, `s` unit, count and sum retained; poisoned operation/token-type/success labels absent |
| `github.copilot.tool.call.count` | Counter name, `calls` unit, monotonic flag, temporality, value and boolean success retained |

The test also sends an unknown name, a poisoned unit, the token name with the wrong Sum type and a known histogram point with a poisoned exemplar. None reaches the receipt. A synthetic secret canary in description, unknown resource label, datapoint labels, unknown name, unit and exemplar is absent from the receipt and debug-export output. The double pass retains the approved numeric values and labels.

The final run passed one real-Collector regression test. The standalone script also passed. Evidence from that standalone run is at `/var/folders/gq/_5ytx8vs18xbh18m_k3n29ym0000gp/T/agentops-safe-metrics-A2treh/proof.json`. `git diff --check` passed for the changed paths.

## Limits

This is controlled OTLP fixture proof with the actual Collector. It is not proof that a live Copilot model session emitted these metrics, or that Azure accepted or displayed them. Three instrument pairs have runtime fixture coverage; the other approved pairs follow the official reference but have not each received a separate runtime fixture. This change applies only to `otelcol.local.strict.yaml`. Other Collector modes remain unchanged and require their own privacy and semantic checks. Existing allowed resource values are not a general secret detector. `github.copilot.nano_aiu` is a span attribute; this metric change does not add it to span or log allowlists.

Graphify found no unique node for `privacy_strict`. Exact YAML inspection and the official source corpus were used instead. Existing dirty work was preserved.

## Bounded library span semantics

A follow-up adds two finite semantic fields to the same local strict trace policy. `http.request.method` accepts only `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `CONNECT` and `TRACE`. `db.system.name` accepts only `postgresql`, `mysql`, `sqlite` and `redis`. Other values are removed before the span allowlist. These are deliberately narrow supported values, not every database or method an upstream library can emit.

The Collector first removes any caller-supplied `agentops.operation.kind`. It derives `http` or `database` only after validation. If both validated semantic fields occur, `database` takes precedence. Span names remain `agentops.span`. No URL, query, endpoint, header, body, service or user label is newly allowed.

The real-Collector regression now also submits three HTTP/database-shaped spans. A valid GET retains `http`; a valid PostgreSQL span retains `database`; a poisoned method, database system and operation kind retain none of them. The fixture includes canaries in raw span names, status messages, URLs, queries, authorization headers and bodies. These canaries are absent after the actual double privacy pass. The existing content-capture signal remains visible. All three spans reach the receipt. The updated test passed in 1.95 seconds.

This proves filtered fixture receipt semantics. It does not prove upstream library auto-instrumentation activation, custom-table mapping or Azure delivery. Those checks remain separate.

## Review repair: metadata outside attribute allowlists

Independent review confirmed that instrumentation scope attributes, scope names and schema URLs bypassed the previous attribute-only policy. The policy now clears resource and scope schema URLs for traces, metrics and logs. Each scope is renamed to `agentops.scope`; its version and all attributes are removed. These schema paths are writable in pinned Collector 0.151.0, although the context README tables omit them. Source evidence: [resource path handler](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.151.0/pkg/ottl/contexts/internal/ctxresource/resource.go) and [scope path handler](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.151.0/pkg/ottl/contexts/internal/ctxscope/scope.go).

Span trace state is cleared. Spans with links are dropped because linked-span attributes and trace state form another unfiltered content channel. This also drops valid linked spans and reduces coverage. Logs now clear severity text and replace their event name with `agentops.event`; numeric severity remains available.

The final real-Collector regression submits all three signals with poisoned resource/schema metadata, scope name/version/attributes and scope schema URLs. It includes a linked span with poisoned link attributes and trace state, a poisoned span trace state, and a log with poisoned body, severity text and event name. After both privacy passes, receipts contain three approved metrics, three unlinked sanitized spans and one sanitized log. The canary is absent from receipts and debug export. The final test passed in 2.00 seconds.

These checks cover the explicit fixture channels. They do not make arbitrary values in existing permitted resource or legacy attributes safe. Those fields remain an existing trust boundary that needs a separate value contract before accepting arbitrary untrusted producers. Do not describe this policy as a general secret detector or proof of all possible OTLP privacy channels.
