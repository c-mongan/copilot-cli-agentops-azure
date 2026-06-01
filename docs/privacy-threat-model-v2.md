# Privacy Threat Model V2

## Protected Data

Strict mode must not export:

- prompts or responses;
- source code or file contents;
- tool args or results;
- request/response bodies;
- full URLs;
- secrets or tokens;
- raw repo, branch, workspace, user, or path values.

## Boundary

The local OpenTelemetry Collector is the scrub-before-export boundary. If the collector cannot validate strict mode, the safe behavior is to fail closed.

## Allowed Export Shape

- hashes;
- counts;
- booleans;
- durations;
- token/cost metrics;
- model/tool names when not content-bearing;
- risk labels;
- content signal kind/action/count.

## Explicit Content Opt-In

The Run Replay dashboard can read `AgentOpsContent_CL` when an operator intentionally enables content capture. This table is outside the strict default path.

Rules:

- strict mode keeps `AgentOpsContent_CL` empty or absent;
- `agentops azure-ingest plan` fails when content rows exist unless `--allow-content` is provided;
- content workspaces should be separate, restricted, and short-retention;
- secrets still must be blocked before export.
