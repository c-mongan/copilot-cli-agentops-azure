#!/usr/bin/env bash
# Imports / updates the Copilot CLI AgentOps dashboards in Azure Managed Grafana.
# Source of truth: grafana/agentops-dashboard.json and grafana/agentops-*.json
#
# Required env (auto-resolved from azd env when run as an azd hook):
#   AZURE_RESOURCE_GROUP   e.g. rg-copilot-agentops-dev
#   GRAFANA_NAME           e.g. graf-copilotagentops-...
# Optional:
#   GRAFANA_FOLDER         folder title (default: "AgentOps")
#   DASHBOARD_JSON         path to one dashboard JSON (default: import the full dashboard pack)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GRAFANA_FOLDER="${GRAFANA_FOLDER:-AgentOps}"

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
else
  DASHBOARD_FILES=(
    "${REPO_ROOT}/grafana/agentops-dashboard.json"
    "${REPO_ROOT}/grafana/agentops-sessions.json"
    "${REPO_ROOT}/grafana/agentops-session-detail.json"
    "${REPO_ROOT}/grafana/agentops-traces-spans.json"
    "${REPO_ROOT}/grafana/agentops-tools-mcp.json"
    "${REPO_ROOT}/grafana/agentops-runtime-events.json"
    "${REPO_ROOT}/grafana/agentops-safety-policy.json"
    "${REPO_ROOT}/grafana/agentops-quality.json"
    "${REPO_ROOT}/grafana/agentops-experiments.json"
    "${REPO_ROOT}/grafana/agentops-data-quality.json"
  )
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

for dashboard_file in "${DASHBOARD_FILES[@]}"; do
  echo "Importing dashboard '${dashboard_file##*/}' into Grafana '${GRAFANA_NAME}' (folder: ${GRAFANA_FOLDER})..."

  # Build the definition payload Grafana expects: {"dashboard": {...}, "overwrite": true}
  TMP_DEF="$(mktemp -t agentops-dash.XXXXXX.json)"
  python3 - "${dashboard_file}" "${TMP_DEF}" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src) as f:
    dashboard = json.load(f)
# Let Grafana assign id on first import; keep stable uid for upsert.
dashboard["id"] = None
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
