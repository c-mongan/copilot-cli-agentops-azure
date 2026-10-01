# Vally pin record (Task 9, bullet 3)

All commands below were run from `evals/stockpilot/` on 2026-10-01. None
of them execute an agent, make a model call, or spend a token budget —
see the per-command notes. No `vally eval`, `vally experiment run`
(without `--dry-run`), or `vally compare` was run.

## 1. Registry resolution (`npm view` — package manager metadata only)

```
$ npm view @microsoft/vally-cli@0.17.0
@microsoft/vally-cli@0.17.0 | MIT | deps: 10 | versions: 18
CLI for Vally — the evaluation platform for AI agents
...
dependencies:
@azure/monitor-opentelemetry-exporter: ^1.0.0-beta.32
@microsoft/vally-server: ^0.17.0
@microsoft/vally: ^0.17.0
@opentelemetry/api: ^1.9.1
@opentelemetry/exporter-trace-otlp-http: ^0.222.0
@opentelemetry/resources: ^2.11.0
@opentelemetry/sdk-trace-base: ^2.11.0
@opentelemetry/sdk-trace-node: ^2.11.0
@vscode/deviceid: ~0.1.5
commander: ^15.0.0

$ npm view @microsoft/vally@0.17.0
@microsoft/vally@0.17.0 | MIT | deps: 9 | versions: 18
Core library for Vally — the evaluation platform for AI agents
...
dependencies:
@github/copilot-sdk: 1.0.14
@github/copilot: 1.0.85
@modelcontextprotocol/sdk: ^1.30.0
@opentelemetry/api: ^1.9.1
js-tiktoken: ^1.0.21
mdast-util-from-markdown: ^2.0.3
picomatch: ^4.0.7
yaml: ^2.9.1
zod: ^4.6.5
```

Both packages resolve. `0.17.0` is the `latest` dist-tag for both at fetch
time.

## 2. Isolated install (`npm install` — package manager operation, not a model call)

```
$ cd evals/stockpilot && npm install --no-audit --no-fund
added 182 packages in 14s
```

Installed into `evals/stockpilot/node_modules/` (gitignored, like every
other `node_modules/` in this repo — see root `.gitignore`). Resolved
tree recorded in `evals/stockpilot/package-lock.json` (committed).
`agentops-cli/package.json` was not touched.

## 3. Bundled Copilot version vs. native (`npm view` / installed package.json / `copilot --version`)

```
$ cat node_modules/@microsoft/vally/package.json | grep -A1 '"@github/copilot"'
"@github/copilot": "1.0.85",
$ cat node_modules/@github/copilot/package.json | grep '"version"'
  "version": "1.0.85",
$ cat node_modules/@github/copilot-sdk/package.json | grep '"version"'
    "version": "1.0.14",

$ copilot --version      # run directly, NOT via Vally
GitHub Copilot CLI 1.0.90.
Run 'copilot update' to check for updates.
```

**Bundled (Vally's executor): `@github/copilot@1.0.85` / `@github/copilot-sdk@1.0.14`.
Native (this environment's installed CLI): `1.0.90`.** These are
different binaries at different versions and must not be conflated — a
Vally trial runs the bundled 1.0.85, never whatever `copilot` resolves to
on `$PATH`. (The plan's own research section anticipated native `1.0.89`;
the environment's actual native install reports `1.0.90` — recorded here
as the freshly re-verified number, since `copilot --version` was
available to run directly.)

## 4. CLI command surface (`vally --help` and every subcommand `--help` — zero execution)

```
$ vally --version
0.17.0

$ vally --help
USAGE
  vally [options] [command]
...
COMMANDS
  init [options] [dir]                   Scaffold a starter eval.yaml
  lint [options] [path]                  Static checks for skills and eval specs (fast, no execution)
  eval [options]                         Run stimuli against an agent and grade the results
  grade [options]                        Grade trajectories from stdin using graders defined in an eval spec
  oracle [options]                       Materialize golden inputs and optionally grade them, without running an agent
  compare [options] [experiment-dir]     Compare a treatment run against a baseline (experiment dir or two run dirs)
  export [options] [exporterOptions...]  Export eval.yaml to an external tool format
  serve [options] [directory]            Start an analytics server for eval results
  ingest [options] <directory>           Import eval results from an output directory into a SQLite database
  experiment                             Run experiments — controlled comparisons across eval variants
  help [command]                         display help for command
```

This matches the plan's research description of Vally's command surface.
Every subcommand's own `--help` was also captured (not reproduced in
full here; see shell history / re-run `vally <command> --help` to
reproduce) — key flags extracted:

- `vally eval --require-pass`: "Exit non-zero when a valid eval verdict fails (errors always exit non-zero)".
- `vally eval --otlp-endpoint <url>`: "Export OpenTelemetry traces to this OTLP/HTTP endpoint. When omitted, traces are written to the output directory." — see `vally/README.md` for how this differs from Vally's own opted-out usage telemetry.
- `vally experiment run --dry-run`: "Resolve the experiment and print the plan without executing." (used below)
- `vally experiment run --compare`: "Requires a judge model — spends tokens." (never run)
- `vally compare --judge-model`: standalone LLM-judged comparison (never run).
- `vally lint`: "Static checks for skills and eval specs (fast, no execution)" (used below).

## 5. `vally lint` on this fixture's real eval specs (zero execution)

```
$ vally lint --eval-spec vally/eval.stockpilot-smoke.yaml --verbose
Eval: vally/eval.stockpilot-smoke.yaml
⚠ warning [regression-without-baseline] type is 'regression' but no baseline configuration found
  1 warning(s)

$ vally lint --eval-spec vally/eval.stockpilot-f3-thrash.yaml --verbose
Eval: vally/eval.stockpilot-f3-thrash.yaml
⚠ warning [regression-without-baseline] type is 'regression' but no baseline configuration found
  1 warning(s)
```

Both eval specs parse and validate against the real schema. The one
warning is advisory (this repo's eval specs are `type: regression` but
don't declare a `baseline:` block within the eval.yaml itself — the
baseline/treatment comparison instead lives one level up, in
`experiment.yaml`, which is the correct place for a single-change
variant comparison). Not an error.

## 6. `vally experiment run --dry-run` on the real single-change experiment file (zero execution)

```
$ vally experiment run vally/experiment.yaml --dry-run --workers 1
Experiment: stockpilot-planted-tool-thrash-single-change
Baseline:   healthy-base
Plans:      2

── healthy-base (baseline) ──
  Eval:        stockpilot-f3-batch-alerts
  File:        eval.stockpilot-f3-thrash.yaml
  Model:       gpt-5.5
  Config hash: 51c7b797a24f5943
  Eval hash:   06d7a1899ff20484

── planted-tool-thrash ──
  Eval:        stockpilot-f3-batch-alerts
  File:        eval.stockpilot-f3-thrash.yaml
  Model:       gpt-5.5
  Config hash: a36b6eb5dd212105
  Eval hash:   06d7a1899ff20484
```

This is real, concrete proof (not merely a schema guess) that:

- The experiment file's `vary: [/environment/skills]` + two-variant
  declaration resolves without error against Vally's real experiment
  engine.
- Each variant produces a **different** `Config hash` (confirming the
  engine sees the one skill-directory swap as a real configuration
  difference) while both resolve the **same** `Eval hash` (confirming
  the underlying eval spec — prompt, constraints, graders — is identical
  across variants; only the swapped skill directory differs, which is
  exactly the single-change-isolation guarantee this task requires).
- `--workers 1` is accepted (the documented way to force
  `concurrency: 1`, since `execution.workers` in the YAML is only a
  default the CLI flag overrides).

No agent ran, no model was called, and no token budget was spent
producing this output — `--dry-run` only resolves and plans.
