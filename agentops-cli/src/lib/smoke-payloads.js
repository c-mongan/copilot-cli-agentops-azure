const crypto = require('node:crypto');

const { escapeKqlString, validateKqlDuration } = require('./kql');

function smokeId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-smoke-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function attributionSmokeId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-attribution-smoke-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function liveReplaySmokeId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-live-replay-smoke-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function encodeGrafanaValue(value) {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

function liveReplayGrafanaUrl(id, last = '2h', options = {}) {
  const grafanaBaseUrl = options.grafanaBaseUrl || 'http://localhost:3000';
  return `${grafanaBaseUrl}/d/agentops-live-replay/agentops-live-replay?from=now-${encodeGrafanaValue(validateKqlDuration(last))}&to=now&timezone=browser&refresh=30s&var-conversation=${encodeGrafanaValue(id)}&var-agentops_agent=__all&var-mcp_server=__all&var-tool=__all`;
}

function smokeAzureQuery(id, last = '2h') {
  const lookback = validateKqlDuration(last);
  const escapedId = escapeKqlString(id);
  return `union isfuzzy=true\n(\n  OTelSpans\n  | where TimeGenerated > ago(${lookback})\n  | where tostring(Attributes) has "${escapedId}" or tostring(ResourceAttributes) has "${escapedId}"\n  | extend OperationId=TraceId, Id=SpanId, Success=true, ResultCode="", Properties=Attributes\n  | project TimeGenerated, Name, OperationId, Id, Success, ResultCode, Properties\n),\n(\n  AppDependencies\n  | where TimeGenerated > ago(${lookback})\n  | where Properties has "${escapedId}" or Name has "${escapedId}"\n  | project TimeGenerated, Name, OperationId, Id, Success, ResultCode, Properties\n)\n| order by TimeGenerated desc\n| take 20`;
}

function otlpSmokeTracePayload(id, nowMs = Date.now()) {
  const traceId = crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  const start = BigInt(nowMs) * 1000000n;
  const end = start + 100000000n;
  const attr = (key, stringValue) => ({ key, value: { stringValue } });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr('service.name', 'github-copilot-cli'),
            attr('service.namespace', 'copilot-agentops'),
            attr('agent.framework', 'github-copilot'),
            attr('agent.runtime', 'github-copilot-cli'),
            attr('agentops.profile', 'safe-default'),
            attr('agentops.e2e.id', id),
            attr('agentops.smoke_id', id)
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'agentops.smoke', version: '0.1.0' },
            spans: [
              {
                traceId,
                spanId,
                name: `agentops.smoke.${id}`,
                kind: 1,
                startTimeUnixNano: start.toString(),
                endTimeUnixNano: end.toString(),
                attributes: [
                  attr('agentops.custom_event_id', id),
                  attr('agentops.smoke_id', id),
                  attr('gen_ai.operation.name', 'smoke_test'),
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
}

function otlpAttributionSmokeTracePayload(id, nowMs = Date.now()) {
  const traceId = crypto.randomBytes(16).toString('hex');
  const start = BigInt(nowMs) * 1000000n;
  const attr = (key, stringValue) => ({ key, value: { stringValue } });
  const boolAttr = (key, boolValue) => ({ key, value: { boolValue } });
  const intAttr = (key, intValue) => ({ key, value: { intValue: String(intValue) } });
  const span = (name, offsetMs, durationMs, attributes) => {
    const spanStart = start + BigInt(offsetMs) * 1000000n;
    const spanEnd = spanStart + BigInt(durationMs) * 1000000n;
    return {
      traceId,
      spanId: crypto.randomBytes(8).toString('hex'),
      name,
      kind: 1,
      startTimeUnixNano: spanStart.toString(),
      endTimeUnixNano: spanEnd.toString(),
      attributes: [
        attr('agentops.smoke_id', id),
        attr('agentops.test.kind', 'attribution'),
        attr('gen_ai.conversation.id', id),
        boolAttr('content.capture.enabled', false),
        ...attributes
      ],
      status: { code: 1 }
    };
  };

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr('service.name', 'github-copilot-cli'),
            attr('service.namespace', 'copilot-agentops'),
            attr('agent.framework', 'github-copilot'),
            attr('agent.runtime', 'github-copilot-cli'),
            attr('agentops.profile', 'attribution-smoke'),
            attr('agentops.smoke_id', id)
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'agentops.attribution-smoke', version: '0.1.0' },
            spans: [
              span(`agentops.attribution.${id}.agent`, 0, 100, [
                attr('gen_ai.operation.name', 'invoke_agent'),
                attr('gen_ai.agent.name', 'agentops-kitchen-sink-smoke'),
                attr('agentops.agent.name', 'agentops-kitchen-sink-smoke'),
                attr('agentops.agent.file', 'agentops-kitchen-sink-smoke.agent.md'),
                intAttr('gen_ai.usage.input_tokens', 1200),
                intAttr('gen_ai.usage.output_tokens', 80),
                attr('github.copilot.cost', '0.2')
              ]),
              span(`agentops.attribution.${id}.skill`, 110, 40, [
                attr('gen_ai.operation.name', 'skill.invoke'),
                attr('agentops.skill.name', 'agentops-attribution'),
                attr('agentops.skill.file', 'agentops-attribution/SKILL.md')
              ]),
              span(`agentops.attribution.${id}.mcp`, 160, 60, [
                attr('gen_ai.operation.name', 'execute_tool'),
                attr('gen_ai.tool.name', 'azure-mcp/monitor_query'),
                attr('agentops.mcp.server', 'azure-mcp'),
                attr('agentops.mcp.tool', 'monitor_query')
              ]),
              span(`agentops.attribution.${id}.script`, 230, 30, [
                attr('gen_ai.operation.name', 'hook.execute'),
                attr('agentops.script.name', 'pre-tool-policy'),
                attr('agentops.script.file', 'plugin/scripts/pre-tool-policy.js'),
                attr('agentops.hook.name', 'preToolUse')
              ])
            ]
          }
        ]
      }
    ]
  };
}

function otlpLiveReplaySmokeTracePayload(id, nowMs = Date.now()) {
  const traceId = crypto.randomBytes(16).toString('hex');
  const orchestratorSpanId = crypto.randomBytes(8).toString('hex');
  const delegationSpanId = crypto.randomBytes(8).toString('hex');
  const subagentSpanId = crypto.randomBytes(8).toString('hex');
  const start = BigInt(nowMs) * 1000000n;
  const attr = (key, stringValue) => ({ key, value: { stringValue } });
  const boolAttr = (key, boolValue) => ({ key, value: { boolValue } });
  const intAttr = (key, intValue) => ({ key, value: { intValue: String(intValue) } });
  const span = (spanId, name, offsetMs, durationMs, attributes, parentSpanId = undefined) => {
    const spanStart = start + BigInt(offsetMs) * 1000000n;
    const spanEnd = spanStart + BigInt(durationMs) * 1000000n;
    return {
      traceId,
      spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      name,
      kind: 1,
      startTimeUnixNano: spanStart.toString(),
      endTimeUnixNano: spanEnd.toString(),
      attributes: [
        attr('agentops.smoke_id', id),
        attr('agentops.test.kind', 'live-replay'),
        attr('gen_ai.conversation.id', id),
        boolAttr('content.capture.enabled', false),
        ...attributes
      ],
      status: { code: 1 }
    };
  };

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr('service.name', 'github-copilot-cli'),
            attr('service.namespace', 'copilot-agentops'),
            attr('agent.framework', 'github-copilot'),
            attr('agent.runtime', 'github-copilot-cli'),
            attr('agentops.profile', 'live-replay-smoke'),
            attr('agentops.smoke_id', id)
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'agentops.live-replay-smoke', version: '0.1.0' },
            spans: [
              span(orchestratorSpanId, `agentops.live_replay.${id}.orchestrator`, 0, 380, [
                attr('gen_ai.operation.name', 'invoke_agent'),
                attr('gen_ai.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.agent.file', 'agentops-orchestrator.agent.md'),
                intAttr('gen_ai.usage.input_tokens', 900),
                intAttr('gen_ai.usage.output_tokens', 120),
                attr('github.copilot.cost', '0.12')
              ]),
              span(delegationSpanId, `agentops.live_replay.${id}.delegation.started`, 70, 40, [
                attr('gen_ai.operation.name', 'agent.delegation.started'),
                attr('agentops.event.name', 'agent.delegation.started'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.workflow.name', 'live-replay-e2e'),
                attr('agentops.step.name', 'delegate-investigation')
              ], orchestratorSpanId),
              span(subagentSpanId, `agentops.live_replay.${id}.subagent`, 120, 180, [
                attr('gen_ai.operation.name', 'invoke_agent'),
                attr('gen_ai.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.workflow.name', 'live-replay-e2e'),
                intAttr('gen_ai.usage.input_tokens', 400),
                intAttr('gen_ai.usage.output_tokens', 60),
                attr('github.copilot.cost', '0.08')
              ], delegationSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.skill`, 160, 35, [
                attr('gen_ai.operation.name', 'skill.invoke'),
                attr('agentops.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.skill.name', 'agentops-live-triage'),
                attr('agentops.skill.file', 'agentops-live-triage/SKILL.md')
              ], subagentSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.mcp`, 210, 70, [
                attr('gen_ai.operation.name', 'execute_tool'),
                attr('agentops.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('gen_ai.tool.name', 'azure-mcp/monitor_query'),
                attr('agentops.mcp.server', 'azure-mcp'),
                attr('agentops.mcp.tool', 'monitor_query')
              ], subagentSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.script`, 300, 30, [
                attr('gen_ai.operation.name', 'hook.execute'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.script.name', 'pre-tool-policy'),
                attr('agentops.script.file', 'plugin/scripts/pre-tool-policy.js'),
                attr('agentops.hook.name', 'preToolUse')
              ], orchestratorSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.delegation.completed`, 340, 30, [
                attr('gen_ai.operation.name', 'agent.delegation.completed'),
                attr('agentops.event.name', 'agent.delegation.completed'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.workflow.name', 'live-replay-e2e'),
                attr('agentops.outcome', 'completed')
              ], delegationSpanId)
            ]
          }
        ]
      }
    ]
  };
}

module.exports = {
  attributionSmokeId,
  liveReplayGrafanaUrl,
  liveReplaySmokeId,
  otlpAttributionSmokeTracePayload,
  otlpLiveReplaySmokeTracePayload,
  otlpSmokeTracePayload,
  smokeAzureQuery,
  smokeId
};
