#!/usr/bin/env node

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

(async () => {
  const input = JSON.parse(await readStdin() || '{}');
  const event = {
    timestamp: new Date().toISOString(),
    type: input.type || input.hookType || 'notification',
    source: 'copilot-agentops-azure'
  };

  process.stdout.write(JSON.stringify(event));
  process.exit(0);
})();
