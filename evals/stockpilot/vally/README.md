# Vally harness for the StockPilot pilot (Task 9, bullets 3-4)

This directory contains the local Vally configuration. Historical smoke and
experiment runs are documented in the linked research report. The newly added
MCP/delegation spec has only local test, lint, and dry-run proof; it has not yet
run a model. See `../VALLY-PIN.md` for version and command evidence.

## Pin (bullet 3)

- `@microsoft/vally-cli@0.17.0` and `@microsoft/vally@0.17.0` both resolve
  on the npm registry (`npm view`, see `../VALLY-PIN.md`) and were
  installed via `npm install` into `evals/stockpilot/` — an isolated
  `package.json`/`package-lock.json`, **not** `agentops-cli/package.json`.
  `agentops-cli`'s own dependency tree is untouched by this task.
- Resolved tree recorded in `../package-lock.json` (committed).
- `@microsoft/vally`'s bundled executor depends on `@github/copilot@1.0.85`
  and `@github/copilot-sdk@1.0.14` (confirmed both by `npm view` and by
  reading the installed `node_modules/@microsoft/vally/package.json` and
  `node_modules/@github/copilot/package.json` / `copilot-sdk/package.json`
  after install). This environment's **native** Copilot CLI reports
  `GitHub Copilot CLI 1.0.90` (`copilot --version`, run directly — not via
  Vally). These are two **different** binaries/versions and must not be
  conflated: a Vally trial executes against the bundled 1.0.85/SDK 1.0.14,
  not whatever native `copilot` is on `$PATH`.
- Commands run: `vally --help` and every subcommand's `--help`
  (`init|lint|eval|experiment|compare|grade|oracle|export|serve|ingest`),
  `vally lint --eval-spec ...` (documented as "fast, no execution"), and
  `vally experiment run ... --dry-run` (documented as "Resolve the
  experiment and print the plan without executing"). No `vally eval`,
  `vally experiment run` (without `--dry-run`), or `vally compare` was
  run — those execute an agent / spend a judge model's tokens.

## Two separate telemetry paths (bullet 3)

Vally has **two independent telemetry systems** that must not be
confused:

1. **Vally's own product usage telemetry** — reports Vally CLI usage to a
   Microsoft-owned Azure Application Insights instance, **on by default**.
   Verified by reading
   `node_modules/@microsoft/vally-cli/dist/usage-telemetry/config.js`
   after install: a built-in connection string is used unless opted out.
   `VALLY_TELEMETRY_OPTOUT=1` (or the cross-tool `DO_NOT_TRACK=1`) opts
   out; opt-out always wins. See `../.env.example` — **always** export
   this before invoking `vally` anything.

2. **Agent-execution OTLP traces** — the actual spans/traces produced by
   running a stimulus against an agent. Controlled per-invocation by the
   `--otlp-endpoint <url>` flag on `vally eval` / `vally experiment run`
   ("Export OpenTelemetry traces to this OTLP/HTTP endpoint. When
   omitted, traces are written to the output directory."). This is
   **completely independent** of (1) — opting out of Vally's own usage
   telemetry does not change where execution traces go, and pointing
   execution traces somewhere does not re-enable Vally's own usage
   telemetry.

To route a future live trial's execution OTLP to this repo's existing
local strict Collector (`collector/otelcol.local.strict.yaml`, OTLP/HTTP
receiver on `127.0.0.1:4318` — confirmed by reading that file's
`receivers.otlp.protocols.http.endpoint`), a real invocation would add:

```bash
VALLY_TELEMETRY_OPTOUT=1 DO_NOT_TRACK=1 \
  vally eval --eval-spec eval.stockpilot-smoke.yaml \
  --otlp-endpoint http://127.0.0.1:4318 \
  --workers 1 --require-pass
```

**Not proven end-to-end today** — no live trial ran, so this is a
documented procedure, not an observed readback. The local strict
Collector itself is unmodified and untouched by this task (no new
pipeline/receiver added for Vally).

## Bounded single-worker, single-variant configuration (bullet 4)

- `../package.json`'s `pin-check` script and this README both record
  the pin; the actual bounded-run configuration lives in two files:
  - `eval.stockpilot-smoke.yaml` / `eval.stockpilot-f3-thrash.yaml` —
    real `eval.yaml` specs (schema:
    https://microsoft.github.io/vally/reference/eval-spec/, fetched
    2026-10-01). Each stimulus declares `constraints.max_turns`,
    `constraints.max_tool_calls`, and `constraints.max_wall_time`
    (bounded turn/time limits); `defaults.runs: 1` and `defaults.timeout`
    bound the per-stimulus trial count and overall wall time.
  - `experiment.yaml` — a real experiment file (schema:
    https://microsoft.github.io/vally/reference/experiment-file/)
    declaring exactly 2 variants (`healthy-base` vs
    `planted-tool-thrash`), one `vary` path
    (`/environment/skills`), and `execution.workers: 1`.
- **Concurrency is a CLI flag, not a YAML field.** Per `vally experiment
  run --help` and the experiment-file schema page: "`--workers` on the
  CLI takes precedence" over `execution.workers`. The authoritative way
  to guarantee `concurrency: 1` is to always invoke with `--workers 1` —
  this is documented as a hard requirement here, not left to the YAML
  alone. Verified locally: `vally experiment run vally/experiment.yaml
  --dry-run --workers 1` resolves successfully (see
  `../VALLY-PIN.md` for the exact output, including each variant's
  distinct config hash and identical eval hash — proof the dry-run
  correctly sees this as a single-skill-directory change, nothing else).
- **No hidden host skills or MCP servers**: every eval declares its skill list
  and the sole `stockpilot-readonly` stdio server explicitly. The dedicated
  MCP/delegation eval declares `skills: []` and stages exactly one custom agent
  at `.github/agents/stock-risk-auditor.agent.md`. Vally 0.17.0 passes only
  `environment.mcpServers` to the SDK and disables the hosted GitHub MCP unless
  explicitly named; workspace `.mcp.json` is not a discovery source here.

### Effective-environment validation procedure (documented, not run live)

Since no live trial ran, the following is the procedure a live run would
need, not an empirical result:

1. Before trusting `agent_environment.skills`/`mcpServers` as exhaustive,
   run `vally lint --eval-spec <file> --verbose` (already done for both
   specs here, zero execution) and confirm it reports no skill-path or
   MCP warnings beyond the expected `regression-without-baseline` notice.
2. After a real run, inspect the written trajectory/ATIF output
   (`vally eval --output-dir ...` writes `events.jsonl`/`metadata.json`
   per trial) for any skill name that does **not** appear in the eval
   spec's `agent_environment.skills` list — that would indicate a host
   skill leaked in through some path this fixture didn't anticipate
   (e.g. an ambient `.github/skills`/`plugin/skills` directory being
   picked up by the executor rather than this fixture's isolated list).
3. Confirm the trajectory names only `stockpilot-readonly`, and that the
   dedicated stimulus has exactly one completed `stock_snapshot`, one failed
   `unavailable_snapshot`, and then one completed `stock-risk-auditor`
   delegation. Use `../mcp-delegation-contract.json`; counts establish only
   that stimulus contract, not global completeness.
4. Confirm the resolved executor really is the Vally-bundled
   `@github/copilot@1.0.85` (not the native `1.0.90`) by checking the
   trial's recorded executor/version metadata, if Vally records it in
   `metadata.json` — if it doesn't, this is a gap to raise with whoever
   runs the first live trial.

## `--require-pass` / `--compare` gating (bullet 5, documented here since it's the same mechanism)

- `vally eval --require-pass`, `vally grade --require-pass`, `vally
  experiment run --require-pass`, and `vally experiment merge
  --require-pass` all exist and share the same documented semantics:
  "Exit non-zero when a valid verdict fails... errors always exit
  non-zero." **This is the aggregate pass/fail gate** a CI/acceptance
  pipeline should use — confirmed directly from `--help` output, not
  assumed.
- `vally experiment run --compare` and the standalone `vally compare`
  command are the **only** LLM-judged path, and are explicitly optional:
  the `--compare` flag's own `--help` text says "Requires a judge model —
  spends tokens," and the docs describe it as "opt-in because the
  comparison is LLM-judged." Neither was run. **`--compare`/`vally
  compare` must never be the default acceptance path** — `--require-pass`
  against the deterministic graders in `../graders/index.js` (ported from
  the workshop's own deterministic graders) is.

## Live follow-up on 2026-10-01

The earlier zero-execution statements above describe the initial handoff.
With renewed model authorization, the pinned executor ran two smoke tasks and
one trial for each experiment variant. See
`docs/research/2026-10-01-agentops-live-followup.md` for actual outcomes and limits.
The smoke confidence pattern now accepts numeric confidence in ordinary prose
and Markdown emphasis; qualitative claims and unrelated numbers still fail.
Full fixture assets are staged because the skills invoke their supplied scripts
using repository-relative paths.

Export selected Vally trajectory metadata to an existing AgentOps ledger:

```sh
node evals/stockpilot/scripts/export-agentops-ledger.js /path/to/results.jsonl /path/to/ledger/runs
```

The exporter excludes prompts, arguments, results, and final answers. It labels
these records as trajectory-derived, preserves measured zero versus unknown
usage, and never asserts complete capture or an architecture version. Existing
run directories are preserved. Keep the original Vally results separately for
grading and review.

The full 12-task runner is documented in [the fixture README](../README.md#full-live-corpus).
Its task/sink postgrade is mandatory; the Vally nonempty-output check alone is
not correctness proof. Synthetic planning time is pinned to the fixture snapshot.

## Owned MCP and delegated specialist

`eval.stockpilot-mcp-delegation.yaml` provides the smallest live compatibility
probe for the missing path: local MCP success, deliberate MCP tool error, then a
named read-only specialist. It uses the same pinned Vally 0.17.0 executor and
bundled Copilot CLI 1.0.85, one run, one worker, a 90-second agent cap, and no
skills. The MCP reads only the staged synthetic CSV and has no network or write
operation. Lint and deterministic tests prove its schema and local behavior;
they do not prove live discovery, tool calls, delegation, or capture.
