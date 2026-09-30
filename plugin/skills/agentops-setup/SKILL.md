---
name: agentops-setup
description: "Use when: setting up Copilot CLI observability for a repository, checking instrumentation coverage, preparing Azure resources, or validating removal."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
---

Use this skill to set up one explicitly observed Copilot CLI process with a reviewable repository inventory, process-scoped script tracing, and an Azure target. Do not install ambient hooks or change the user's global shell.

## 1. Inspect and interview

Run a no-write inventory from the repository root:

```bash
agentops attach --repo . --json
```

If `agentops` is not on `PATH`, do not install packages or search broad filesystem locations automatically. When working from a known AgentOps source checkout, run the same command through its CLI entry point: `node <absolute-agentops-checkout>/agentops-cli/src/index.js attach --repo . --json`. Otherwise ask the maintainer to install the CLI or provide the checkout path before continuing.

Explain the discovered agents, skills, references, and supported Python/JavaScript/TypeScript scripts. The inventory stores file hashes, not file contents. Dependency/build folders are excluded. Files too large to hash and unsupported runtime loaders must appear as coverage gaps. Ask the maintainer about:

- Which agent to use for the first synthetic smoke run.
- Which Python and Node/TypeScript runtimes actually execute scripts.
- Which Node/TypeScript runtime or loader executes repo scripts.
- Which internal script steps matter enough to add named spans.
- Whether the Azure target is synthetic EVAL or an organization-approved restricted work environment.
- Whether any paths should be excluded from the run inventory.

Do not ask for credentials or copied prompt/source data. Never use work agents or work data for development tests.

## 2. Preview and apply the project attachment

Review the no-write preview and its hash-eligible script count. With the maintainer's approval to attach this repo, apply the local inventory:

```bash
agentops attach --repo . --yes
```

This writes only `.agentops/attachment.json` and `.agentops/.attachment-receipt.json`. It does not enable telemetry, install hooks, or edit scripts. Python and Node startup bootstraps emit a root span only when an executed repo script still matches its recorded hash in an explicitly observed `agentops copilot-session launch`. Unlisted, changed, oversized, dependency, and build files remain uninstrumented. Named internal steps require the existing helper. Python uses its standard library by default; the OpenTelemetry SDK is optional. Do not install dependencies or change the interpreter without the maintainer's approval. TypeScript support depends on the runtime loader and must be shown as a coverage gap until verified.

Attachment is read when an observed process starts. If this skill attaches the repository from inside an already-running Copilot session, that session's earlier scripts are not retroactively instrumented. Finish the setup session, then start a fresh observed Copilot process in step 5 and review coverage from that run. Do not count the setup session's probe output as script-span evidence.

## 3. Record the runtime profile

Record only short runtime/version labels in private project configuration. Do not store executable paths, command arguments, environment secrets, or source content. Omit flags for runtimes the repository does not use; use `unknown` when a TypeScript loader is unclear:

```bash
agentops configure set --project \
  --python-runtime <version> \
  --node-runtime <version> \
  --typescript-loader <loader-or-unknown>
agentops configure show --json
```

For example, use labels such as `python3.12`, `node22.23`, and `tsx4.23`. The labels describe the expected runtime; they do not prove it executed. Coverage must come from a matching observed run.

## 4. Prepare Azure only when requested

Require an explicit subscription and a dedicated new resource group. Preview first:

```bash
agentops provision azure --subscription <subscription-id> --resource-group <new-agentops-rg> --profile pilot
```

Review the subscription, resource group, `what-if`, retention, ingestion limit, and security notes with the maintainer. Apply only to that exact target after approval:

```bash
agentops provision azure --subscription <subscription-id> --resource-group <new-agentops-rg> --profile pilot --yes
```

Never infer a subscription from the active Azure CLI context. Do not use the existing main Bicep path until its workspace-repointing hazard is resolved. The pilot profile is synthetic EVAL, not enterprise work-data approval. Its public DCE endpoints and ingestion cap are not a full security or spend boundary.

### Choose the readiness profile

Use the `personal` profile for a synthetic metadata-only pilot backed by Log Analytics and its DCE/DCR. Unconfigured Application Insights and Managed Grafana checks are explicitly skipped:

```bash
agentops validate-azure --last 24h --profile personal --json
```

The `team` and `internal` profiles require a finite Log Analytics daily cap, an Azure budget, Application Insights, and Managed Grafana. `internal` also requires least-privilege group RBAC. `--production` implies `internal` and adds the wider network, alert-routing, and production checks. A synthetic EVAL resource group is not expected to pass these work-readiness profiles. Do not provision the larger view stack or incur new Azure costs without the operator reviewing its scope and cost.

Bind an existing Azure target to this repository only, so it cannot inherit another project's resource IDs:

```bash
agentops configure set --project \
  --subscription-id <subscription-id> \
  --resource-group <resource-group> \
  --workspace-id <workspace-customer-id> \
  --workspace-name <workspace-name> \
  --logs-ingestion-endpoint <dce-ingestion-endpoint> \
  --dcr-immutable-id <dcr-immutable-id>
agentops configure show --json
agentops validate-azure --last 24h --profile personal --json
```

Check that the displayed subscription, resource group, workspace, DCE endpoint, and DCR are the intended target. Project settings are private local configuration. Do not add credentials or connection strings to the repository.

## 5. Start one observed run

Prefer the temporary native launcher. It invokes the real Copilot binary directly and scopes telemetry and script bootstrap settings to that process:

```bash
agentops copilot-session launch --repo . -- --agent <agent-name>
```

Do not recommend shell-wide `eval` exports: they can affect later unrelated Copilot sessions in the same terminal. The explicit `agentops copilot --agent <agent-name>` wrapper remains an available fallback when its additional lifecycle features are useful.

Explain that collection applies to every actual agent and subagent in the opted-in process, not only the initially selected agent. Other processes and repositories do not opt in. Each launch starts an independent, short-lived strict loopback Collector and collects session metadata plus local repo/attachment context after Copilot exits. The metadata path forces Copilot content capture off. It is local-only by default. Review the displayed target, then add `--upload --yes` before `--` only for an approved synthetic or governed Azure target. The selected repo must have a complete project-scoped target; never rely on user-level fallback for uploads. The launcher blocks before starting Copilot when the project target is absent or incomplete. A one-off target is allowed only when subscription, Logs Ingestion endpoint, and DCR immutable ID are all explicitly set in the environment. Copilot's noninteractive permission flags still apply; grant only the tools and paths the run needs. Verify the local receipt and, when uploaded, query Azure for the exact run/session before claiming delivery. Open the local run view with:

For an isolated synthetic run, `--disable-builtin-mcps` disables built-in MCP servers only; configured user, workspace, and plugin MCP servers may remain available. If the test must exclude MCP tools, list configured servers and disable them for that invocation, and use an explicit `--available-tools` allowlist. Do not use `--allow-all`, `--allow-all-paths`, or broad URL grants to get past permission failures. If a source checkout must be executed from outside the target repo, add only its required CLI directory with `--add-dir` and grant the minimum command permissions; otherwise use the installed CLI and normal interactive approvals.

```bash
agentops copilot-session view <session-id> --run-id <run-id> --output <local.html> --allow-content
```

The local view may contain prompts and tool payloads; use only synthetic content unless local handling is separately approved. A missing edge must be shown as a coverage gap, not inferred from timestamps or file names.

## 6. Review local runtime coverage

Compare observed local exports with the attached inventory:

```bash
agentops coverage --repo . --json
```

Coverage reads only private local run exports whose repository-path and attachment-manifest hashes match. It reports observed names and denominators. An unobserved component is not proof that it is unused. Older runs without repository association and runs from a prior attachment version are not attributed to the current inventory. If the report flags inventory drift, review and reattach before relying on coverage counts.
The `runtimeProfile` section compares each language's declared scripts, configured runtime label, and observed script spans. It does not currently identify the runtime or TypeScript loader from telemetry, so configured labels remain unverified even when scripts are observed. An unknown TypeScript loader is an explicit gap.

## 7. Send synthetic detail to the restricted EVAL table only when approved

Keep strict metadata as the default. For an explicitly approved synthetic fixture, export content separately:

```bash
agentops copilot-session export-content <session-id> \
  --run-id <run-id> --output <private-dir>/AgentOpsContent_CL.jsonl \
  --allow-content --synthetic
agentops azure-ingest plan --dir <private-dir> --content-only --allow-content --json
```

Confirm the dedicated content DCR maps only to `AgentOpsContent_CL`, review the secret scan and row count, then upload only to the separately approved restricted synthetic workspace. Never claim that later redaction changes remove already-ingested content. Work-content capture requires its own organizational approval, access/RBAC, retention/deletion, network, and cost review.

## 8. Verify and remove

Verify both local run evidence and Azure readback for the exact run and session. Record producer versions, link certainty, missing edges, script coverage, data mode, retention, and any observed ingestion drops. Telemetry failure must not alter the agent result or script exit code.

Preview detachment before removal:

```bash
agentops detach --repo .
agentops detach --repo . --yes
```

The apply step removes only unchanged manifest/receipt files owned by AgentOps. Preserve user-edited or unrelated `.agentops` files. Never delete cloud rows as routine cleanup; use the approved retention/deletion process.
