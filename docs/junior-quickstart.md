# AgentOps in plain English

AgentOps gives GitHub Copilot a safe observability path. Copilot emits its own
native OpenTelemetry; a local OpenTelemetry Collector removes sensitive fields,
keeps a small private receipt, and can forward the safe metadata to Azure
Monitor. You run the normal `copilot` command. There is no required wrapper.

## What you get

- Run, model, tool, token, cost, timing, and error metadata.
- Azure Monitor **Agents (Preview)** for the useful “what happened?” view.
- A local receipt that proves what crossed the privacy boundary.
- No prompts, answers, code, file contents, tool arguments, or tool results by
  default.

## First value locally

You need Node.js and an authenticated GitHub Copilot CLI. Azure is not needed
for this first check.

```bash
cd /path/to/copilot-cli-agentops-azure
./setup-agentops.sh
export PATH="$HOME/.local/bin:$PATH"
eval "$(agentops init --local-only --yes --shell zsh)"
agentops smoke --local --real-copilot --no-verify --json
agentops open latest --json
```

What success looks like:

- `ok: true` from the smoke command.
- A local receipt with a Copilot session ID, model, token counts, tool names,
  and `content_capture_mode: "off"`.
- No prompt or response text in the receipt.

If the Collector is missing, run:

```bash
agentops collector install-binary
agentops smoke --local --real-copilot --no-verify --json
```

## First value in Azure

The checked-in dev pilot is already onboarded as an Azure Application Insights
resource with native OTLP support. To use another environment, repeat the
first-party onboarding described in [the Azure preview runbook](azure-native-otlp-preview.md).

1. Sign in and select the approved subscription:

   ```bash
   az login
   az account set --subscription <approved-subscription-id>
   export AGENTOPS_AZURE_SUBSCRIPTION_ID=<approved-subscription-id>
   export AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS=<approved-subscription-id>
   ```

2. Run the read-only readiness check. It discovers the exact Application
   Insights resource, DCR, OTLP endpoints, feature state, and ingestion role:

   ```bash
   ./scripts/azure-native-otlp-readiness.sh
   ```

3. Load the verified endpoint values into your current shell. This avoids
   copying long URLs by hand:

   ```bash
   eval "$(./scripts/azure-native-otlp-env.sh)"
   export AGENTOPS_APPROVE_NATIVE_OTLP=yes
   ```

4. Validate, start, and test the native Collector:

   ```bash
   agentops collector validate --mode azure-native --privacy strict --json
   agentops collector start --mode azure-native --privacy strict --json
   agentops smoke --json
   ```

   The cloud smoke may take a couple of minutes to become query-visible. The
   default cloud wait is five minutes and the command succeeds only when Azure
   returns at least one matching OTel span row.

5. Run a real plain Copilot task:

   ```bash
   agentops smoke --real-copilot --no-verify --json
   copilot -p "Do not edit files. Run pwd and ls docs | head, then summarize."
   agentops open latest --json
   ```

   Open the printed Application Insights Agents link. The pilot should show an
   agent run, model, tool call, and token totals. `--no-verify` on the real task
   avoids confusing a successful Copilot run with a separate ingestion wait;
   use `agentops smoke --json` when you want the query-backed gate.

## Privacy rule of thumb

Keep content capture off. `--no-remote-export` controls Copilot session export;
it is not the same thing as OpenTelemetry content capture. AgentOps therefore
keeps both controls explicit and labels the session-export setting as verified
only when the invocation actually includes the flag.

## If something fails

- Collector will not start: run `agentops collector status --json` and then
  `agentops collector validate --mode azure-native --privacy strict --json`.
- Azure readiness fails: check the subscription, resource group, feature state,
  and DCR role shown by the command. Do not hand-edit endpoint URLs.
- Smoke says “sent but not found”: wait for Azure ingestion and rerun
  `agentops smoke --json`; a local `2xx` only means the Collector accepted the
  event.
- Agents is empty: confirm the time range is **Last 24 hours**, refresh the
  workbook, and check that the OTel span query already returns a row.

## Stop the local Collector

```bash
agentops collector stop --mode auto --json
```

The local receipt and queue live under `~/.agentops`. They are local-only
runtime artifacts and are not part of the repository.
