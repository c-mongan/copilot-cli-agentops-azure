const childProcess = require('node:child_process');
const { checkAzureSubscription } = require('./azure/subscription-guard');

function createAlertActionGroupActions(config = {}) {
  const { alertHandoff } = config;

  function alertActionGroupPlan({ resourceGroup, name, shortName, owners = [], emails = [], webhooks = [], location = 'global' } = {}) {
    const normalizedResourceGroup = String(resourceGroup || '').trim();
    if (!normalizedResourceGroup) throw new Error('alert action-group-plan requires --resource-group <rg>');

    const normalizedName = String(name || '').trim();
    if (!normalizedName) throw new Error('alert action-group-plan requires --name <action-group-name>');

    const normalizedShortName = String(shortName || '').trim();
    if (!normalizedShortName) throw new Error('alert action-group-plan requires --short-name <short>');
    if (normalizedShortName.length > 12) throw new Error('alert action-group-plan --short-name must be 12 characters or fewer');

    const normalizedOwners = owners.map(owner => String(owner || '').trim()).filter(Boolean);
    if (normalizedOwners.length === 0) throw new Error('alert action-group-plan requires at least one --owner <name>');

    const normalizedEmails = emails.map(email => String(email || '').trim()).filter(Boolean);
    const normalizedWebhooks = webhooks.map(webhook => String(webhook || '').trim()).filter(Boolean);
    if (normalizedEmails.length === 0 && normalizedWebhooks.length === 0) {
      throw new Error('alert action-group-plan requires at least one --email <address> or --webhook <url>');
    }

    const emailReceivers = normalizedEmails.map((email, index) => ({
      name: `email-${index + 1}`,
      email_address: email
    }));
    const webhookReceivers = normalizedWebhooks.map((webhook, index) => ({
      name: `webhook-${index + 1}`,
      service_uri: webhook
    }));

    const args = [
      'monitor',
      'action-group',
      'create',
      '--resource-group',
      normalizedResourceGroup,
      '--name',
      normalizedName,
      '--short-name',
      normalizedShortName,
      '--location',
      String(location || 'global').trim() || 'global'
    ];

    for (const receiver of emailReceivers) args.push('--action', 'email', receiver.name, receiver.email_address);
    for (const receiver of webhookReceivers) args.push('--action', 'webhook', receiver.name, receiver.service_uri);

    return {
      schema_version: 'agentops.alert-action-group-plan.v1',
      mode: 'preview-only-action-group-plan',
      resource_group: normalizedResourceGroup,
      action_group: {
        name: normalizedName,
        short_name: normalizedShortName,
        location: String(location || 'global').trim() || 'global'
      },
      owner: normalizedOwners[0],
      receivers: {
        email: emailReceivers,
        webhook: webhookReceivers
      },
      command: {
        executable: 'az',
        args
      },
      follow_up_route_command: `agentops alert route-action-group --resource-group ${normalizedResourceGroup} --scheduled-query <scheduled-query-name> --action-group <action-group-resource-id> --rule <rule> --session <conversation-id> --owner ${normalizedOwners[0]}`,
      guardrails: [
        'Preview-only: this command does not create or update Azure Monitor action groups.',
        'Review receiver ownership, destination accuracy, and escalation policy before creating the action group.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of receiver names and webhook URLs.'
      ],
      next: [
        'Review the generated Azure CLI command with the action group owner.',
        'Create the action group only after receiver approval.',
        'Run alert route-action-group after the action group resource ID is approved.'
      ]
    };
  }

  function alertActionGroupRoute({ rule, session, last = '24h', owners = [], service = 'agentops', timezone = 'UTC', resourceGroup, scheduledQuery, actionGroups = [], enableAlert = false, yes = false, spawnSync = childProcess.spawnSync, env = process.env, expectedSubscriptionId, approvedSubscriptionIds } = {}) {
    const normalizedResourceGroup = String(resourceGroup || '').trim();
    if (!normalizedResourceGroup) throw new Error('alert route-action-group requires --resource-group <rg>');

    const normalizedScheduledQuery = String(scheduledQuery || '').trim();
    if (!normalizedScheduledQuery) throw new Error('alert route-action-group requires --scheduled-query <name>');

    const normalizedActionGroups = actionGroups.map(item => String(item || '').trim()).filter(Boolean);
    if (normalizedActionGroups.length === 0) throw new Error('alert route-action-group requires at least one --action-group <id>');

    const normalizedOwners = owners.map(owner => String(owner || '').trim()).filter(Boolean);
    if (normalizedOwners.length === 0) throw new Error('alert route-action-group requires at least one --owner <name>');

    const handoff = alertHandoff({
      rule,
      session,
      last,
      owners: normalizedOwners,
      service,
      timezone,
      resourceGroup: normalizedResourceGroup
    });

    const args = [
      'monitor',
      'scheduled-query',
      'update',
      '--resource-group',
      normalizedResourceGroup,
      '--name',
      normalizedScheduledQuery,
      '--action-groups',
      ...normalizedActionGroups
    ];
    if (enableAlert) args.push('--disabled', 'false');

    const route = {
      schema_version: 'agentops.alert-action-group-route.v1',
      mode: yes ? 'routed-action-group' : 'dry-run-action-group-route',
      alert: handoff.alert,
      resource_group: normalizedResourceGroup,
      scheduled_query: normalizedScheduledQuery,
      action_groups: normalizedActionGroups,
      owner: normalizedOwners[0],
      enable_alert: Boolean(enableAlert),
      command: {
        executable: 'az',
        args
      },
      evidence: {
        handoff_schema: handoff.schema_version,
        session_link: handoff.evidence.detail.session_link,
        history_query: handoff.evidence.detail.history_query
      },
      guardrails: [
        'Review the handoff evidence, threshold tune-plan, and action group receivers before routing notifications.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of notification routes.',
        'This command only attaches approved Azure Monitor action groups; use --enable-alert only after threshold review.'
      ]
    };

    if (!yes) return route;

    const subscription = checkAzureSubscription({ spawnSync, env, expectedSubscriptionId, approvedSubscriptionIds });
    if (!subscription.ok) {
      return {
        ...route,
        mode: 'refused-action-group-route',
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
        mode: 'failed-action-group-route',
        status: result.status,
        error: String(result.stderr || result.stdout || 'az monitor scheduled-query update failed').trim()
      };
    }

    return {
      ...route,
      status: result.status,
      subscription_guard: subscription,
      output: String(result.stdout || '').trim()
    };
  }

  return {
    alertActionGroupPlan,
    alertActionGroupRoute
  };
}

module.exports = {
  createAlertActionGroupActions
};
