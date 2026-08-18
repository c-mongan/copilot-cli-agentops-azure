#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$#" -eq 1 && ( "$1" == "--help" || "$1" == "-h" ) ]]; then
  exec "${script_dir}/install-agentops.sh" --help
fi

start_collector=true
shadow_copilot=false
for arg in "$@"; do
  if [[ "${arg}" == "--no-collector" ]]; then
    start_collector=false
  fi
  if [[ "${arg}" == "--shadow-copilot" || "${arg}" == "--shadow" ]]; then
    shadow_copilot=true
  fi
  if [[ "${arg}" == "--no-shadow-copilot" || "${arg}" == "--no-shadow" ]]; then
    shadow_copilot=false
  fi
done

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

if [[ "${start_collector}" == true ]]; then
  echo
  if node "${script_dir}/agentops-cli/src/index.js" collector start --mode local --privacy strict; then
    echo "Collector is running."
  else
    echo "Collector did not start yet. Install the local binary with: agentops collector install-binary"
  fi
fi

echo
node "${script_dir}/agentops-cli/src/index.js" doctor || true

cat <<'MSG'

Next: make sure ~/.local/bin is on PATH for this shell:
  export PATH="$HOME/.local/bin:$PATH"

Then run Copilot with AgentOps:
  agentops copilot --no-ask-user --no-remote --add-dir . --allow-tool='shell(pwd)' --allow-tool='shell(ls:*)' -p "Do not edit files. Run pwd and ls docs | head, then summarize."

Useful checks:
  agentops latest --last 2h
  agentops open
  agentops validate-azure --last 24h

Optional plugin helpers:
  agentops plugin install

If configure import-azd did not find Azure outputs, run:
  az login
  azd provision
  agentops configure import-azd
MSG

if [[ "${shadow_copilot}" == true ]]; then
  echo "Plain copilot is also routed through AgentOps because --shadow-copilot was selected."
else
  echo "Plain copilot is unchanged. Opt in later with: agentops experimental enable-shadow"
fi
