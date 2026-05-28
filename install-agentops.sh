#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shadow_copilot=true
install_collector=true
install_plugin=false
collector_force=false
collector_version="${AGENTOPS_OTELCOL_VERSION:-0.151.0}"

usage() {
  cat <<'MSG'
Usage:
  ./install-agentops.sh [options]

Installs AgentOps shims and, by default, the tested local Collector binary.
Docker is not required for the normal path.

Options:
  --no-shadow-copilot      Do not install the plain `copilot` shadow shim.
  --shadow-copilot         Install the plain `copilot` shadow shim. This is the default.
  --no-collector           Skip Collector binary installation.
  --collector-version VER  Collector version to install. Default: 0.151.0.
  --force-collector        Reinstall the Collector binary even if one exists.
  --plugin                 Also install optional Copilot plugin files.
  -h, --help               Show this help.
MSG
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-shadow-copilot|--no-shadow)
      shadow_copilot=false
      shift
      ;;
    --shadow-copilot|--shadow)
      shadow_copilot=true
      shift
      ;;
    --no-collector)
      install_collector=false
      shift
      ;;
    --collector-version)
      collector_version="${2:-}"
      if [[ -z "${collector_version}" ]]; then
        echo "ERROR: --collector-version requires a value." >&2
        exit 2
      fi
      shift 2
      ;;
    --collector-version=*)
      collector_version="${1#*=}"
      shift
      ;;
    --force-collector)
      collector_force=true
      shift
      ;;
    --plugin)
      install_plugin=true
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

if [[ "${install_collector}" == true ]]; then
  collector_args=(collector install-binary --privacy strict --version "${collector_version}")
  if [[ "${collector_force}" == true ]]; then
    collector_args+=(--force)
  fi
  node "${script_dir}/agentops-cli/src/index.js" "${collector_args[@]}"
fi

shim_args=()
if [[ "${shadow_copilot}" == true ]]; then
  shim_args+=(--shadow-copilot)
fi
"${script_dir}/scripts/install-copilot-agentops-shim.sh" "${shim_args[@]}"

if [[ "${install_plugin}" == true ]]; then
  echo
  echo "Installing AgentOps plugin files into COPILOT_HOME. Remove with: agentops plugin uninstall"
  node "${script_dir}/agentops-cli/src/index.js" plugin install
fi

cat <<'MSG'

Next:
  export PATH="$HOME/.local/bin:$PATH"
  agentops configure import-azd
  agentops collector start --mode auto --privacy strict
  copilot -p "Say AGENTOPS_READY in one short sentence."

Remove later with:
  ./uninstall-agentops.sh
MSG
