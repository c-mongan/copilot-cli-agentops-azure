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

  if ((tool.includes('write') || tool.includes('edit')) && argText.includes('.env')) {
    return deny('Blocked by AgentOps demo preToolUse guardrail: writing .env files is not allowed.');
  }

  process.exit(0);
})();
