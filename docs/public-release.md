# Public Release Checklist

Use this checklist before publishing this repo publicly. Treat it as a release gate, not a suggestion list.

## Publish From A Fresh History

Do not push the existing local Git history to a public repository. Earlier local commits may contain deployment-specific notes or generated research artifacts that are no longer in the working tree.

The safest path is a fresh export directory:

```bash
rsync -a --exclude .git --exclude .copilot-goals --exclude .pytest_cache ./ ../copilot-cli-agentops-azure-public/
cd ../copilot-cli-agentops-azure-public
git init -b main
git add -A
git commit -m "Initial public release"
gh repo create cmongan/copilot-cli-agentops-azure --public --source=. --remote=origin --push
```

An orphan branch also works, but a fresh export makes it harder to accidentally publish old local history.

## Preflight Checks

Run these checks from the repo root:

```bash
npm --prefix agentops-cli test
node --check agentops-cli/src/index.js
node --check scripts/build-grafana-dashboard-pack.js
node --check scripts/validate-grafana-dashboard-kql.js
node scripts/build-grafana-dashboard-pack.js
docker compose -f collector/docker-compose.yaml config >/tmp/agentops-compose.yaml
docker compose -f collector/docker-compose.azuremonitor.yaml config >/tmp/agentops-azuremonitor-compose.yaml
az bicep build --file infra/bicep/main.bicep --stdout >/tmp/agentops-main-arm.json
git diff --check
```

Also run a clean export verification so the README path is not accidentally relying on ignored files, local config, or the current Git directory:

```bash
rm -rf /tmp/copilot-cli-agentops-azure-public-check
rsync -a --exclude .git --exclude node_modules --exclude .agentops --exclude benchmarks/runs ./ /tmp/copilot-cli-agentops-azure-public-check/
cd /tmp/copilot-cli-agentops-azure-public-check
npm --prefix agentops-cli test
node agentops-cli/src/index.js doctor --local-only
```

Search for deployment-specific identifiers before publishing:

```bash
rg -n "InstrumentationKey|connectionString|Connection String|Bearer |client_secret|AZURE_TENANT_ID|tenantId|subscriptionId|workspaceId|grafana-token|api_key|PRIVATE KEY" .
```

Placeholders such as `<workspace-id>`, `00000000-0000-0000-0000-000000000000`, and `https://<your-grafana>.grafana.azure.com` are expected.

Search for common local and tenant-specific leaks:

```bash
rg -n "/Users/|C:\\\\Users\\\\|rg-copilot|graf-[a-z0-9-]+\\.grafana\\.azure\\.com|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" README.md docs infra agentops-cli collector copilot grafana kql plugin scripts setup-agentops.sh setup-agentops.ps1
```

Allow only documented placeholders, generated IDs inside demo fixtures, or intentionally generic examples.

Confirm the public safety files are present:

```bash
test -f DISCLAIMER.md
test -f SECURITY.md
test -f CONTRIBUTING.md
test -f OPEN_SOURCE_REVIEW.md
```

Confirm the README clearly states that this is an independent personal project and not an official Microsoft, GitHub, OpenAI, Azure, or Grafana product.

## Runtime Configuration

Users should set their own environment values:

```bash
export AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
export AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID="<workspace-id>"
export AGENTOPS_GRAFANA_BASE_URL="https://<your-grafana>.grafana.azure.com"
```

Do not commit `.env` files, connection strings, Grafana tokens, or raw telemetry exports.

## Release Position

Recommended public positioning:

- preview OSS project
- safe-by-default metadata observability
- Azure-first, not cloud-neutral
- content capture opt-in only
- dashboards may show expected empty states until users generate matching telemetry
- alerts and automation are disabled by default and require local threshold tuning
