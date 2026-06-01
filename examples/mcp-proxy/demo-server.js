#!/usr/bin/env node

function handleMessage(message) {
  if (message.method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: 'ok' }]
      }
    };
  }
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {}
  };
}

let pending = '';
process.stdin.on('data', chunk => {
  pending += chunk.toString('utf8');
  const lines = pending.split(/\r?\n/);
  pending = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    process.stdout.write(`${JSON.stringify(handleMessage(message))}\n`);
  }
});

