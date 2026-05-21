#!/usr/bin/env bash
set -euo pipefail

subscription_id="${AZURE_SUBSCRIPTION_ID:-0222a208-955a-45fd-b6d8-ca4704421bf0}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
app_insights_name="${APPLICATIONINSIGHTS_NAME:-appi-copilot-agentops-dev}"
smoke_id="${AGENTOPS_SMOKE_ID:-agentops-$(date +%Y%m%d%H%M%S)}"

az account set --subscription "$subscription_id"

connection_string="$(az monitor app-insights component show \
  --resource-group "$resource_group" \
  --app "$app_insights_name" \
  --query connectionString \
  -o tsv)"

parsed="$(CONNECTION_STRING="$connection_string" node <<'NODE'
const parts = Object.fromEntries(process.env.CONNECTION_STRING.split(';').filter(Boolean).map(part => {
  const index = part.indexOf('=');
  return [part.slice(0, index), part.slice(index + 1)];
}));
if (!parts.InstrumentationKey || !parts.IngestionEndpoint) {
  throw new Error('Application Insights connection string is missing required fields');
}
const endpoint = parts.IngestionEndpoint.endsWith('/') ? parts.IngestionEndpoint : `${parts.IngestionEndpoint}/`;
console.log(JSON.stringify({ instrumentationKey: parts.InstrumentationKey, endpoint }));
NODE
)"

instrumentation_key="$(printf '%s' "$parsed" | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).instrumentationKey")"
ingestion_endpoint="$(printf '%s' "$parsed" | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).endpoint")"
payload_file="/tmp/${smoke_id}.appinsights.json"

SMOKE_ID="$smoke_id" INSTRUMENTATION_KEY="$instrumentation_key" node >"$payload_file" <<'NODE'
const smokeId = process.env.SMOKE_ID;
const instrumentationKey = process.env.INSTRUMENTATION_KEY;
process.stdout.write(JSON.stringify({
  name: `Microsoft.ApplicationInsights.${instrumentationKey}.Event`,
  time: new Date().toISOString(),
  iKey: instrumentationKey,
  data: {
    baseType: 'EventData',
    baseData: {
      ver: 2,
      name: 'AgentOpsSmokeTest',
      properties: {
        smokeId,
        source: 'scripts/azure-smoke-appinsights.sh',
        contentCapture: 'disabled',
        profile: 'safe-default'
      }
    }
  }
}));
NODE

curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data-binary "@$payload_file" \
  "${ingestion_endpoint}v2/track" >/tmp/${smoke_id}.appinsights.response

cat <<MSG
Sent Application Insights smoke event.
smokeId=${smoke_id}
app=${app_insights_name}
resourceGroup=${resource_group}

Query it with:
az monitor app-insights query \\
  --resource-group ${resource_group} \\
  --app ${app_insights_name} \\
  --analytics-query "customEvents | where name == 'AgentOpsSmokeTest' | where customDimensions.smokeId == '${smoke_id}' | project timestamp, name, customDimensions"
MSG