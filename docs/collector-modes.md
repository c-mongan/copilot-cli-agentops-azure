# Collector Modes

The safe path always uses a local OpenTelemetry Collector.

## Modes

- `auto`: default. Use `AGENTOPS_OTELCOL_BIN`, then the AgentOps-installed binary, then `otelcol-contrib`/`otelcol` on `PATH`, then Docker Compose.
- `binary`: run a local Collector binary. PID and logs live under `~/.agentops/collector/`.
- `docker`: run the bundled Docker Compose collector with localhost-only host ports.
- `none`: advanced unsafe mode. Requires `AGENTOPS_ALLOW_NO_COLLECTOR=1` or `--unsafe-no-collector`.

## No-Docker Setup

The normal install path does not require Docker:

```bash
./setup-agentops.sh
```

To install only the Collector binary:

```bash
agentops collector install-binary
```

AgentOps downloads the tested `otelcol-contrib` release into `~/.agentops/collector/bin/`, verifies its SHA256 checksum from the official release checksum file, and validates the strict config before reporting success. Override the version only when testing a Collector upgrade:

```bash
agentops collector install-binary --version 0.151.0 --force
```

## Commands

```bash
agentops collector status --json
agentops collector start --mode auto --privacy strict
agentops collector validate --mode auto --privacy strict --json
agentops collector smoke --privacy strict --poison --json
agentops collector stop --mode auto
agentops collector uninstall-binary
```

If neither Docker nor a Collector binary is available, `auto` fails closed with setup instructions.
