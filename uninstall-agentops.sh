#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
remove_plugin=true
stop_collector=true
remove_binary=true
purge=false
shim_args=()

usage() {
  cat <<'MSG'
Usage:
  ./uninstall-agentops.sh [options]

Removes AgentOps shims, optional plugin files, and the local Collector binary.

Options:
  --keep-plugin       Leave Copilot plugin files installed.
  --keep-collector    Do not stop the local Collector.
  --keep-binary       Do not remove the installed Collector binary.
  --purge             Also remove Collector logs.
  --keep-agentops-command
                      Remove only the plain `copilot` shadow shim.
  -h, --help          Show this help.
MSG
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-plugin)
      remove_plugin=false
      shift
      ;;
    --keep-collector)
      stop_collector=false
      shift
      ;;
    --keep-binary)
      remove_binary=false
      shift
      ;;
    --purge)
      purge=true
      shift
      ;;
    --keep-agentops-command)
      shim_args+=(--keep-agentops-command)
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

if [[ "${remove_plugin}" == true ]]; then
  node "${script_dir}/agentops-cli/src/index.js" plugin uninstall || true
fi

if [[ "${stop_collector}" == true ]]; then
  node "${script_dir}/agentops-cli/src/index.js" collector stop --mode auto --json || true
fi

if [[ "${remove_binary}" == true ]]; then
  binary_args=(collector uninstall-binary --json)
  if [[ "${purge}" == true ]]; then
    binary_args+=(--purge)
  fi
  node "${script_dir}/agentops-cli/src/index.js" "${binary_args[@]}" || true
fi

"${script_dir}/scripts/uninstall-copilot-agentops-shim.sh" "${shim_args[@]}"

cat <<'MSG'

AgentOps uninstall finished.
Reinstall later with:
  ./setup-agentops.sh
MSG
