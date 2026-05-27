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
  const error = String(input.error || '').toLowerCase();
  const args = JSON.stringify(input.toolArgs || input.tool_input || {}).toLowerCase();
  const hints = [];

  if (args.includes('npm test') || error.includes('npm')) {
    hints.push('Recovery hint: check whether this repo uses pnpm, yarn, bun, or workspaces before retrying npm commands.');
  }

  if (error.includes('permission denied') || error.includes('eacces')) {
    hints.push('Recovery hint: avoid sudo. Check file ownership, workspace path, and whether the command should run from a different directory.');
  }

  if (error.includes('no such file') || error.includes('cannot find')) {
    hints.push('Recovery hint: run `pwd`, list the relevant directory, and verify repo-relative paths before retrying.');
  }

  if (hints.length === 0) process.exit(0);

  process.stdout.write(hints.join('\n'));
  process.exit(2);
})();
