const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { checkAzureSubscription } = require('./azure/subscription-guard');

const { createAlertActionGroupActions } = require('./alert-action-group-actions');

function createAlertActions(config = {}) {
  const {
    alertActionPlan,
    alertArtifact,
    alertDetail,
    alertHandoff,
    alertHistoryQuery,
    alertRecommendationQuery,
    alertRoutePlan,
    alertTunePlan,
    baseFilter,
    grafanaUrlWithVars,
    root,
    sessionKey,
    validateKqlDuration,
    v2ReplayGrafanaDashboardUrl,
    v2RunsGrafanaDashboardUrl
  } = config;
  const { alertActionGroupPlan, alertActionGroupRoute } = createAlertActionGroupActions({
    alertHandoff
  });

  function alertGithubIssueRoute({ rule, session, last = '24h', owners = [], service = 'agentops', timezone = 'UTC', repo, yes = false, resourceGroup = null, spawnSync = childProcess.spawnSync } = {}) {
    const normalizedRepo = String(repo || '').trim();
    if (!normalizedRepo || !/^[^/\s]+\/[^/\s]+$/.test(normalizedRepo)) {
      throw new Error('alert route-github requires --repo <owner/repo>');
    }

    const normalizedOwners = owners.map(owner => String(owner || '').trim()).filter(Boolean);
    if (normalizedOwners.length === 0) throw new Error('alert route-github requires at least one --owner <github-login>');

    const plan = alertRoutePlan({
      rule,
      session,
      last,
      owners: normalizedOwners,
      service,
      timezone,
      targets: ['github-issue'],
      resourceGroup
    });
    const destination = plan.destinations.find(item => item.target === 'github-issue');
    const payload = destination.payload;
    const args = [
      'issue',
      'create',
      '--repo',
      normalizedRepo,
      '--title',
      payload.title,
      '--body',
      payload.body
    ];

    for (const label of payload.labels) args.push('--label', label);
    for (const owner of payload.assignees) args.push('--assignee', owner);

    const route = {
      schema_version: 'agentops.alert-github-route.v1',
      mode: yes ? 'posted-github-issue' : 'dry-run-github-issue-route',
      alert: plan.alert,
      repo: normalizedRepo,
      owner: normalizedOwners[0],
      command: {
        executable: 'gh',
        args
      },
      payload,
      guardrails: [
        'Review the route-plan and handoff evidence before posting.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of GitHub issues.',
        'This command only creates a GitHub issue; it does not page, edit Azure resources, or enable alert rules.'
      ]
    };

    if (!yes) return route;

    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      env: process.env
    });
    if (result.status !== 0) {
      return {
        ...route,
        mode: 'failed-github-issue-route',
        status: result.status,
        error: String(result.stderr || result.stdout || 'gh issue create failed').trim()
      };
    }

    return {
      ...route,
      status: result.status,
      issue_url: String(result.stdout || '').trim()
    };
  }

  function fieldValue(patch, fieldPath) {
    const field = patch.find(item => item.path === fieldPath);
    return field ? field.value : null;
  }

  function alertOpenRun({ rule, session, last = '24h' } = {}) {
    const detail = alertDetail({ rule, session, last });
    const sessionId = detail.session;
    const runVars = {
      'var-run_id': '__all',
      'var-session_id': sessionId,
      'var-trace_id': '__all'
    };

    return {
      schema_version: 'agentops.alert-open-run.v1',
      mode: 'metadata-only-alert-run-links',
      alert: {
        rule: detail.rule,
        session: sessionId,
        last: detail.last
      },
      links: {
        session_detail: detail.session_link.grafana_url,
        run_replay: grafanaUrlWithVars(v2ReplayGrafanaDashboardUrl, runVars),
        runs_explorer: grafanaUrlWithVars(v2RunsGrafanaDashboardUrl, { 'var-session_id': sessionId }),
        content_viewer: grafanaUrlWithVars(`${v2ReplayGrafanaDashboardUrl}?viewPanel=26`, runVars),
        azure_portal_logs: detail.session_link.azure_portal_url
      },
      queries: {
        alert_history: detail.history_query,
        session: detail.session_link.query
      },
      commands: {
        replay: `agentops replay ${sessionId} --last ${detail.last}`,
        action_plan: detail.action_plan_command,
        handoff: `agentops alert handoff --rule ${detail.rule} --session ${sessionId} --last ${detail.last}`
      },
      guardrails: [
        'Open links only after reviewing metadata-only alert context.',
        'The content viewer link is explicit opt-in and does not grant permission to collect prompt or response content.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of follow-up tickets.'
      ]
    };
  }

  function alertReview({ rule, session, last = '24h', owners = [] } = {}) {
    const open = alertOpenRun({ rule, session, last });
    const detail = alertDetail({ rule, session, last });
    const actionPlan = alertActionPlan({ rule, session, last });
    const artifact = alertArtifact({ rule, session, last });
    const normalizedOwners = owners.map(owner => String(owner || '').trim()).filter(Boolean);

    return {
      schema_version: 'agentops.alert-review.v1',
      mode: 'metadata-only-alert-review',
      alert: open.alert,
      owner: normalizedOwners[0] || null,
      evidence: {
        detail,
        open,
        action_plan: actionPlan,
        artifact
      },
      commands: {
        open: `agentops alert open --rule ${open.alert.rule} --session ${open.alert.session} --last ${open.alert.last}`,
        action_plan: actionPlan.next_command || detail.action_plan_command,
        export: `agentops alert export --rule ${open.alert.rule} --session ${open.alert.session} --output .agentops/alerts/${open.alert.rule}.json --last ${open.alert.last}`,
        handoff: `agentops alert handoff --rule ${open.alert.rule} --session ${open.alert.session}${normalizedOwners[0] ? ` --owner ${normalizedOwners[0]}` : ''} --last ${open.alert.last}`
      },
      guardrails: [
        'Metadata-only: this command does not page, post tickets, edit repositories, or mutate Azure resources.',
        'Review session links, alert history, and action-plan payloads before routing notifications.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of follow-up tickets.'
      ],
      next: [
        'Open the session detail or run replay link.',
        'Review the action-plan payload and threshold evidence.',
        'Export or hand off the review packet only after assigning an owner.'
      ]
    };
  }

  const alertThresholdPatchResources = {
    'high-aiu': {
      bicep_resource: 'highAiuAlert',
      current_threshold: 50000000000
    },
    'failed-spans': {
      bicep_resource: 'failureAlert',
      current_threshold: 0
    },
    'content-capture': {
      bicep_resource: 'contentCaptureAlert',
      current_threshold: 0,
      fixed_threshold: 0
    }
  };

  function normalizeThresholdValue(value) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error('alert threshold-patch requires --threshold <number>');
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0) throw new Error('alert threshold-patch --threshold must be a non-negative number');
    return Number.isInteger(number) ? String(number) : String(number);
  }

  function unifiedThresholdDiff({ lines, lineIndex, before, after, filePath }) {
    const contextBefore = Math.max(0, lineIndex - 3);
    const contextAfter = Math.min(lines.length, lineIndex + 4);
    const hunkLines = [];
    for (let index = contextBefore; index < contextAfter; index += 1) {
      if (index === lineIndex) {
        hunkLines.push(`-${lines[index]}`);
        hunkLines.push(`+${lines[index].replace(before, after)}`);
      } else {
        hunkLines.push(` ${lines[index]}`);
      }
    }

    return [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ -${contextBefore + 1},${contextAfter - contextBefore} +${contextBefore + 1},${contextAfter - contextBefore} @@`,
      ...hunkLines
    ].join('\n');
  }

  function alertThresholdSimulationQuery({ rule, currentThreshold, proposedThreshold, last }) {
    const selectedRule = JSON.stringify(rule);
    if (rule === 'content-capture') {
      return `let lookback = ${last};
  let selected_rule = ${selectedRule};
  let current_threshold = ${currentThreshold};
  let proposed_threshold = ${proposedThreshold};
  let windows =
  union isfuzzy=true AppDependencies, AppTraces
  | where TimeGenerated > ago(lookback)
  | where tostring(Properties) has_any ("gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.prompt", "gen_ai.completion", "github.copilot.message")
  | summarize TriggerValue=count() by TimeGenerated=bin(TimeGenerated, 1h)
  | extend Conversation="content-capture-window";
  windows
  | summarize
      observed_windows=count(),
      current_alert_windows=countif(TriggerValue > current_threshold),
      proposed_alert_windows=countif(TriggerValue > proposed_threshold),
      max_trigger=max(TriggerValue),
      affected_sessions=dcount(Conversation)
  | extend Rule=selected_rule, CurrentThreshold=current_threshold, ProposedThreshold=proposed_threshold`;
    }

    const triggerExpression = rule === 'high-aiu'
      ? 'AIU'
      : 'todouble(Failures + ToolFailures)';
    return `let lookback = ${last};
  let selected_rule = ${selectedRule};
  let current_threshold = ${currentThreshold};
  let proposed_threshold = ${proposedThreshold};
  let hourly =
  AppDependencies
  | where TimeGenerated > ago(lookback)
  | where ${baseFilter}
  | extend conversation=${sessionKey},
      operation=tostring(Properties["gen_ai.operation.name"]),
      tool=tostring(Properties["gen_ai.tool.name"]),
      error=tostring(Properties["error.type"]),
      AIU=todouble(Properties["github.copilot.aiu"])
  | summarize
      Failures=countif(Success == false or tostring(Success) =~ "false" or isnotempty(error)),
      ToolFailures=countif((operation == "execute_tool" or isnotempty(tool)) and (Success == false or tostring(Success) =~ "false" or isnotempty(error))),
      AIU=sum(AIU)
    by Conversation=conversation, TimeGenerated=bin(TimeGenerated, 1h)
  | extend TriggerValue=${triggerExpression};
  hourly
  | summarize
      observed_windows=count(),
      current_alert_windows=countif(TriggerValue > current_threshold),
      proposed_alert_windows=countif(TriggerValue > proposed_threshold),
      max_trigger=max(TriggerValue),
      p95_trigger=percentile(TriggerValue, 95),
      affected_sessions=dcount(Conversation)
  | extend Rule=selected_rule, CurrentThreshold=current_threshold, ProposedThreshold=proposed_threshold`;
  }

  function alertThresholdSimulation({ rule, threshold, owner, last = '14d' } = {}) {
    const normalizedRule = String(rule || '').trim();
    const target = alertThresholdPatchResources[normalizedRule];
    if (!target) {
      throw new Error(`alert threshold-simulate requires --rule ${Object.keys(alertThresholdPatchResources).join('|')}`);
    }

    const normalizedOwner = String(owner || '').trim();
    if (!normalizedOwner) throw new Error('alert threshold-simulate requires --owner <name>');

    const proposedThreshold = normalizeThresholdValue(threshold);
    if (target.fixed_threshold !== undefined && proposedThreshold !== String(target.fixed_threshold)) {
      throw new Error(`alert threshold-simulate keeps ${normalizedRule} threshold at ${target.fixed_threshold}`);
    }

    const lookback = validateKqlDuration(last);
    const current = target.current_threshold;
    const proposed = Number(proposedThreshold);

    return {
      schema_version: 'agentops.alert-threshold-simulation.v1',
      mode: 'preview-only-threshold-simulation',
      rule: normalizedRule,
      owner: normalizedOwner,
      last: lookback,
      bicep_resource: target.bicep_resource,
      current_threshold: current,
      proposed_threshold: proposed,
      expected_effect: proposed > current
        ? 'fewer-or-equal-alert-windows'
        : proposed < current
          ? 'more-or-equal-alert-windows'
          : 'same-threshold',
      evidence: {
        simulation_query: alertThresholdSimulationQuery({
          rule: normalizedRule,
          currentThreshold: current,
          proposedThreshold: proposed,
          last: lookback
        }),
        threshold_recommendation_query: alertRecommendationQuery(lookback),
        fired_alert_history: alertHistoryQuery(normalizedRule, lookback)
      },
      guardrails: [
        'Preview-only: this command does not edit files, Azure resources, alert rules, or action groups.',
        'Run the simulation query and review current_alert_windows versus proposed_alert_windows before applying a threshold patch.',
        'Keep content-capture threshold at 0; investigate any content-like telemetry before routing alerts.'
      ],
      next: [
        'Run the simulation query in Azure Logs.',
        'If proposed_alert_windows is acceptable, run alert threshold-patch to generate the Bicep diff.',
        'Apply threshold changes only in a reviewed PR, then run validate-azure before enabling alerts.'
      ]
    };
  }

  function alertThresholdPatch({ rule, threshold, owner, last = '14d', bicepPath = path.join(root, 'infra/bicep/alerts.bicep') } = {}) {
    const normalizedRule = String(rule || '').trim();
    const target = alertThresholdPatchResources[normalizedRule];
    if (!target) {
      throw new Error(`alert threshold-patch requires --rule ${Object.keys(alertThresholdPatchResources).join('|')}`);
    }

    const normalizedOwner = String(owner || '').trim();
    if (!normalizedOwner) throw new Error('alert threshold-patch requires --owner <name>');

    const nextThreshold = normalizeThresholdValue(threshold);
    if (target.fixed_threshold !== undefined && nextThreshold !== String(target.fixed_threshold)) {
      throw new Error(`alert threshold-patch keeps ${normalizedRule} threshold at ${target.fixed_threshold}`);
    }

    const lookback = validateKqlDuration(last);
    const relativePath = path.relative(root, bicepPath).replace(/\\/g, '/');
    const source = fs.readFileSync(bicepPath, 'utf8');
    const lines = source.split(/\r?\n/);
    const resourceStart = lines.findIndex(line => line.includes(`resource ${target.bicep_resource} `));
    if (resourceStart === -1) throw new Error(`alert threshold-patch could not find ${target.bicep_resource} in ${relativePath}`);
    let resourceEnd = lines.findIndex((line, index) => index > resourceStart && /^resource |^output /.test(line));
    if (resourceEnd === -1) resourceEnd = lines.length;

    const currentLine = `threshold: ${target.current_threshold}`;
    const thresholdIndex = lines.findIndex((line, index) => index > resourceStart && index < resourceEnd && line.trim() === currentLine);
    if (thresholdIndex === -1) throw new Error(`alert threshold-patch could not find ${currentLine} in ${target.bicep_resource}`);

    const replacementLine = `threshold: ${nextThreshold}`;
    const diff = unifiedThresholdDiff({
      lines,
      lineIndex: thresholdIndex,
      before: currentLine,
      after: replacementLine,
      filePath: relativePath
    });
    const tunePlan = alertTunePlan({ rule: normalizedRule, last: lookback, owner: normalizedOwner });

    return {
      schema_version: 'agentops.alert-threshold-patch.v1',
      mode: 'preview-only-bicep-threshold-patch',
      rule: normalizedRule,
      owner: normalizedOwner,
      last: lookback,
      patch_target: relativePath,
      bicep_resource: target.bicep_resource,
      current_threshold: target.current_threshold,
      proposed_threshold: Number(nextThreshold),
      diff,
      evidence: {
        tune_plan_schema: tunePlan.schema_version,
        threshold_recommendation_query: tunePlan.evidence.threshold_recommendation_query,
        fired_alert_history: tunePlan.evidence.fired_alert_history[0].query
      },
      guardrails: [
        'Preview-only: this command does not edit infra/bicep/alerts.bicep.',
        'Review threshold recommendation evidence and fired-alert history before applying this diff.',
        'Run validate-azure before enabling alerts or routing action groups after any threshold change.'
      ],
      next: [
        'Apply this diff in a reviewed PR only after owner approval.',
        'Keep enableAlerts=false until the patched rule has been validated against real traffic.',
        'Regenerate alert resources and run validate-azure before production routing.'
      ]
    };
  }

  function alertAzureDevOpsWorkItemRoute({ rule, session, last = '24h', owners = [], service = 'agentops', timezone = 'UTC', org, project, workItemType = 'Issue', yes = false, resourceGroup = null, spawnSync = childProcess.spawnSync, env = process.env, expectedSubscriptionId, approvedSubscriptionIds } = {}) {
    const normalizedOrg = String(org || '').trim();
    if (!normalizedOrg) throw new Error('alert route-azure-devops requires --org <url>');

    const normalizedProject = String(project || '').trim();
    if (!normalizedProject) throw new Error('alert route-azure-devops requires --project <name>');

    const normalizedOwners = owners.map(owner => String(owner || '').trim()).filter(Boolean);
    if (normalizedOwners.length === 0) throw new Error('alert route-azure-devops requires at least one --owner <user>');

    const normalizedType = String(workItemType || '').trim() || 'Issue';
    const plan = alertRoutePlan({
      rule,
      session,
      last,
      owners: normalizedOwners,
      service,
      timezone,
      targets: ['azure-devops-work-item'],
      resourceGroup
    });
    const destination = plan.destinations.find(item => item.target === 'azure-devops-work-item');
    const payload = destination.payload;
    const title = fieldValue(payload, '/fields/System.Title');
    const description = fieldValue(payload, '/fields/System.Description');
    const tags = fieldValue(payload, '/fields/System.Tags');
    const fields = [
      `System.AssignedTo=${normalizedOwners[0]}`
    ];
    if (tags) fields.push(`System.Tags=${tags}`);

    const args = [
      'boards',
      'work-item',
      'create',
      '--org',
      normalizedOrg,
      '--project',
      normalizedProject,
      '--type',
      normalizedType,
      '--title',
      title,
      '--description',
      description,
      '--fields',
      ...fields
    ];

    const route = {
      schema_version: 'agentops.alert-azure-devops-route.v1',
      mode: yes ? 'posted-azure-devops-work-item' : 'dry-run-azure-devops-work-item-route',
      alert: plan.alert,
      org: normalizedOrg,
      project: normalizedProject,
      owner: normalizedOwners[0],
      work_item_type: normalizedType,
      command: {
        executable: 'az',
        args
      },
      payload,
      guardrails: [
        'Review the route-plan and handoff evidence before posting.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of Azure DevOps work items.',
        'This command only creates an Azure DevOps work item; it does not page, edit Azure resources, or enable alert rules.'
      ]
    };

    if (!yes) return route;

    const subscription = checkAzureSubscription({
      spawnSync,
      env,
      expectedSubscriptionId,
      approvedSubscriptionIds
    });
    if (!subscription.ok) {
      return {
        ...route,
        mode: 'refused-azure-devops-work-item-route',
        status: null,
        subscription_guard: subscription,
        error: subscription.error
      };
    }

    const result = spawnSync('az', args, {
      encoding: 'utf8',
      env
    });
    if (result.status !== 0) {
      return {
        ...route,
        mode: 'failed-azure-devops-work-item-route',
        status: result.status,
        error: String(result.stderr || result.stdout || 'az boards work-item create failed').trim()
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(String(result.stdout || '{}'));
    } catch {
      parsed = null;
    }

    return {
      ...route,
      status: result.status,
      subscription_guard: subscription,
      work_item_id: parsed && parsed.id ? parsed.id : null,
      work_item_url: parsed && parsed.url ? parsed.url : String(result.stdout || '').trim()
    };
  }

  return {
    alertActionGroupPlan,
    alertActionGroupRoute,
    alertAzureDevOpsWorkItemRoute,
    alertGithubIssueRoute,
    alertOpenRun,
    alertReview,
    alertThresholdPatch,
    alertThresholdSimulation
  };
}

module.exports = {
  createAlertActions
};
