const path = require('node:path');
const { writeJson: writeJsonValue, writeJsonFile: writeJsonFileValue } = require('./command-output');
const { readJson } = require('./json');

function createAlertCommand(dependencies = {}) {
  const {
    agentOpsScheduledQueryRules,
    alertActionGroupPlan,
    alertActionGroupRoute,
    alertActionPlan,
    alertArtifact,
    alertAzureDevOpsWorkItemRoute,
    alertDetail,
    alertGithubIssueRoute,
    alertHandoff,
    alertHistory,
    alertIncidentTimeline,
    alertOpenRun,
    alertPolicy,
    alertRecommendations,
    alertResourceState,
    alertReview,
    alertRoutePlan,
    alertThresholdPatch,
    alertThresholdSimulation,
    alertTunePlan,
    azAvailable,
    azErrorDetail,
    configuredCloudValues,
    cwd = process.cwd(),
    optionValue,
    optionValues,
    parseJsonOutput,
    parseLastArg,
    readJsonlRows,
    runAz,
    stdout = process.stdout
  } = dependencies;
  const writeJson = value => writeJsonValue(value, stdout);
  const resolvePath = filePath => path.resolve(cwd, filePath);

  function writeJsonFile(filePath, value) {
    const outputPath = resolvePath(filePath);
    writeJsonFileValue(outputPath, value);
    return outputPath;
  }

  function writeOutputFile(filePath, value, key) {
    if (!filePath) return false;
    const outputPath = writeJsonFile(filePath, value);
    writeJson({ output: outputPath, [key]: value });
    return true;
  }

  function alertRunContext(args, defaultLast = '24h') {
    return {
      rule: optionValue(args, ['--rule']),
      session: optionValue(args, ['--session', '--conversation']),
      last: parseLastArg(args, defaultLast)
    };
  }

  function operatorContext(args) {
    return {
      owners: optionValues(args, '--owner'),
      service: optionValue(args, ['--service']) || 'agentops',
      timezone: optionValue(args, ['--timezone', '--tz']) || 'UTC',
      resourceGroup: optionValue(args, ['--resource-group', '-g']) || configuredCloudValues().resourceGroup
    };
  }

  function eventRows(args) {
    const eventsFile = optionValue(args, ['--events']);
    return eventsFile ? readJsonlRows(resolvePath(eventsFile)) : [];
  }

  function alertCommand(args) {
    const [subcommand, ...alertArgs] = args;
    if (subcommand === 'recommend') {
      const last = parseLastArg(alertArgs, '14d');
      writeJson(alertRecommendations(last));
      return;
    }
    if (subcommand === 'tune-plan') {
      const last = parseLastArg(alertArgs, '14d');
      const rule = optionValue(alertArgs, ['--rule']);
      const owner = optionValue(alertArgs, ['--owner']);
      const output = optionValue(alertArgs, ['--output', '--out']);
      const plan = alertTunePlan({ last, rule, owner });
      if (writeOutputFile(output, plan, 'plan')) return;
      writeJson(plan);
      return;
    }
    if (subcommand === 'threshold-simulate') {
      const last = parseLastArg(alertArgs, '14d');
      const rule = optionValue(alertArgs, ['--rule']);
      const threshold = optionValue(alertArgs, ['--threshold']);
      const owner = optionValue(alertArgs, ['--owner']);
      writeJson(alertThresholdSimulation({ rule, threshold, owner, last }));
      return;
    }
    if (subcommand === 'threshold-patch') {
      const last = parseLastArg(alertArgs, '14d');
      const rule = optionValue(alertArgs, ['--rule']);
      const threshold = optionValue(alertArgs, ['--threshold']);
      const owner = optionValue(alertArgs, ['--owner']);
      writeJson(alertThresholdPatch({ rule, threshold, owner, last }));
      return;
    }
    if (subcommand === 'policy') {
      const owners = optionValues(alertArgs, '--owner');
      const service = optionValue(alertArgs, ['--service']) || 'agentops';
      const timezone = optionValue(alertArgs, ['--timezone', '--tz']) || 'UTC';
      writeJson(alertPolicy({ owners, service, timezone }));
      return;
    }
    if (subcommand === 'resources') {
      const cloud = configuredCloudValues();
      const resourceGroup = optionValue(alertArgs, ['--resource-group', '-g']) || cloud.resourceGroup;
      if (!resourceGroup) throw new Error('alert resources requires --resource-group <name> or AGENTOPS_AZURE_RESOURCE_GROUP');
      if (!azAvailable()) {
        writeJson(alertResourceState({
          resourceGroup,
          error: 'Azure CLI was not found on PATH.'
        }));
        return;
      }
      const alertResult = runAz(['monitor', 'scheduled-query', 'list', '--resource-group', resourceGroup, '-o', 'json']);
      const resources = alertResult.status === 0 ? agentOpsScheduledQueryRules(parseJsonOutput(alertResult)) : [];
      writeJson(alertResourceState({
        resourceGroup,
        resources,
        error: alertResult.status === 0 ? null : azErrorDetail(alertResult, 'could not list scheduled query rules')
      }));
      return;
    }
    if (subcommand === 'action-plan') {
      writeJson(alertActionPlan(alertRunContext(alertArgs)));
      return;
    }
    if (subcommand === 'history') {
      const { rule, last } = alertRunContext(alertArgs);
      writeJson(alertHistory({ rule, last }));
      return;
    }
    if (subcommand === 'detail') {
      writeJson(alertDetail(alertRunContext(alertArgs)));
      return;
    }
    if (subcommand === 'open') {
      writeJson(alertOpenRun(alertRunContext(alertArgs)));
      return;
    }
    if (subcommand === 'review') {
      const context = alertRunContext(alertArgs);
      const owners = optionValues(alertArgs, '--owner');
      writeJson(alertReview({ ...context, owners }));
      return;
    }
    if (subcommand === 'export') {
      const output = optionValue(alertArgs, ['--output', '--out']);
      if (!output) throw new Error('alert export requires --output <json>');
      const artifact = alertArtifact(alertRunContext(alertArgs));
      const outputPath = writeJsonFile(output, artifact);
      writeJson({ output: outputPath, artifact });
      return;
    }
    if (subcommand === 'handoff') {
      const output = optionValue(alertArgs, ['--output', '--out']);
      const handoff = alertHandoff({
        ...alertRunContext(alertArgs),
        ...operatorContext(alertArgs),
        events: eventRows(alertArgs)
      });
      if (writeOutputFile(output, handoff, 'handoff')) return;
      writeJson(handoff);
      return;
    }
    if (subcommand === 'route-plan') {
      const targets = optionValues(alertArgs, '--target');
      const output = optionValue(alertArgs, ['--output', '--out']);
      const plan = alertRoutePlan({
        ...alertRunContext(alertArgs),
        ...operatorContext(alertArgs),
        targets,
        events: eventRows(alertArgs)
      });
      if (writeOutputFile(output, plan, 'plan')) return;
      writeJson(plan);
      return;
    }
    if (subcommand === 'route-github') {
      const repo = optionValue(alertArgs, ['--repo']);
      const yes = alertArgs.includes('--yes');
      writeJson(alertGithubIssueRoute({
        ...alertRunContext(alertArgs),
        ...operatorContext(alertArgs),
        repo,
        yes
      }));
      return;
    }
    if (subcommand === 'route-azure-devops') {
      const org = optionValue(alertArgs, ['--org', '--organization']);
      const project = optionValue(alertArgs, ['--project']);
      const workItemType = optionValue(alertArgs, ['--type', '--work-item-type']) || 'Issue';
      const yes = alertArgs.includes('--yes');
      writeJson(alertAzureDevOpsWorkItemRoute({
        ...alertRunContext(alertArgs),
        ...operatorContext(alertArgs),
        org,
        project,
        workItemType,
        yes
      }));
      return;
    }
    if (subcommand === 'action-group-plan') {
      const owners = optionValues(alertArgs, '--owner');
      const resourceGroup = optionValue(alertArgs, ['--resource-group', '-g']) || configuredCloudValues().resourceGroup;
      const name = optionValue(alertArgs, ['--name']);
      const shortName = optionValue(alertArgs, ['--short-name']);
      const emails = optionValues(alertArgs, '--email');
      const webhooks = optionValues(alertArgs, '--webhook');
      const location = optionValue(alertArgs, ['--location']) || 'global';
      writeJson(alertActionGroupPlan({
        resourceGroup,
        name,
        shortName,
        owners,
        emails,
        webhooks,
        location
      }));
      return;
    }
    if (subcommand === 'route-action-group') {
      const scheduledQuery = optionValue(alertArgs, ['--scheduled-query', '--scheduled-query-rule', '--alert-rule']);
      const actionGroups = optionValues(alertArgs, '--action-group');
      const yes = alertArgs.includes('--yes');
      const enableAlert = alertArgs.includes('--enable-alert');
      writeJson(alertActionGroupRoute({
        ...alertRunContext(alertArgs),
        ...operatorContext(alertArgs),
        scheduledQuery,
        actionGroups,
        enableAlert,
        yes
      }));
      return;
    }
    throw new Error('alert currently supports: alert recommend, alert tune-plan, alert threshold-simulate, alert threshold-patch, alert policy, alert resources, alert history, alert detail, alert open, alert review, alert action-plan, alert export, alert handoff, alert route-plan, alert route-github, alert route-azure-devops, alert action-group-plan, alert route-action-group');
  }

  function incidentCommand(args) {
    const [subcommand, ...incidentArgs] = args;
    if (subcommand === 'timeline') {
      const artifactPaths = optionValues(incidentArgs, '--artifact');
      const output = optionValue(incidentArgs, ['--output', '--out']);
      const incidentId = optionValue(incidentArgs, ['--incident', '--incident-id']);
      if (artifactPaths.length === 0) throw new Error('incident timeline requires --artifact <json>');
      if (!output) throw new Error('incident timeline requires --output <json>');
      const artifacts = artifactPaths.map(artifactPath => readJson(resolvePath(artifactPath)));
      const timeline = alertIncidentTimeline({ artifacts, incidentId });
      const outputPath = writeJsonFile(output, timeline);
      writeJson({ output: outputPath, timeline });
      return;
    }
    throw new Error('incident currently supports: incident timeline');
  }

  return {
    alertCommand,
    incidentCommand
  };
}

module.exports = {
  createAlertCommand
};
