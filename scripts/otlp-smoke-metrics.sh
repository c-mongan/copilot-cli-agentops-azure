#!/usr/bin/env bash
set -euo pipefail

endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}"
smoke_id="${AGENTOPS_SMOKE_ID:-otlp-metric-agentops-$(date +%Y%m%d%H%M%S)}"
payload_file="/tmp/${smoke_id}.otlp-metric.json"

SMOKE_ID="$smoke_id" node >"$payload_file" <<'NODE'
const now = BigInt(Date.now()) * 1000000n;
const start = now - 100000000n;
const smokeId = process.env.SMOKE_ID;

const payload = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'github-copilot' } },
          { key: 'service.namespace', value: { stringValue: 'copilot-agentops' } },
          { key: 'agent.runtime', value: { stringValue: 'github-copilot-cli' } },
          { key: 'agentops.profile', value: { stringValue: 'safe-default' } },
          { key: 'agentops.e2e.id', value: { stringValue: smokeId } }
        ]
      },
      scopeMetrics: [
        {
          scope: { name: 'agentops.otlp-smoke', version: '0.1.0' },
          metrics: [
            {
              name: 'agentops.native.smoke',
              description: 'Metadata-only AgentOps native OTLP smoke metric',
              unit: '1',
              sum: {
                dataPoints: [
                  {
                    attributes: [
                      { key: 'agentops.custom_event_id', value: { stringValue: smokeId } },
                      { key: 'gen_ai.operation.name', value: { stringValue: 'smoke_test' } },
                      { key: 'content.capture.enabled', value: { boolValue: false } }
                    ],
                    startTimeUnixNano: start.toString(),
                    timeUnixNano: now.toString(),
                    asDouble: 1
                  }
                ],
                aggregationTemporality: 2,
                isMonotonic: true
              }
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
  "${endpoint%/}/v1/metrics" >/tmp/${smoke_id}.otlp-response

cat <<MSG
Sent OTLP smoke metric.
smokeId=${smoke_id}
endpoint=${endpoint}
temporality=DELTA
value=1

Query the Azure Monitor Workspace PromQL surface for the accepted metadata row with:
AGENTOPS_SMOKE_ID="${smoke_id}" ./scripts/azure-native-metric-query.sh
MSG
