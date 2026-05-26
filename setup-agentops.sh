#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${script_dir}/install-agentops.sh" "$@"

echo
node "${script_dir}/agentops-cli/src/index.js" status

echo
node "${script_dir}/agentops-cli/src/index.js" init --dry-run

echo
node "${script_dir}/agentops-cli/src/index.js" workflows show latest-run

cat <<'EOF'

Next: make sure ~/.local/bin is on PATH for this shell:
  export PATH="$HOME/.local/bin:$PATH"

Then run:
  agentops configure set --resource-group <resource-group> --workspace-id <workspace-id> --grafana-url https://<your-grafana>.grafana.azure.com --grafana-name <grafana-resource-name> --app-insights-name <app-insights-name>
  agentops validate-azure
  agentops smoke --wait 2m --poll 10s
EOF
