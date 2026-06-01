#!/usr/bin/env bash
# Imports / updates the Copilot CLI AgentOps dashboards in Azure Managed Grafana.
# Source of truth: grafana/agentops-dashboard.json, grafana/agentops-*.json,
# and grafana/dashboards/v2/*.json.
#
# Required env (auto-resolved from azd env when run as an azd hook):
#   AZURE_RESOURCE_GROUP   e.g. rg-agentops-dev
#   GRAFANA_NAME           e.g. graf-agentops-dev
# Optional:
#   GRAFANA_FOLDER         folder title (default: "AgentOps")
#   DASHBOARD_JSON         path to one dashboard JSON (default: import the full dashboard pack)
#   AGENTOPS_INCLUDE_V2    include V2 control-room dashboards (default: true)
#   AGENTOPS_V2_ONLY       import only V2 control-room dashboards (default: false)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ "${AGENTOPS_V2_ONLY:-false}" == "true" ]]; then
  GRAFANA_FOLDER="${GRAFANA_FOLDER:-AgentOps for Azure}"
else
  GRAFANA_FOLDER="${GRAFANA_FOLDER:-AgentOps}"
fi

# Pull from azd env if not set explicitly
if [[ -z "${AZURE_RESOURCE_GROUP:-}" || -z "${GRAFANA_NAME:-}" ]]; then
  if command -v azd >/dev/null 2>&1 && azd env get-values >/dev/null 2>&1; then
    eval "$(azd env get-values | grep -E '^(AZURE_RESOURCE_GROUP|GRAFANA_NAME)=' || true)"
  fi
fi

if [[ -z "${AZURE_RESOURCE_GROUP:-}" ]]; then
  echo "ERROR: AZURE_RESOURCE_GROUP not set (and azd env has no value)." >&2
  exit 2
fi

if [[ -z "${GRAFANA_NAME:-}" ]]; then
  echo "Resolving Grafana instance in ${AZURE_RESOURCE_GROUP}..." >&2
  GRAFANA_NAME="$(az grafana list -g "${AZURE_RESOURCE_GROUP}" --query '[0].name' -o tsv 2>/dev/null || true)"
fi

if [[ -z "${GRAFANA_NAME}" ]]; then
  echo "ERROR: no Azure Managed Grafana instance found in ${AZURE_RESOURCE_GROUP}." >&2
  exit 2
fi

if [[ -n "${DASHBOARD_JSON:-}" ]]; then
  if [[ ! -f "${DASHBOARD_JSON}" ]]; then
    echo "ERROR: dashboard JSON not found at ${DASHBOARD_JSON}" >&2
    exit 2
  fi
  DASHBOARD_FILES=("${DASHBOARD_JSON}")
elif [[ "${AGENTOPS_V2_ONLY:-false}" == "true" ]]; then
  DASHBOARD_FILES=()
  while IFS= read -r dashboard_file; do
    DASHBOARD_FILES+=("${dashboard_file}")
  done < <(find "${REPO_ROOT}/grafana/dashboards/v2" -maxdepth 1 -name '*.json' -type f | sort)
else
  DASHBOARD_FILES=(
    "${REPO_ROOT}/grafana/agentops-dashboard.json"
    "${REPO_ROOT}/grafana/agentops-sessions.json"
    "${REPO_ROOT}/grafana/agentops-session-detail.json"
    "${REPO_ROOT}/grafana/agentops-live-replay.json"
    "${REPO_ROOT}/grafana/agentops-traces-spans.json"
    "${REPO_ROOT}/grafana/agentops-tools-mcp.json"
    "${REPO_ROOT}/grafana/agentops-attribution.json"
    "${REPO_ROOT}/grafana/agentops-runtime-events.json"
    "${REPO_ROOT}/grafana/agentops-safety-policy.json"
    "${REPO_ROOT}/grafana/agentops-permission-friction.json"
    "${REPO_ROOT}/grafana/agentops-alert-tuning.json"
    "${REPO_ROOT}/grafana/agentops-quality.json"
    "${REPO_ROOT}/grafana/agentops-experiments.json"
    "${REPO_ROOT}/grafana/agentops-data-quality.json"
  )
  if [[ "${AGENTOPS_INCLUDE_V2:-true}" == "true" && -d "${REPO_ROOT}/grafana/dashboards/v2" ]]; then
    while IFS= read -r dashboard_file; do
      DASHBOARD_FILES+=("${dashboard_file}")
    done < <(find "${REPO_ROOT}/grafana/dashboards/v2" -maxdepth 1 -name '*.json' -type f | sort)
  fi
fi

for dashboard_file in "${DASHBOARD_FILES[@]}"; do
  if [[ ! -f "${dashboard_file}" ]]; then
    echo "ERROR: dashboard JSON not found at ${dashboard_file}" >&2
    exit 2
  fi
done

if ! az extension show -n amg >/dev/null 2>&1; then
  echo "Installing 'amg' Azure CLI extension..." >&2
  az extension add -n amg --only-show-errors >/dev/null
fi

# Ensure folder exists (idempotent)
az grafana folder show -n "${GRAFANA_NAME}" --folder "${GRAFANA_FOLDER}" >/dev/null 2>&1 \
  || az grafana folder create -n "${GRAFANA_NAME}" --title "${GRAFANA_FOLDER}" --only-show-errors >/dev/null

URL="$(az grafana show -n "${GRAFANA_NAME}" -g "${AZURE_RESOURCE_GROUP}" --query 'properties.endpoint' -o tsv)"

SUBSCRIPTION_ID="${AGENTOPS_AZURE_SUBSCRIPTION_ID:-${AZURE_SUBSCRIPTION_ID:-}}"
if [[ -z "${SUBSCRIPTION_ID}" ]]; then
  SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
fi

WORKSPACE_RESOURCE_ID="${AGENTOPS_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID:-}"
WORKSPACE_NAME="${AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME:-${LOG_ANALYTICS_WORKSPACE_NAME:-}}"
WORKSPACE_ID="${AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID:-${LOG_ANALYTICS_WORKSPACE_ID:-}}"

if [[ -z "${WORKSPACE_RESOURCE_ID}" && -n "${WORKSPACE_NAME}" ]]; then
  WORKSPACE_RESOURCE_ID="$(az monitor log-analytics workspace show \
    -g "${AZURE_RESOURCE_GROUP}" \
    -n "${WORKSPACE_NAME}" \
    --query id \
    -o tsv 2>/dev/null || true)"
fi

if [[ -z "${WORKSPACE_RESOURCE_ID}" && -n "${WORKSPACE_ID}" ]]; then
  WORKSPACE_RESOURCE_ID="$(az monitor log-analytics workspace list \
    -g "${AZURE_RESOURCE_GROUP}" \
    --query "[?customerId=='${WORKSPACE_ID}'].id | [0]" \
    -o tsv 2>/dev/null || true)"
fi

if [[ -z "${WORKSPACE_RESOURCE_ID}" ]]; then
  WORKSPACE_RESOURCE_ID="$(az monitor log-analytics workspace list \
    -g "${AZURE_RESOURCE_GROUP}" \
    --query '[0].id' \
    -o tsv 2>/dev/null || true)"
fi

if [[ -z "${WORKSPACE_RESOURCE_ID}" ]]; then
  echo "ERROR: could not resolve a Log Analytics workspace in ${AZURE_RESOURCE_GROUP}." >&2
  echo "Set AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME or AGENTOPS_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID and retry." >&2
  exit 2
fi

DATASOURCE_UID="${AGENTOPS_GRAFANA_DATASOURCE_UID:-azure-monitor-oob}"
PORTAL_LOGS_URL="${AGENTOPS_AZURE_PORTAL_LOGS_URL:-https://portal.azure.com/#@/resource${WORKSPACE_RESOURCE_ID}/logs}"

for dashboard_file in "${DASHBOARD_FILES[@]}"; do
  echo "Importing dashboard '${dashboard_file##*/}' into Grafana '${GRAFANA_NAME}' (folder: ${GRAFANA_FOLDER})..."

  # Build the definition payload Grafana expects: {"dashboard": {...}, "overwrite": true}
  TMP_DEF="$(mktemp -t agentops-dash.XXXXXX.json)"
  python3 - "${dashboard_file}" "${TMP_DEF}" "${WORKSPACE_RESOURCE_ID}" "${DATASOURCE_UID}" "${PORTAL_LOGS_URL}" <<'PY'
import json, re, sys
src, dst, workspace_resource_id, datasource_uid, portal_logs_url = sys.argv[1:6]
workspace_pattern = re.compile(r"/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft\.OperationalInsights/workspaces/[^/?#'\"\s)]+")

def patch_value(value):
    if isinstance(value, str):
        return workspace_pattern.sub(workspace_resource_id, value).replace(
            "https://portal.azure.com/#@/resource" + workspace_resource_id + "/logs",
            portal_logs_url,
        )
    if isinstance(value, list):
        return [patch_value(item) for item in value]
    if isinstance(value, dict):
        if value.get("type") == "grafana-azure-monitor-datasource":
            value["uid"] = datasource_uid
        for key, item in list(value.items()):
            if key == "resources" and isinstance(item, list):
                value[key] = [workspace_resource_id]
            else:
                value[key] = patch_value(item)
    return value

with open(src) as f:
    dashboard = json.load(f)
# Let Grafana assign id on first import; keep stable uid for upsert.
dashboard["id"] = None
patch_value(dashboard)
payload = {"dashboard": dashboard, "overwrite": True}
with open(dst, "w") as f:
    json.dump(payload, f)
PY

  # Upsert dashboard (create if missing, update otherwise; overwrite:true handles both)
  az grafana dashboard create \
    -n "${GRAFANA_NAME}" \
    --folder "${GRAFANA_FOLDER}" \
    --definition "@${TMP_DEF}" \
    --overwrite true \
    --only-show-errors >/dev/null

  rm -f "${TMP_DEF}"
  DASH_UID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["uid"])' "${dashboard_file}")"
  echo "✓ Dashboard imported: ${URL}/d/${DASH_UID}"
done
