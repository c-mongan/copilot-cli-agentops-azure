# Synthetic Copilot CLI observability probe

Date: 29 September 2026. This was a synthetic task, with no work agent or work data.

## Setup

- GitHub Copilot CLI 1.0.89 on macOS.
- A custom `trace-reader` agent was limited to the CLI's `view` tool.
- The agent read one invented incident fixture and answered its stated cause.
- Native OpenTelemetry JSONL file export was enabled. Message content capture was off.

## Observed

- The task returned the correct one-sentence cause and made no file changes.
- The successful trace contained four connected spans: one `invoke_agent`, two `chat`, and one `execute_tool view`.
- The agent span lasted about 4.6 seconds. The CLI reported 3.29 AI Credits and 11,385 input tokens for this one task.
- The exported file also held a separate root span from an earlier failed launch. That launch had rejected the initially configured `read` tool name before the task completed. Its root span carried an abort event, so counting root spans alone would misclassify it.
- The successful export included 12 metric records. The synthetic fixture text, prompt text, tool arguments, and tool result did not appear in the JSONL file under this configuration. The agent description and other identifying metadata did appear.
- The same synthetic CLI session also produced a separate native `events.jsonl` with 21 session events, including message, tool-start/completion, usage, and shutdown records. Its `{type, data, id, timestamp, parentId}` shape differs from the OpenTelemetry export. A session-history browser and an OTel trace viewer therefore answer related questions from different inputs.

## Limits

This proves native file export and a connected agent/model/tool trace for this installed CLI build and fixture. It does not prove VS Code parity, work-environment policy compliance, Azure ingestion, reference attribution, shell child-process propagation, or the completeness of any viewer.
