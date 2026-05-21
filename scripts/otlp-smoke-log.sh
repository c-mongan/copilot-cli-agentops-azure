#!/usr/bin/env bash
set -euo pipefail

endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}"
smoke_id="${AGENTOPS_SMOKE_ID:-otlp-log-agentops-$(date +%Y%m%d%H%M%S)}"
payload_file="/tmp/${smoke_id}.otlp-log.json"

SMOKE_ID="$smoke_id" node >"$payload_file" <<'NODE'
const now = BigInt(Date.now()) * 1000000n;
const smokeId = process.env.SMOKE_ID;

const payload = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'github-copilot' } },
          { key: 'service.namespace', value: { stringValue: 'copilot-agentops' } },
          { key: 'agent.runtime', value: { stringValue: 'github-copilot-cli' } },
          { key: 'agentops.profile', value: { stringValue: 'safe-default' } },
          { key: 'agentops.smoke_id', value: { stringValue: smokeId } }
        ]
      },
      scopeLogs: [
        {
          scope: { name: 'agentops.otlp-smoke', version: '0.1.0' },
          logRecords: [
            {
              timeUnixNano: now.toString(),
              severityNumber: 9,
              severityText: 'INFO',
              body: { stringValue: `AgentOps OTLP smoke log ${smokeId}` },
              attributes: [
                { key: 'agentops.smoke_id', value: { stringValue: smokeId } },
                { key: 'gen_ai.operation.name', value: { stringValue: 'smoke_test' } },
                { key: 'content.capture.enabled', value: { boolValue: false } }
              ]
            }
          ]
        }
      ]
    }
  ]
};

process.stdout.write(JSON.stringify(payload));
NODE

curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data-binary "@$payload_file" \
  "${endpoint%/}/v1/logs" >/tmp/${smoke_id}.otlp-response

cat <<MSG
Sent OTLP smoke log.
smokeId=${smoke_id}
endpoint=${endpoint}

Query it with:
az monitor log-analytics query \\
  --workspace 81513958-e9aa-4a35-aeab-953e1d26e797 \\
  --analytics-query "AppTraces | where TimeGenerated > ago(2h) | where Properties has '${smoke_id}' or Message has '${smoke_id}' | take 20"
MSG