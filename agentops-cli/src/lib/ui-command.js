const childProcess = require('node:child_process');

const { createUiServer } = require('./ui/server');

const VALUE_FLAGS = new Set(['--port', '--limit', '--copilot-home', '--agentops-home']);

function parseUiArgs(args = []) {
  const options = { target: null, port: 0, limit: 100, open: null, allowContent: false, help: false, copilotHome: null, agentOpsHome: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? args[index += 1];
      if (value === undefined || value === '') throw new Error(`${flag} requires a value`);
      if (flag === '--port') {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535');
        options.port = port;
      } else if (flag === '--limit') {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('--limit must be an integer from 1 to 5000');
        options.limit = limit;
      } else if (flag === '--copilot-home') {
        options.copilotHome = value;
      } else {
        options.agentOpsHome = value;
      }
    } else if (flag === '--open') {
      options.open = true;
    } else if (flag === '--no-open') {
      options.open = false;
    } else if (flag === '--allow-content') {
      options.allowContent = true;
    } else if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else if (flag === '--ui') {
      // accepted so `agentops open latest --ui` can forward its args unchanged
    } else if (flag.startsWith('-')) {
      throw new Error(`Unknown option for agentops ui: ${flag}`);
    } else if (!options.target) {
      options.target = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (options.target && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.target)) throw new Error('Session or run ID contains unsupported characters');
  return options;
}

function uiUsage() {
  return `agentops ui [latest|<session-id>|<run-id>] [options]

Starts a local, read-only web UI for Copilot CLI sessions on this machine.
No Azure, Docker or network access needed. Binds to 127.0.0.1 only.

Options:
  --open               open the browser (default when run in an interactive terminal)
  --no-open            print the URL only
  --port <n>           port to bind (default: a free port)
  --limit <n>          analyse the newest <n> sessions (default: 100)
  --allow-content      also serve redacted prompts, tool arguments and results for local sessions
  --copilot-home <dir> Copilot CLI home (default: $COPILOT_HOME or ~/.copilot)
  --agentops-home <dir> AgentOps ledger home (default: $AGENTOPS_HOME or ~/.agentops)

Examples:
  agentops ui
  agentops ui latest
  agentops open latest --ui
`;
}

function openBrowser(url, { platform = process.platform, spawn = childProcess.spawn } = {}) {
  const command = platform === 'darwin' ? 'open' : (platform === 'win32' ? 'cmd' : 'xdg-open');
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function shouldOpen(option, { stdout = process.stdout, env = process.env } = {}) {
  if (option !== null) return option;
  return Boolean(stdout.isTTY) && !env.CI;
}

async function startUi(options = {}, io = {}) {
  const stdout = io.stdout || process.stdout;
  const ui = createUiServer({
    copilotHome: options.copilotHome || undefined,
    agentOpsHome: options.agentOpsHome || undefined,
    limit: options.limit,
    allowContent: options.allowContent
  });
  const { url } = await ui.listen(options.port || 0);
  let target = '';
  if (options.target) {
    const entry = await ui.store.resolveEntry(options.target);
    if (entry) target = `#/run/${encodeURIComponent(entry.id)}`;
    else stdout.write(`No local session or run matches "${options.target}"; opening the runs list.\n`);
  }
  const fullUrl = `${url}${target}`;
  stdout.write(`AgentOps UI running at ${fullUrl}\n`);
  stdout.write(options.allowContent
    ? 'Content mode: redacted prompts, tool arguments and results are served to this machine only. Press Ctrl+C to stop.\n'
    : 'Metadata only: prompts, tool arguments and results are not served. Press Ctrl+C to stop.\n');
  if (shouldOpen(options.open, io) && !(io.openBrowser || openBrowser)(fullUrl)) {
    stdout.write('Could not open a browser automatically; open the URL above.\n');
  }
  return { ...ui, url: fullUrl };
}

async function uiCommand(args = [], io = {}) {
  const options = parseUiArgs(args);
  const stdout = io.stdout || process.stdout;
  if (options.help) {
    stdout.write(uiUsage());
    return null;
  }
  const ui = await startUi(options, io);
  if (io.keepAlive === false) return ui;
  const stop = () => {
    ui.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return ui;
}

module.exports = {
  openBrowser,
  parseUiArgs,
  shouldOpen,
  startUi,
  uiCommand,
  uiUsage
};
