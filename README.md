# Copilot CLI AgentOps for Azure

> Independent personal OSS project. Not an official Microsoft, GitHub, OpenAI, Azure, or Grafana product.

Privacy-first observability for GitHub Copilot CLI runs in Azure Monitor and Grafana. AgentOps records run/session metadata, tool names, failures, latency, token usage, and estimated cost without recording prompts, code, file contents, tool arguments, or tool results by default.

```text
GitHub Copilot CLI
  -> local OTLP endpoint on 127.0.0.1
  -> local OpenTelemetry Collector privacy boundary
  -> Azure Monitor / Application Insights / Log Analytics
  -> Azure Managed Grafana dashboards
```

## Quick Start

Prerequisites:

- Azure CLI logged in.
- Azure Developer CLI (`azd`) for the Bicep deployment.
- GitHub Copilot CLI installed and authenticated.
- No Docker required: `./setup-agentops.sh` installs the tested local OpenTelemetry Collector binary. Docker is only an optional fallback.

```bash
az login
azd provision
./setup-agentops.sh
export PATH="$HOME/.local/bin:$PATH"
agentops configure import-azd
agentops collector start --mode auto --privacy strict
copilot --no-ask-user --no-remote --add-dir . --allow-tool='shell(pwd)' --allow-tool='shell(ls:*)' -p 'Do not edit files. Run pwd and ls docs | head, then summarize.'
agentops latest --last 2h
agentops open
```

If `collector start --mode auto` cannot find a collector binary and Docker is not running, it fails with setup instructions. It does not silently run Copilot without the local privacy boundary. Install the binary any time with:

```bash
agentops collector install-binary
```

## Core Commands

```text
agentops setup
agentops install
agentops uninstall
agentops status
agentops doctor
agentops configure show|set|import-azd
agentops collector start|stop|status|validate|smoke|install-binary|uninstall-binary
agentops copilot [...args]
agentops latest
agentops replay
agentops open
agentops validate-azure
agentops validate-enterprise
agentops plugin install|uninstall
agentops e2e run
agentops e2e report
agentops e2e browser-check
```

Everything else is under `agentops experimental ...` or documented as experimental.

## Safe Defaults

Captured by default:

- session/run identifiers
- operation and tool names
- model names
- duration and success/failure
- token, cost, and AIU metadata when Copilot emits it
- hashed repo metadata
- simple hook/policy signals

Not captured by default:

- prompts or responses
- code or file contents
- tool arguments or tool results
- system instructions
- request or response bodies
- full URLs
- secrets

The local Collector is the scrub-before-export boundary. Direct/no-collector mode is advanced and unsafe: it requires `AGENTOPS_ALLOW_NO_COLLECTOR=1` or `--unsafe-no-collector`.

Enterprise-safe, cost-bounded setup is the intended default: metadata-only telemetry, localhost collection, capped Azure ingestion profiles, and disabled automation until explicitly enabled.

## Collector Modes

`AGENTOPS_COLLECTOR_MODE=auto` is the default.

- `auto`: prefer a configured/found local Collector binary, then Docker Compose, then fail closed.
- `binary`: run `AGENTOPS_OTELCOL_BIN`, `otelcol-contrib`, or compatible `otelcol`.
- `docker`: run the bundled Compose file with localhost-only ports.
- `none`: do not start a collector; explicit unsafe opt-in required.

See [Collector modes](docs/collector-modes.md).

## Privacy Modes

`AGENTOPS_PRIVACY_MODE=strict` is the default.

- `strict`: allowlist safe metadata and drop/redact everything else before export.
- `compat`: current denylist scrubber for compatibility with older dashboards or collectors.

See [Privacy modes](docs/privacy-modes.md).

## Plugin And Hooks

`agentops install` installs local shims and the tested Collector binary. It also installs a plain `copilot` shim by default so normal Copilot CLI runs are observed when `~/.local/bin` is first on `PATH`. Plugin files are explicit and reversible:

```bash
agentops plugin install
agentops plugin uninstall
```

The bundled `preToolUse` hook is a transparent demo guardrail. It can block obvious risky patterns such as fake secret reads, but it is not a full security boundary.

## What This Is Not Yet

- Not an official Microsoft/GitHub/Azure/OpenAI/Grafana product.
- Not a hosted service.
- Not a complete agent governance platform.
- Not a full security boundary.
- Policy hooks, benchmarks, Codex support, MCP analyst workflows, custom events, actioners, and advanced dashboards are experimental.

## Validation

Offline checks:

```bash
npm --prefix agentops-cli test
agentops doctor --json
agentops validate-enterprise --json
agentops collector validate --mode auto --privacy strict --json
agentops collector smoke --privacy strict --poison --json
```

Live E2E:

```bash
agentops e2e run --live --browser-report --last 2h --json
agentops e2e report --last 2h --out .agentops/e2e/latest/report.html
agentops e2e browser-check --report .agentops/e2e/latest/report.html --json
```

`browser-check` validates the local static report and can capture screenshots when Playwright is available:

```bash
AGENTOPS_E2E_PLAYWRIGHT=1 AGENTOPS_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  agentops e2e browser-check --report .agentops/e2e/latest/report.html --playwright --grafana --json
```

Azure Managed Grafana validation may still require the user’s normal signed-in browser.

See [E2E validation](docs/e2e-validation.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Collector modes](docs/collector-modes.md)
- [Privacy modes](docs/privacy-modes.md)
- [Secure by default](docs/secure-by-default.md)
- [Threat model](docs/threat-model.md)
- [E2E validation](docs/e2e-validation.md)
- [Experimental features](docs/experimental-features.md)
- [Advanced usage](docs/advanced-usage.md)
- [Dashboard tour](docs/dashboard-tour.md)

## Remove It

```bash
agentops collector stop
agentops plugin uninstall
agentops uninstall
```
