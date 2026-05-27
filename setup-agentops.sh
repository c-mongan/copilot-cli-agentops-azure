#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${script_dir}/install-agentops.sh" "$@"

echo
node "${script_dir}/agentops-cli/src/index.js" setup

echo
if command -v azd >/dev/null 2>&1; then
  if node "${script_dir}/agentops-cli/src/index.js" configure import-azd; then
    echo "Imported Azure deployment outputs from azd."
  else
    echo "No usable azd AgentOps outputs found yet. Run azd provision, then agentops configure import-azd."
  fi
else
  echo "azd not found. Configure Azure values manually or install azd and run azd provision."
fi

echo
node "${script_dir}/agentops-cli/src/index.js" init --dry-run

cat <<'EOF'

Next: make sure ~/.local/bin is on PATH for this shell:
  export PATH="$HOME/.local/bin:$PATH"

Then run:
  agentops validate-enterprise
  agentops validate-azure
  agentops smoke --wait 2m --poll 10s
  agentops copilot -p "Reply with exactly: agentops smoke."
  agentops latest --last 2h
  agentops open

If configure import-azd did not find Azure outputs, run:
  az login
  azd provision
  agentops configure import-azd
EOF
