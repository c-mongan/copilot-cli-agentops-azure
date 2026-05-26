#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
install_dir="${AGENTOPS_BIN_DIR:-${HOME}/.local/bin}"
mode="command"

usage() {
  cat <<'MSG'
Usage:
  ./scripts/install-copilot-agentops-shim.sh [--shadow-copilot]

Installs agentops and copilot-agentops into ~/.local/bin.

Options:
  --shadow-copilot  Also install ~/.local/bin/copilot so plain `copilot` starts
                    the Azure Monitor collector and then calls the real Copilot CLI.
MSG
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --shadow-copilot)
      mode="shadow"
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

mkdir -p "${install_dir}"
chmod +x "${repo_root}/agentops-cli/src/index.js" "${repo_root}/scripts/copilot-agentops" "${repo_root}/scripts/collector-azuremonitor-up.sh" "${repo_root}/copilot/copilot-observe"
ln -sf "${repo_root}/agentops-cli/src/index.js" "${install_dir}/agentops"
ln -sf "${repo_root}/scripts/copilot-agentops" "${install_dir}/copilot-agentops"

if command -v node >/dev/null 2>&1; then
  node "${repo_root}/agentops-cli/src/index.js" plugin install
else
  echo "WARNING: node was not found, so AgentOps Copilot plugin files were not installed." >&2
  echo "Install Node.js, then run: node ${repo_root}/agentops-cli/src/index.js plugin install" >&2
fi

if [[ "${mode}" == "shadow" ]]; then
  real_copilot="$(PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vx "${install_dir}" | paste -sd ':' -)" command -v copilot || true)"

  if [[ -z "${real_copilot}" ]]; then
    echo "ERROR: could not find the real copilot CLI outside ${install_dir}." >&2
    exit 127
  fi

  if [[ "${real_copilot}" == "${repo_root}/scripts/copilot-agentops" || "${real_copilot}" == "${install_dir}/copilot" ]]; then
    echo "ERROR: resolved copilot path points back to AgentOps; refusing to create a recursive shim." >&2
    exit 2
  fi

  cat >"${install_dir}/copilot" <<SH
#!/usr/bin/env bash
export COPILOT_CLI_BIN="${real_copilot}"
exec "${repo_root}/scripts/copilot-agentops" "\$@"
SH
  chmod +x "${install_dir}/copilot"
fi

cat <<MSG
Installed:
  ${install_dir}/agentops
  ${install_dir}/copilot-agentops
MSG

if [[ "${mode}" == "shadow" ]]; then
  cat <<MSG
  ${install_dir}/copilot

Plain \`copilot\` will be observed when ${install_dir} appears before the real Copilot CLI on PATH.
MSG
else
  cat <<MSG

Run observed Copilot sessions with:
  copilot-agentops

To make plain \`copilot\` observed too, rerun:
  ./scripts/install-copilot-agentops-shim.sh --shadow-copilot
MSG
fi

cat <<MSG

Make sure your shell can see ${install_dir}. For zsh, add this if needed:
  export PATH="${install_dir}:\$PATH"
MSG
