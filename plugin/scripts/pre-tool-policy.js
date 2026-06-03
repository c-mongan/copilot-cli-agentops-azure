#!/usr/bin/env node

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }));
  process.exit(0);
}

function truthy(value) {
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return Boolean(value);
}

(async () => {
  let input;
  try {
    input = JSON.parse(await readStdin() || '{}');
  } catch {
    input = {};
  }
  const tool = input.toolName || input.tool_name || '';
  const args = input.toolArgs || input.tool_args || input.toolInput || input.tool_input || input.input || {};
  const argText = JSON.stringify(args).toLowerCase();
  const metadata = input.metadata || input.meta || {};
  const broadTools = [
    input.allowAllTools,
    input.allow_all_tools,
    metadata.allowAllTools,
    metadata.allow_all_tools,
    metadata['agentops.cli.allow_all_tools']
  ].some(truthy);
  const contentCapture = [
    input.contentCapture,
    input.content_capture,
    input.contentCaptureEnabled,
    input.content_capture_enabled,
    metadata.contentCapture,
    metadata.content_capture,
    metadata.contentCaptureEnabled,
    metadata.content_capture_enabled,
    metadata['agentops.content_capture.signal']
  ].some(truthy);

  const blockedPatterns = [
    'rm -rf /',
    'rm -rf ~',
    'sudo rm',
    'git push --force',
    'git reset --hard',
    'az keyvault secret show',
    'printenv',
    'cat .env',
    'type .env'
  ];

  for (const pattern of blockedPatterns) {
    if (argText.includes(pattern)) {
      return deny(`Blocked by AgentOps demo preToolUse guardrail: risky command or secret access pattern "${pattern}".`);
    }
  }

  if (broadTools && contentCapture) {
    return deny('Blocked by AgentOps demo preToolUse guardrail: broad tool permissions cannot run with content capture enabled.');
  }

  if ((tool.includes('write') || tool.includes('edit')) && argText.includes('.env')) {
    return deny('Blocked by AgentOps demo preToolUse guardrail: writing .env files is not allowed.');
  }

  process.exit(0);
})();
