# Azure native OTLP preview

This is the optional cloud lane for the native-first AgentOps setup. Copilot
CLI, VS Code Copilot Chat, and Copilot SDK applications emit their own native
OpenTelemetry. AgentOps only provides a local strict Collector boundary and a
small CLI; it does not wrap or re-instrument Copilot.

```text
native Copilot OTel
        |
        v
127.0.0.1:4318  ->  local strict Collector  ->  Azure Monitor OTLP/DCR
                                                    |
                                                    v
                                             Agents view + KQL
```

This path is a preview pilot. It is not a production support claim, and it is
separate from the existing connection-string and Logs Ingestion API
compatibility paths.

## Gate before running

- [ ] Confirm the exact Visual Studio Enterprise subscription.
- [ ] Confirm the exact resource group and region; do not silently substitute
      another resource group.
- [ ] Use an Application Insights resource created with OTLP support enabled,
      or use a separately reviewed manual DCE/DCR design.
- [ ] Copy the DCR resource ID and the traces, logs, and metrics endpoint URLs
      verbatim from the Application Insights **OTLP Connection Info** section.
- [ ] Confirm the Collector identity has **Monitoring Metrics Publisher** on
      that DCR.
- [ ] Keep Copilot content capture disabled.
- [ ] Review the endpoints and set `AGENTOPS_APPROVE_NATIVE_OTLP=yes` before
      starting the native Collector.

## First-party Azure onboarding (write-gated)

Microsoft's recommended preview path is not a hand-authored Bicep property.
After the exact subscription, resource group, and region are approved:

1. Register the `Microsoft.Insights/OtlpApplicationInsights` preview feature and
   ensure the `Microsoft.Insights` provider is registered.
2. In the Azure portal, create or select an Application Insights resource,
   turn **Enable OTLP support (Preview)** on, and use managed workspaces.
3. Let the first-party onboarding create and connect the required DCR, DCE,
   Log Analytics workspace, and Azure Monitor workspace resources.
4. Copy the DCR resource ID plus the trace, log, and metric endpoints from
   **OTLP Connection Info**. Do not construct or normalize them locally.
5. Grant the Collector identity the least-privilege
   **Monitoring Metrics Publisher** role scoped to that DCR, then rerun the
   read-only readiness check.

The feature registration, resource creation, and role assignment are Azure
writes. The repository does not perform them implicitly, and its checked-in
Bicep does not invent an undocumented OTLP-enable property.

The read-only repository gate is:

```bash
AZURE_SUBSCRIPTION_ID="<approved-subscription-id>" \
AGENTOPS_AZURE_SUBSCRIPTION_ID="<approved-subscription-id>" \
AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS="<approved-subscription-id>" \
./scripts/azure-native-otlp-readiness.sh
```

That command never registers a feature, creates a resource group, assigns a
role, runs a what-if, or deploys infrastructure.

## Configure the local native Collector

The easiest safe path is to let the read-only helper discover the values from
the selected Application Insights resource. It checks the approved
subscription, resource group, feature registration, DCR role, and all three
signal endpoints before printing exports:

```bash
eval "$(./scripts/azure-native-otlp-env.sh)"
```

Do not put credentials in the repository. If you need to inspect the values
manually, they are the endpoint values from OTLP Connection Info; do not
construct or normalize the URLs yourself.

```bash
export AGENTOPS_AZURE_OTLP_DCR_RESOURCE_ID="/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Insights/dataCollectionRules/<dcr-name>"
export AZURE_MONITOR_OTLP_TRACES_ENDPOINT="https://<logs-dce-domain>/datacollectionRules/<dcr-immutable-id>/streams/Microsoft-OTLP-Traces/otlp/v1/traces"
export AZURE_MONITOR_OTLP_LOGS_ENDPOINT="https://<logs-dce-domain>/datacollectionRules/<dcr-immutable-id>/streams/Microsoft-OTLP-Logs/otlp/v1/logs"
export AZURE_MONITOR_OTLP_METRICS_ENDPOINT="https://<metrics-dce-domain>/datacollectionRules/<dcr-immutable-id>/streams/microsoft-otelmetrics/otlp/v1/metrics"
```

Validate the merged Collector configuration without starting it:

```bash
agentops collector validate --mode azure-native --privacy strict --json
```

Start it only after the target and endpoint review:

```bash
export AGENTOPS_APPROVE_NATIVE_OTLP=yes
agentops collector start --mode azure-native --privacy strict --json
```

The `azure-native` mode merges
`collector/otelcol.local.strict.yaml` with
`collector/otelcol.azuremonitor.native.strict.yaml`. This keeps the strict
allowlist, fail-closed transform, private file-backed queue, and loopback
receiver in one source-controlled base config. The overlay adds only
`azure_auth` and the current `otlp_http` Azure exporter.

## Test-drive sequence

- [ ] `agentops collector validate --mode azure-native --privacy strict`
- [ ] Send a synthetic metadata-only smoke event to `127.0.0.1:4318`.
- [ ] Confirm the Collector log has no authentication or export errors.
- [ ] Confirm the synthetic event is query-visible in `OTelSpans` in the
      selected Log Analytics workspace.
- [ ] Confirm a real run is visible in Azure Monitor **Agents (Preview)**.
- [ ] Run one real plain `copilot` task with content capture still disabled.
- [ ] Compare the local receipt, native OTLP rows, and Agents view without
      claiming success where only processing-stopped telemetry exists.

The success boundary is query visibility plus Agents-view evidence. An HTTP
`2xx` from the OTLP endpoint alone is not enough.

## Operator-run proof

This public repository contains the procedure, not a tenant-specific pilot
record. Run the checklist only against an explicitly approved subscription and
retain any query results, screenshots, resource IDs, and raw telemetry outside
the public tree. Local validation, an HTTP `2xx`, or a generated demo row does
not prove Azure query-back, Agents-view rendering, authentication, or
production readiness.

For logs, query `OTelLogs` and use `contains` against the safe
`agentops.custom_event_id` or resource correlation field. For metrics, use the
Azure Monitor Workspace PromQL endpoint discovered from the Application
Insights resource; `az monitor metrics list` exposes workspace platform
metrics, not custom OTLP series. The helper command is:

```bash
AGENTOPS_SMOKE_ID=<metric-smoke-id> ./scripts/azure-native-metric-query.sh
```

## Official documentation

- [GitHub Copilot CLI OTel configuration](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [GitHub Copilot SDK OpenTelemetry](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry)
- [Azure Monitor OTLP ingestion with the OpenTelemetry Collector](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-protocol-ingestion)
- [Azure Monitor OpenTelemetry ingestion options](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-options)
- [Azure Monitor Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)
- [OTLP HTTP exporter configuration](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlphttpexporter/README.md)
