#!/usr/bin/env bash

agentops_require_azure_subscription() {
  local approved_csv="${AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS:-}"
  local expected="${AGENTOPS_AZURE_SUBSCRIPTION_ID:-}"
  local active=""
  local expected_normalized=""
  local active_normalized=""
  local approved_normalized=""
  local approved_match="false"
  local approved=""

  if [[ -z "${expected}" ]]; then
    echo "ERROR: set AGENTOPS_AZURE_SUBSCRIPTION_ID before any Azure write or privileged lookup." >&2
    return 2
  fi

  if [[ -z "${approved_csv}" ]]; then
    echo "ERROR: set AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS before any Azure write or privileged lookup." >&2
    return 2
  fi

  if ! active="$(az account show --query id -o tsv 2>/dev/null)" || [[ -z "${active}" ]]; then
    echo "ERROR: could not verify the active Azure subscription. Run az login, then retry." >&2
    return 2
  fi

  expected_normalized="$(printf '%s' "${expected}" | tr '[:upper:]' '[:lower:]')"
  active_normalized="$(printf '%s' "${active}" | tr '[:upper:]' '[:lower:]')"
  approved_normalized="$(printf '%s' "${approved_csv}" | tr '[:upper:]' '[:lower:]' | tr ',' ' ')"
  for approved in ${approved_normalized}; do
    if [[ "${expected_normalized}" == "${approved}" ]]; then
      approved_match="true"
      break
    fi
  done
  if [[ "${approved_match}" != "true" ]]; then
    echo "ERROR: Azure subscription guard refused this operation." >&2
    echo "Configured subscription ${expected} is not in AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS." >&2
    return 2
  fi
  if [[ "${active_normalized}" != "${expected_normalized}" ]]; then
    echo "ERROR: Azure subscription guard refused this operation." >&2
    echo "Expected: ${expected}" >&2
    echo "Active:   ${active}" >&2
    echo "Switch explicitly with: az account set --subscription ${expected}" >&2
    return 2
  fi

  printf 'Azure subscription guard: verified %s\n' "${active}" >&2
}
