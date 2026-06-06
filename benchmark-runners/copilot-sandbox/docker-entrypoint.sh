#!/usr/bin/env bash
set -euo pipefail

if [ ! -d /workspace ]; then
  echo "AgentOps benchmark runner requires /workspace to be mounted." >&2
  exit 64
fi

if [ ! -d "${COPILOT_HOME:-/copilot-home}" ]; then
  echo "AgentOps benchmark runner requires COPILOT_HOME to point at a mounted directory." >&2
  exit 64
fi

if ! command -v "${1:-copilot}" >/dev/null 2>&1; then
  echo "AgentOps benchmark runner could not find command: ${1:-copilot}" >&2
  echo "Build a private derived image that installs your licensed Copilot CLI at /usr/local/bin/copilot." >&2
  exit 127
fi

exec "$@"
