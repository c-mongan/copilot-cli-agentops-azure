# Contributing

Contributions are welcome if they keep the project safe, generic, and useful for public Copilot/OpenTelemetry/Azure Monitor observability scenarios.

## Ground Rules

- Do not include confidential information, customer data, private tenant details, internal URLs, private prompts, or proprietary agent definitions.
- Do not include generated telemetry from real work or production systems.
- Keep OpenTelemetry content capture disabled by default.
- Prefer examples that use placeholders such as `<workspace-id>` and `https://<your-grafana>.grafana.azure.com`.
- Keep dashboards and KQL compatible with native Copilot OTel where possible, not only wrapper-specific telemetry.
- Add or update tests for CLI behavior and generated dashboard/query contracts.

## Development

Run the main checks before opening a pull request:

```bash
npm --prefix agentops-cli test
node scripts/build-grafana-dashboard-pack.js
git diff --check
```

Optional local validation:

```bash
bash -n copilot/copilot-observe scripts/copilot-agentops scripts/install-copilot-agentops-shim.sh scripts/uninstall-copilot-agentops-shim.sh setup-agentops.sh
node -e "const fs=require('fs'); for (const f of fs.readdirSync('grafana').filter(f=>f.endsWith('.json'))) JSON.parse(fs.readFileSync('grafana/'+f,'utf8')); console.log('grafana json ok')"
```

## Public Release Hygiene

Before publishing or cutting a release, follow [docs/public-release.md](docs/public-release.md).
