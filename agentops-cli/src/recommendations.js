function createRecommendations({ buildLink, mainGrafanaDashboardUrl, latestSessionAzureQuery }) {
  function recommendationForExplanation(explanation, options = {}) {
    const session = explanation.session;
    const sessionId = session?.id || 'unknown-session';
    const last = options.last || '24h';
    const link = session && session.id !== 'unknown-session' ? buildLink('session', session.id, { last }) : null;
    const base = {
      session: sessionId,
      classification: explanation.classification,
      evidence: {
        dashboard: link?.grafana_url || mainGrafanaDashboardUrl,
        query: link?.query || latestSessionAzureQuery(last)
      },
      observed_pattern: explanation.detail,
      proposed_files: [],
      expected_metric_movement: [],
      validation: [
        'Run `node agentops-cli/src/index.js replay latest --last 24h` after the next comparable session.',
        'Run `node agentops-cli/src/index.js benchmark run starter --variant candidate --repeat 1 --hypothesis <id>` before keeping agent, skill, hook, or MCP changes.'
      ],
      rollback_condition: 'Rollback if pass rate drops, safety violations appear, tool failures increase, or token/cost growth exceeds the accepted budget.'
    };

    if (explanation.classification === 'failed_tool') {
      return {
        ...base,
        action: 'investigate',
        observed_pattern: `${session.failed_tools} failed tool call(s) in ${session.tool_calls} tool call(s).`,
        proposed_files: [
          'plugin/scripts/post-tool-failure-hints.js',
          'plugin/agents/telemetry-investigator.agent.md',
          'plugin/skills/kql-copilot-telemetry/SKILL.md'
        ],
        expected_metric_movement: [
          'Lower repeated tool failure count for the same tool.',
          'Higher benchmark pass rate for tasks that exercise that tool.',
          'Lower retry-hint frequency in permission-friction telemetry.'
        ]
      };
    }

    if (explanation.classification === 'policy_blocked') {
      return {
        ...base,
        action: 'review_policy',
        observed_pattern: `${session.policy_blocks} policy signal(s) appeared in the session.`,
        proposed_files: [
          'plugin/scripts/pre-tool-policy.js',
          'plugin/agents/hook-policy-reviewer.agent.md',
          'kql/17-permission-friction.kql'
        ],
        expected_metric_movement: [
          'Preserve risky-command blocks while reducing false-positive policy blocks.',
          'Reduce permission friction score for comparable sessions.',
          'Keep content-capture signals at zero.'
        ]
      };
    }

    if (explanation.classification === 'too_much_context') {
      return {
        ...base,
        action: 'reduce_context',
        observed_pattern: `High context or compaction signal: ${session.input_tokens} input tokens, ${session.tokens_removed} removed-token signals.`,
        proposed_files: [
          'plugin/agents/agent-optimizer.agent.md',
          'plugin/skills/agent-profile-tuning/SKILL.md',
          'kql/12-context-pressure-token-efficiency.kql'
        ],
        expected_metric_movement: [
          'Lower input tokens for comparable sessions.',
          'Higher output-yield percentage.',
          'Fewer context truncation or compaction events.'
        ]
      };
    }

    if (explanation.classification === 'high_cost') {
      return {
        ...base,
        action: 'reduce_cost',
        observed_pattern: `Estimated session cost was $${session.est_usd.toFixed(2)}.`,
        proposed_files: [
          'plugin/agents/agent-optimizer.agent.md',
          'plugin/skills/agentops-retrospective/SKILL.md',
          'kql/12-context-pressure-token-efficiency.kql'
        ],
        expected_metric_movement: [
          'Lower estimated cost and AI credits for comparable sessions.',
          'Stable or improved benchmark pass rate.',
          'No increase in safety or policy friction signals.'
        ]
      };
    }

    if (explanation.classification === 'content_capture_warning') {
      return {
        ...base,
        action: 'stop_and_sanitize',
        observed_pattern: 'Prompt, completion, tool argument, or content-capture fields may be present.',
        proposed_files: [
          'collector/otelcol.azuremonitor.yaml',
          'collector/otelcol.local.yaml',
          'copilot/copilot-observe'
        ],
        expected_metric_movement: [
          'Content-capture signals return to zero.',
          'Telemetry remains useful through metadata-only fields.'
        ],
        rollback_condition: 'Do not share or export affected telemetry until reviewed.'
      };
    }

    return {
      ...base,
      action: explanation.classification === 'success' ? 'keep' : 'investigate',
      proposed_files: [
        'plugin/agents/telemetry-investigator.agent.md',
        'docs/copilot-mcp-agentops-prompts.md'
      ],
      expected_metric_movement: explanation.classification === 'success'
        ? ['Maintain zero failures, zero policy blocks, and acceptable token/cost levels.']
        : ['Collect one more comparable session or benchmark before changing files.']
    };
  }

  function renderRecommendation(recommendation) {
    const lines = [
      'AgentOps recommendation',
      '',
      `Action: ${recommendation.action}`,
      `Session: ${recommendation.session}`,
      `Observed pattern: ${recommendation.observed_pattern}`,
      '',
      `Evidence dashboard: ${recommendation.evidence.dashboard}`,
      'Evidence query:',
      recommendation.evidence.query,
      '',
      `Proposed files: ${recommendation.proposed_files.length ? recommendation.proposed_files.join(', ') : 'none yet'}.`,
      'Expected metric movement:',
      ...recommendation.expected_metric_movement.map(item => `- ${item}`),
      'Validation:',
      ...recommendation.validation.map(item => `- ${item}`),
      `Rollback condition: ${recommendation.rollback_condition}`
    ];

    return `${lines.join('\n')}\n`;
  }

  return {
    recommendationForExplanation,
    renderRecommendation
  };
}

module.exports = {
  createRecommendations
};
