'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const MACHO = new Set(['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca']);
function nativeExecutable(file, platform = process.platform) {
  try {
    const target = fs.realpathSync(file); const stat = fs.statSync(target);
    if (!stat.isFile()) return null;
    // Windows mode bits do not represent ACL ownership or write permissions.
    if (platform !== 'win32' && (!(stat.mode & 0o111) || (stat.mode & 0o022) || ![0, process.getuid?.()].includes(stat.uid))) return null;
    const fd = fs.openSync(target, 'r'); const magic = Buffer.alloc(4);
    try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    return (platform === 'win32' ? magic.subarray(0, 2).toString() === 'MZ' : MACHO.has(magic.toString('hex'))) ? target : null;
  } catch { return null; }
}
function windowsPathLookup() {
  const where = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
  const result = spawnSync(where, ['copilot.exe'], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true });
  return result.error || result.status !== 0 ? [] : result.stdout.split(/\r?\n/).map(file => file.trim()).filter(Boolean);
}
function resolveCopilotBinary(platform = process.platform, { lookup = windowsPathLookup, validateNative = nativeExecutable } = {}) {
  if (platform === 'win32') {
    // Winget/standalone native installations publish copilot.exe on PATH.
    for (const candidate of lookup()) {
      if (!path.win32.isAbsolute(candidate) && !path.isAbsolute(candidate)) continue;
      if (!candidate.toLowerCase().endsWith('copilot.exe')) continue;
      const binary = validateNative(candidate, platform); if (binary) return binary;
    }
    // npm's official platform optional package provides a native executable.
    for (const base of [path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')]) {
      const binary = nativeExecutable(path.join(base, 'node_modules', '@github', 'copilot', 'node_modules', '@github', `copilot-win32-${process.arch}`, 'copilot.exe'), platform);
      if (binary) return binary;
    }
    throw new Error('An installed native Copilot executable is required on Windows.');
  }
  for (const file of ['/opt/homebrew/bin/copilot', '/usr/local/bin/copilot', path.join(os.homedir(), '.local/bin/copilot')]) {
    const native = nativeExecutable(file); if (native) return native;
    try {
      // The npm launcher can require global Node. Prefer its installed native optional package.
      const entry = fs.realpathSync(file);
      if (path.basename(entry) !== 'npm-loader.js' || path.basename(path.dirname(entry)) !== 'copilot') continue;
      const binary = nativeExecutable(path.join(path.dirname(entry), 'node_modules', '@github', `copilot-darwin-${process.arch}`, 'copilot'));
      if (binary) return binary;
    } catch {}
  }
  throw new Error('An installed native Copilot executable is required.');
}
const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
function launchScript(binary) {
  if (!path.isAbsolute(binary) || /[\r\n\0]/.test(binary)) throw new Error('Copilot binary path is invalid.');
  return `#!/bin/bash\nset -eu\n# Only this newly launched Copilot session receives capture configuration.\nfor CAPTURE_KEY in \${!OTEL_@} \${!COPILOT_OTEL_@}; do unset "$CAPTURE_KEY"; done\nexport COPILOT_OTEL_ENABLED=true\nexport COPILOT_OTEL_EXPORTER_TYPE=otlp-http\nexport COPILOT_OTEL_ENDPOINT=http://127.0.0.1:4318\nexport COPILOT_OTEL_CAPTURE_CONTENT=false\nexport COPILOT_OTEL_CAPTURE_IDENTITY=false\nexport OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318\nexport OTEL_EXPORTER_OTLP_PROTOCOL=http/json\nexport OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false\ncd "$HOME"\nexec ${shellQuote(binary)}\n`;
}
function launchCopilotTerminal(storage, { resolveBinary = resolveCopilotBinary, spawn = spawnSync, platform = process.platform } = {}) {
  const binary = resolveBinary();
  const script = platform === 'win32' ? windowsLaunchScript(binary) : launchScript(binary);
  const command = path.join(storage, platform === 'win32' ? 'start-copilot.cmd' : 'start-copilot.command');
  const temporary = path.join(storage, `start-copilot-${crypto.randomUUID()}.tmp`);
  try { fs.writeFileSync(temporary, script, { mode: 0o700, flag: 'wx' }); fs.renameSync(temporary, command); }
  finally { fs.rmSync(temporary, { force: true }); }
  const result = platform === 'win32' ? spawn('explorer.exe', [command], { stdio: 'ignore' }) : spawn('/usr/bin/open', ['-a', 'Terminal', command], { stdio: 'ignore' });
  if (result.error || result.status !== 0) throw new Error('Copilot terminal could not open.');
  return { launched: true };
}
function windowsLaunchScript(binary) {
  if (!/^[A-Za-z]:[\\/]/.test(binary) || /[\r\n\0"%!^&|<>]/.test(binary)) throw new Error('Windows Copilot path contains unsupported command characters.');
  const environment = { COPILOT_OTEL_ENABLED: 'true', COPILOT_OTEL_EXPORTER_TYPE: 'otlp-http', COPILOT_OTEL_ENDPOINT: 'http://127.0.0.1:4318', COPILOT_OTEL_CAPTURE_CONTENT: 'false', COPILOT_OTEL_CAPTURE_IDENTITY: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false' };
  return `@echo off
setlocal DisableDelayedExpansion
for /f "tokens=1 delims==" %%K in ('set OTEL_ 2^>nul') do set "%%K="
for /f "tokens=1 delims==" %%K in ('set COPILOT_OTEL_ 2^>nul') do set "%%K="
` + Object.entries(environment).map(([key, value]) => `set "${key}=${value}"`).join('\r\n') + `\r\ncd /d "%USERPROFILE%"\r\n"${binary}"\r\n`;
}
module.exports = { launchCopilotTerminal, launchScript, resolveCopilotBinary, nativeExecutable, windowsLaunchScript, windowsPathLookup };
