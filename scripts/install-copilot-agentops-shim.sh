#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cli_entry="${repo_root}/agentops-cli/src/index.js"
if [[ ! -f "${cli_entry}" ]]; then
  cli_entry="${repo_root}/src/index.js"
fi
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
chmod +x "${cli_entry}" "${repo_root}/scripts/copilot-agentops" "${repo_root}/scripts/agentops-codex" "${repo_root}/scripts/collector-azuremonitor-up.sh" "${repo_root}/copilot/copilot-observe"
ln -sf "${cli_entry}" "${install_dir}/agentops"
ln -sf "${repo_root}/scripts/copilot-agentops" "${install_dir}/copilot-agentops"
ln -sf "${repo_root}/scripts/agentops-codex" "${install_dir}/agentops-codex"

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

  shadow_cmd="${install_dir}/copilot"
  shadow_backup="${install_dir}/copilot.agentops-original"
  shadow_marker="# AgentOps managed shadow shim"
  if [[ -e "${shadow_cmd}" || -L "${shadow_cmd}" ]]; then
    if ! grep -Fq "${shadow_marker}" "${shadow_cmd}" 2>/dev/null; then
      if [[ -e "${shadow_backup}" || -L "${shadow_backup}" ]]; then
        echo "ERROR: refusing to overwrite ${shadow_cmd} because the AgentOps backup already exists at ${shadow_backup}." >&2
        exit 2
      fi
      mv "${shadow_cmd}" "${shadow_backup}"
    fi
  fi

  cat >"${shadow_cmd}" <<SH
#!/usr/bin/env bash
${shadow_marker}
export COPILOT_CLI_BIN="${real_copilot}"
exec "${repo_root}/scripts/copilot-agentops" "\$@"
SH
  chmod +x "${shadow_cmd}"
fi

cat <<MSG
Installed:
  ${install_dir}/agentops
  ${install_dir}/copilot-agentops
  ${install_dir}/agentops-codex
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
  agentops install --shadow-copilot
MSG
fi

cat <<MSG

Make sure your shell can see ${install_dir}. For zsh, add this if needed:
  export PATH="${install_dir}:\$PATH"

Plugin files are optional and reversible. To install them explicitly:
  agentops plugin install

Remove plugin files later with:
  agentops plugin uninstall
MSG
