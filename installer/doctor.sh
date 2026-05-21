#!/usr/bin/env bash
set -euo pipefail

node agentops-cli/src/index.js doctor --local-only
