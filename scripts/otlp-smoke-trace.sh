#!/usr/bin/env bash
set -euo pipefail

endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}"
smoke_id="${AGENTOPS_SMOKE_ID:-otlp-agentops-$(date +%Y%m%d%H%M%S)}"
payload_file="/tmp/${smoke_id}.otlp-trace.json"

SMOKE_ID="$smoke_id" node >"$payload_file" <<'NODE'
const crypto = require('node:crypto');

function hex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

const now = BigInt(Date.now()) * 1000000n;
const end = now + 100000000n;
const smokeId = process.env.SMOKE_ID;

const payload = {
  resourceSpans: [
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
      scopeSpans: [
        {
          scope: { name: 'agentops.otlp-smoke', version: '0.1.0' },
          spans: [
            {
              traceId: hex(16),
              spanId: hex(8),
              name: 'agentops.otlp_smoke',
              kind: 1,
              startTimeUnixNano: now.toString(),
              endTimeUnixNano: end.toString(),
              attributes: [
                { key: 'agentops.smoke_id', value: { stringValue: smokeId } },
                { key: 'gen_ai.operation.name', value: { stringValue: 'smoke_test' } },
                { key: 'content.capture.enabled', value: { boolValue: false } }
              ],
              status: { code: 1 }
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
  "${endpoint%/}/v1/traces" >/tmp/${smoke_id}.otlp-response

cat <<MSG
Sent OTLP smoke trace.
smokeId=${smoke_id}
endpoint=${endpoint}

Query it with:
az monitor log-analytics query \\
  --workspace "\${AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID}" \\
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where Properties has '${smoke_id}' or Name has '${smoke_id}' | project TimeGenerated, Name, Properties | order by TimeGenerated desc | take 20"
MSG
