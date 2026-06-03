# Copilot CLI Flag Contract

AgentOps records only privacy-safe dimensions from Copilot CLI flags. The wrapper treats flags in three groups:

- Tracked flags: converted to booleans, counts, safe basenames, or safe names.
- Ignored Copilot flags: known flags that are intentionally not exported because they are content-like or not useful for run analysis.
- AgentOps-only flags: removed before forwarding to the real Copilot CLI.

The source of truth is `agentops-cli/src/lib/copilot/flag-contract.js`. `agentops product audit` requires that file, and tests use `auditCopilotHelpFlags()` to compare Copilot help snapshots against the known contract.

When Copilot adds a new flag, classify it before adding it to the wrappers:

- Track it if it changes security posture, execution mode, MCP/tool behavior, output shape, remote state, or run attribution.
- Ignore it if exporting it would store prompt text, paths, URLs, tool arguments, attachment names, plugin directories, session IDs, or secrets.
- Keep exact values out of telemetry unless the value is already a safe enum, basename, server name, or count.

The wrapper contract also checks that Bash and PowerShell observe scripts include the same tracked flags, safe resource attributes, and privacy defaults.
