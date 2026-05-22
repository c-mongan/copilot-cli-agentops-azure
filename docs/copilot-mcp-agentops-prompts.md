# Copilot MCP AgentOps Prompts

Use these snippets to let Copilot CLI analyze AgentOps telemetry through read-only Azure MCP and Azure Managed Grafana MCP.

## MCP Setup

### Azure Monitor MCP

Use Azure MCP with only the Azure Monitor namespace and read-only mode:

```json
{
  "mcpServers": {
    "azure-mcp": {
      "tools": ["*"],
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start", "--read-only", "--namespace", "monitor"]
    }
  }
}
```

The same configuration is available in `copilot/mcp.azure-monitor.sample.json`. Authenticate with `az login` in the local shell. Do not add Azure credentials, connection strings, or secrets to the MCP file.

### Azure Managed Grafana MCP

Azure Managed Grafana exposes a built-in MCP endpoint at:

```text
https://<grafana-endpoint>/api/azure-mcp
```

Use the sample in `copilot/mcp.grafana.sample.json`:

```json
{
  "mcpServers": {
    "agent-grafana": {
      "tools": ["*"],
      "type": "http",
      "url": "https://<grafana-endpoint>/api/azure-mcp",
      "headers": {
        "Authorization": "Bearer ${AZURE_GRAFANA_MCP_TOKEN}"
      }
    }
  }
}
```

Replace `<grafana-endpoint>` before using the sample. Set `AZURE_GRAFANA_MCP_TOKEN` outside the repo. Use a least-privilege Grafana Viewer service account token or a short-lived Entra ID token for the Azure Managed Grafana audience. Do not commit the token or paste it into prompts.

### Copilot CLI Usage

Pass the Azure Monitor sample file to Copilot CLI as additional MCP config, or merge the `mcpServers` entry into the MCP config you already use:

```bash
copilot --additional-mcp-config @copilot/mcp.azure-monitor.sample.json --allow-tool='azure-mcp'
```

Add `@copilot/mcp.grafana.sample.json` only after replacing the placeholder Grafana endpoint and setting `AZURE_GRAFANA_MCP_TOKEN`.

Keep MCP read-only by default. If a future workflow needs write access, require an explicit approval step and document the exact tool, resource, and rollback plan.

## Recommendation Contract

Every AgentOps recommendation must include:

- Evidence query or Grafana dashboard link.
- Observed failure, cost, or safety pattern.
- Proposed file(s) to change.
- Expected metric movement.
- Validation benchmark or query.
- Rollback condition.

Recommendations must not require prompt, response, tool argument, tool result, secret, or file-content capture. Agents propose changes by default; they do not auto-remediate.

## Prompt Templates

### Local AgentOps CLI Triage

```text
Use the agentops-live-triage skill.

Tell me what happened in the latest Copilot CLI session, why it mattered, and where to look next.
Prefer local AgentOps CLI commands first:
`node agentops-cli/src/index.js live --last 2h`,
`node agentops-cli/src/index.js replay latest --last 24h`,
`node agentops-cli/src/index.js primitives --last 7d`, and
`node agentops-cli/src/index.js recommend latest --last 24h`.

Return the session id, ordered timeline, failures, policy/context/cost signals, and one evidence-backed next action.
Do not request prompt/content capture.
```

### Trace Agent/Subagent Flow

```text
Use the agentops-flow-lineage skill.

Trace the latest custom-agent or subagent flow in the last <time-range>.
Use `node agentops-cli/src/index.js lineage --last <time-range>` and reconstruct parent-child spans from OperationId, Id, and ParentId where available.

Show agent, subagent, LLM, built-in tool, MCP tool, skill, hook, context, and error events.
Call out missing parent-child metadata separately from observed behavior.
```

### MCP Tool Triage

```text
Use the agentops-mcp-tool-triage skill.

Show which MCP servers and tools were involved over <time-range>, whether they failed or caused permission friction, and whether the MCP scope is too broad.
Use `node agentops-cli/src/index.js mcp --last <time-range>`, `permission-friction`, and `lineage`.

Treat `mcp__<server>__<tool>` and `<server>/<tool>` attribution as exact. Treat single-configured-server attribution as inferred.
```

### Investigate Latest Session

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Investigate the latest Copilot CLI session in the last <time-range>.
Use the AgentOps Grafana dashboard <dashboard-url> and Log Analytics workspace <workspace-id>.
Start by finding the newest `github-copilot-cli` conversation in `AppDependencies`.

Return only evidence-backed findings. For each recommendation include:
evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not edit files yet. Do not request prompt/content capture.
```

### Explain Tool Failure

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Explain repeated tool failure for <tool-name> over <time-range>.
Use `AppDependencies` where `Properties has "github.copilot"` and inspect related `execute_tool` spans, hook events, and policy blocks.

Return the likely failure pattern, affected agents/skills/hooks, and one minimal fix proposal.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not auto-remediate.
```

### Compare Benchmark Variants

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Compare AgentOps benchmark or experiment variants <variant-a> and <variant-b> over <time-range>.
Use telemetry labels such as `agentops.experiment`, model, agent name, repo hash, and conversation id.

Compare success rate, failure rate, p95 duration, tool retries, token usage, AIU, estimated cost, policy blocks, and truncation/compaction signals.
Recommend the safer variant only if the evidence is consistent.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not implement CLI benchmark commands.
```

### Propose Agent Improvement

```text
Use the agent-optimizer agent with read-only Azure MCP and Grafana MCP.

Analyze <agent-file> against telemetry from <time-range>.
Find repeated failures, high token use, excessive tool scope, missing skill triggers, subagent fanout, policy blocks, and retry loops.

Propose the smallest agent/skill/hook/MCP config change that should improve the measured pattern.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not edit files until I approve the patch plan.
```

### Tune Hook Policy

```text
Use the hook-policy-reviewer agent with read-only Azure MCP and Grafana MCP.

Review hook policy behavior for <hook-name-or-event> over <time-range>.
Focus on deterministic preToolUse decisions, postToolUseFailure hints, agentStop/subagentStop gates, timeout risk, and false positives.

Recommend only minimal hook-policy changes.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not add network calls to blocking hooks and do not capture prompt/tool content.
```

### Find MCP/Tool Regressions

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Find MCP or tool regressions introduced after <date-or-version>.
Compare failure rate, retry rate, latency, policy blocks, disabled MCP server counts, additional MCP config counts, and likely MCP/extension tool usage against the prior baseline.

Return suspected regressions with affected tools, agents, and sessions.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not loosen permissions or enable non-read-only MCP access without explicit approval.
```
