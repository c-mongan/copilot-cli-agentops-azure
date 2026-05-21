#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

chmod +x "$repo_root/copilot/copilot-observe"
chmod +x "$repo_root/collector/start.sh"
chmod +x "$repo_root/plugin/scripts/"*.js
chmod +x "$repo_root/agentops-cli/src/index.js"

cat <<MSG
Copilot CLI AgentOps for Azure local files are ready.

Next steps:
  source copilot/env.sample.sh
  ./collector/start.sh
  copilot-observe --help
MSG
