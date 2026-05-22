#!/usr/bin/env bash
set -euo pipefail

install_dir="${AGENTOPS_BIN_DIR:-${HOME}/.local/bin}"
keep_agentops=false

usage() {
  cat <<'MSG'
Usage:
  ./scripts/uninstall-copilot-agentops-shim.sh [--keep-agentops-command]

Removes the plain `copilot` shadow shim and, by default, the explicit
`copilot-agentops` command from ~/.local/bin.

Options:
  --keep-agentops-command  Remove only the plain `copilot` shadow shim.
MSG
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-agentops-command)
      keep_agentops=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

shadow_cmd="${install_dir}/copilot"
agentops_cmd="${install_dir}/copilot-agentops"

if [[ -e "${shadow_cmd}" || -L "${shadow_cmd}" ]]; then
  rm -f "${shadow_cmd}"
  echo "Removed plain copilot shadow shim:"
  echo "  ${shadow_cmd}"
else
  echo "No plain copilot shadow shim found at:"
  echo "  ${shadow_cmd}"
fi

if [[ "${keep_agentops}" != true ]]; then
  if [[ -e "${agentops_cmd}" || -L "${agentops_cmd}" ]]; then
    rm -f "${agentops_cmd}"
    echo "Removed explicit copilot-agentops command:"
    echo "  ${agentops_cmd}"
  else
    echo "No copilot-agentops command found at:"
    echo "  ${agentops_cmd}"
  fi
fi

cat <<'MSG'

Stop the Azure Monitor collector with:
  docker compose -f collector/docker-compose.azuremonitor.yaml down
MSG
