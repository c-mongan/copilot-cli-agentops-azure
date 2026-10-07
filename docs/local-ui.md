# Local web UI

`agentops ui` opens a local, read-only web UI for the Copilot CLI sessions on your machine. It needs no Azure, no Docker, no build step and no network. It has zero dependencies: Node's built-in `http` server serves plain HTML, CSS and JavaScript. Nothing is fetched from a CDN, so it also works offline.

![Run detail: failure callout, span waterfall with a denied shell call, cumulative token and cost meter, and per-tool latency table](images/ui-run-detail-light.png)

## Quick start

You need Node.js 20+ and at least one Copilot CLI session on this machine.

```bash
git clone https://github.com/c-mongan/copilot-cli-agentops-azure && cd copilot-cli-agentops-azure
alias agentops="node $PWD/agentops-cli/src/index.js"

agentops ui                 # runs list; opens your browser when run in a terminal
agentops ui latest          # jump straight to the newest run's waterfall
agentops open latest --ui   # same thing, from the run receipt command
```

The command prints `AgentOps UI running at http://127.0.0.1:<port>/`. Press `Ctrl+C` to stop it.

| Option | Effect |
|---|---|
| `--open` / `--no-open` | Launch the browser, or only print the URL. By default it opens only in an interactive terminal outside CI. |
| `--port <n>` | Bind a fixed port. The default is a free port chosen by the operating system. |
| `--limit <n>` | Analyse the newest `n` sessions (default 100, maximum 5000). |
| `--allow-content` | Also serve redacted prompts, tool arguments and results for local sessions. See [privacy](#privacy). |
| `--copilot-home`, `--agentops-home` | Read from other homes than `~/.copilot` and `~/.agentops`. |

**Time to first graph** (measured 2026-10-07 on macOS, Node 22, 1,888 local sessions, from a clean `env -i` shell to a rendered waterfall):

| Path | Cold | Warm |
|---|---|---|
| `agentops ui latest` → waterfall rendered | 2.2 s (URL printed after 1.9 s) | 0.44 s |
| `agentops ui` → runs list rendered (newest 100) | 1.5 s | — |

The browser was already running during these measurements.

## Screens

### Runs home

![Runs home: KPI strip, filters and a list of real Copilot CLI sessions](images/ui-home-light.png)

- **KPI strip:** runs, failed runs, p95 tool latency, total tokens in/out and estimated cost.
- **Runs table:** newest first. Each row shows when the run started, repository (basename only), model, duration, tokens in/out, tool calls, failures and a status pill (`ok`, `failed`, `incomplete`).
- **Filters:** model, repository, status and a search box. Filters are kept in the URL, so you can reload or share a view on the same machine.

Sources are Copilot CLI session folders (`~/.copilot/session-state/*/events.jsonl`) and AgentOps ledger runs (`~/.agentops/runs`). A session that also has a ledger run is merged into one row.

### Run detail

- **Failure callout:** for example "1 tool call denied: bash". It uses only the tool name and outcome, never arguments.
- **Waterfall:** session → hooks, turns → chat calls and tool calls, on a shared time axis. Bars are coloured by kind; failed spans are red. Hover or focus a row to inspect it; click to pin. The inspector shows metadata only: kind, tool name, duration, status, token counts and span ID. Duplicate spans with the same span ID are shown once.
- **Token and cost meter:** cumulative tokens and estimated cost along the same time axis.
- **Tool latency:** count, p50, p95, max and failures per tool.
- **Tokens by model:** input, output, cache reads and estimated cost per model.

![Run detail in dark mode](images/ui-run-detail-dark.png)

### Keyboard

| Key | Runs home | Run detail |
|---|---|---|
| `/` | Focus search | — |
| `↑` `↓` / `j` `k` | Move between runs | Move between spans |
| `Home` `End` | — | First / last span |
| `Enter` | Open run | Pin span in the inspector |
| `←` `→` | — | Collapse / expand a span |
| `Esc` | Clear search (in the search box) | Back to the runs list |
| `r` | Reload runs | — |
| `t` | Cycle theme: system, light, dark | Same |

The theme follows `prefers-color-scheme` until you pick one. Motion is reduced when the operating system asks for it.

## Privacy

- **Loopback only.** The server binds to `127.0.0.1` and rejects requests whose `Host` header is not `127.0.0.1`, `localhost` or `[::1]` on its own port. This blocks DNS-rebinding attacks.
- **Read-only.** Only `GET` and `HEAD` are accepted. The UI never writes to `~/.copilot` or `~/.agentops`.
- **Metadata only by default.** The data layer copies only whitelisted fields from each event: types, timestamps, tool names, outcomes, models and token counts. Prompts, responses, reasoning, tool arguments, tool results and error messages are never parsed into API responses. Repositories are shown by basename only; branches and parent directories are not shown. Unit tests plant canary strings in every content field of the real event shapes and assert that none reach the API.
- **`--allow-content`** adds a per-run content endpoint for local Copilot CLI sessions only (not for ledger-only runs). Text goes through the same secret redaction as `copilot-session view`. Use it only on your own machine.
- **Hardened responses.** A strict Content Security Policy (`default-src 'none'`, same-origin scripts and styles only), `nosniff`, `no-referrer` and `no-store` on API responses. The client renders with `textContent` only.

## Estimated cost

Copilot CLI bills by premium requests, not tokens, and emits no cost metadata. The UI multiplies observed tokens by public API list prices to give an order-of-magnitude estimate. It is always labelled "est." and is never billed cost.

- The price table lives in one file, [`agentops-cli/src/lib/ui/pricing.js`](../agentops-cli/src/lib/ui/pricing.js), with its date and source links ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing)).
- Cache reads and writes are priced at their own rates and the rest of the input at the input rate.
- If any model in a run is not in the table, the run's cost shows "—" instead of a partial sum. The KPI strip shows how many runs are unpriced.

## Known limits

- Per-call token points need an AgentOps ledger run (`agentops copilot-session launch`). For plain Copilot CLI sessions the meter shows one end-of-session point from the shutdown totals. With a ledger, the estimated cost is spread across calls by token share so it ends at the run's figure.
- Only the newest 100 sessions are analysed by default. Use `--limit` for more.
- A session that is still running, or ended without a shutdown event, is shown as `incomplete` with partial data.
- A shell command that exits non-zero is a successful tool call to Copilot CLI. The UI counts it as a warning, not a failure.
- The UI reads local files only. For team-wide views, use the [Azure Workbook](enterprise-workbook.md) or [Grafana](grafana-dashboard-tour-v2.md).
