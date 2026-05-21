#!/usr/bin/env bash
set -euo pipefail

compose_file="${1:-collector/docker-compose.yaml}"

docker compose -f "$compose_file" up
