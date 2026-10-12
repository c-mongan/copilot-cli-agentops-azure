# When to use AgentOps

AgentOps is a preview tool for inspecting Copilot CLI runs. Its main task is to help a developer find a failed, denied or slow tool call and share a metadata-only diagnostic report.

## Choose the tool for the task

| Your task | Start here |
|---|---|
| Inspect one Copilot CLI run and export a local report | Try the AgentOps local UI and static HTML view |
| Inspect standard OpenTelemetry locally | Compare with Aspire Dashboard or Jaeger |
| Monitor several coding agents across a team | Start with Azure Monitor's coding-agent dashboards |
| Operate a supported cloud monitoring service | Use the Azure services and their documented support model |

Azure already provides coding-agent dashboards and an Application Insights Agents view. Copilot already emits native OpenTelemetry. VS Code documents local trace viewers. AgentOps builds on those signals; it does not replace their instrumentation or establish that a task succeeded.

Sources, checked 12 October 2026:

- [Azure coding-agent monitoring](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-opentelemetry-app-insights)
- [Application Insights Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)
- [VS Code monitoring and local viewers](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [Copilot CLI native telemetry](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring)

## What to evaluate

AgentOps combines a focused run view with local session-event context. For example, a shell command can exit non-zero while its native tool span reports success. The session-event join can add a separate attention signal. See [run status](local-ui.md#how-run-status-is-decided).

This is a reason to test the tool, not proof that it is faster or better than a native viewer. Metadata-only defaults and local viewing are available in other tools too. No comparative user study or production adoption claim is made here.

## Reproduce before you deploy

1. Use the [sample-data demo](../README.md) to learn the interface. It makes no model or cloud calls.
2. Use the [CLI quickstart](../README.md#quickstart) with a small repository to capture an actual run locally. Inspect the result and export a report.
3. Check the report before sharing it. Metadata can still identify a run or repository. Do not enable content capture for confidential work.
4. Add Azure only if remote storage or a team view is required. Publishing needs an explicit destination and upload controls. Check queried storage after ingestion.

The local workflow needs no Azure deployment. A hosted public service is not required to use this project.

## What counts as proof

| Evidence | What it proves | What it does not prove |
|---|---|---|
| Generated sample sessions | UI behavior for known inputs | Actual Copilot capture |
| Installed CLI with a local synthetic model provider | Tool execution and capture integration | Real model reasoning or cloud delivery |
| Actual model session and local report | The observed local workflow on the stated build | Azure ingestion or broad reliability |
| Azure ingestion plus exact readback | The recorded rows reached the selected destination | Complete capture or task correctness |
| A dated screen recording | The visible steps that occurred | Unshown behavior or later builds |

The [E2E walkthrough](e2e-validation.md) contains dated real-run evidence. It is not a claim that every later commit received the same live test. Tests and edited demo videos have separate purposes.

## A useful comparison

Use the same successful run, denied tool, non-zero shell exit and slow tool in AgentOps and a native viewer. Keep privacy settings equal. Measure setup time, time to find the cause, incorrect labels and the steps needed to share a safe report. Prefer the simpler tool if it gives the same result. Do not add dashboards solely to increase feature count.
