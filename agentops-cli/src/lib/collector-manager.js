const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { optionValue, hasFlag } = require('./args');
const legacy = require('../legacy');
const {
  collectorConfigPath,
  collectorDir,
  collectorHome,
  repoRoot
} = require('./paths');
const { commandCandidates, commandExists, isExecutable, run } = require('./shell');
const { contentLikeKeys, makePoisonAttributes, poisonCheck, sanitizeAttributesStrict } = require('./privacy');

const collectorModes = ['auto', 'docker', 'binary', 'none'];
const privacyModes = ['strict', 'compat'];
const dockerProjectName = 'agentops-azuremonitor';
const defaultCollectorVersion = '0.151.0';
const healthUrl = 'http://127.0.0.1:13133';
const otlpHttpEndpoint = 'http://127.0.0.1:4318';
const composeFile = path.join(collectorDir, 'docker-compose.azuremonitor.yaml');

function parseCollectorOptions(args = [], env = process.env) {
  const mode = optionValue(args, ['--mode'], env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const privacy = optionValue(args, ['--privacy'], env.AGENTOPS_PRIVACY_MODE || 'strict');
  return {
    mode: normalizeMode(mode),
    privacy: normalizePrivacy(privacy),
    json: hasFlag(args, '--json'),
    poison: hasFlag(args, '--poison'),
    force: hasFlag(args, '--force'),
    purge: hasFlag(args, '--purge'),
    version: optionValue(args, ['--version'], env.AGENTOPS_OTELCOL_VERSION || defaultCollectorVersion),
    unsafeNoCollector: hasFlag(args, '--unsafe-no-collector') || env.AGENTOPS_ALLOW_NO_COLLECTOR === '1'
  };
}

function normalizeMode(mode) {
  const value = String(mode || 'auto').toLowerCase();
  if (!collectorModes.includes(value)) throw new Error(`Unsupported collector mode: ${mode}`);
  return value;
}

function normalizePrivacy(privacy) {
  const value = String(privacy || 'strict').toLowerCase();
  if (!privacyModes.includes(value)) throw new Error(`Unsupported privacy mode: ${privacy}`);
  return value;
}

function configTargetForMode(mode) {
  return mode === 'binary' ? 'binary' : 'azuremonitor';
}

function configPathFor(mode, privacy) {
  return collectorConfigPath({ target: configTargetForMode(mode), privacy });
}

function dockerComposeArgs(extra = [], privacy = 'strict') {
  return [
    'compose',
    '--project-name',
    dockerProjectName,
    '--project-directory',
    collectorDir,
    '-f',
    composeFile,
    ...extra
  ];
}

function composeHasLocalhostBindings(filePath = composeFile) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  return [
    '127.0.0.1:4318:4318',
    '127.0.0.1:4317:4317',
    '127.0.0.1:13133:13133'
  ].every(binding => text.includes(binding)) && !/["']?0\.0\.0\.0:43(17|18):/.test(text);
}

function dockerCliAvailable() {
  return commandExists('docker');
}

function dockerDaemonAvailable() {
  if (!dockerCliAvailable()) return false;
  const result = run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5000 });
  return result.status === 0;
}

function dockerComposeAvailable() {
  if (!dockerCliAvailable()) return false;
  const result = run('docker', ['compose', 'version'], { timeout: 5000 });
  return result.status === 0;
}

function findCollectorBinary(env = process.env) {
  const configured = env.AGENTOPS_OTELCOL_BIN;
  if (configured) {
    const resolved = path.resolve(configured);
    return {
      path: resolved,
      source: 'AGENTOPS_OTELCOL_BIN',
      ok: isExecutable(resolved),
      error: isExecutable(resolved) ? null : `AGENTOPS_OTELCOL_BIN is not executable: ${resolved}`
    };
  }

  const installedNames = process.platform === 'win32'
    ? ['otelcol-contrib.exe', 'otelcol-contrib', 'otelcol.exe', 'otelcol']
    : ['otelcol-contrib', 'otelcol'];
  for (const name of installedNames) {
    const candidate = path.join(collectorHome, 'bin', name);
    if (isExecutable(candidate)) {
      return { path: candidate, source: 'AGENTOPS_COLLECTOR_HOME', ok: true, error: null };
    }
  }

  for (const name of ['otelcol-contrib', 'otelcol']) {
    const candidate = commandCandidates(name)[0];
    if (candidate && isExecutable(candidate)) {
      return { path: candidate, source: 'PATH', ok: true, error: null };
    }
  }

  return {
    path: null,
    source: null,
    ok: false,
    error: 'No otelcol-contrib or otelcol binary found on PATH. Set AGENTOPS_OTELCOL_BIN or install a Collector binary.'
  };
}

function resolveAutoMode(env = process.env) {
  const binary = findCollectorBinary(env);
  if (binary.ok) return { mode: 'binary', reason: `using ${binary.path}` };
  if (dockerCliAvailable() && dockerComposeAvailable() && dockerDaemonAvailable()) {
    return { mode: 'docker', reason: 'using Docker Compose fallback' };
  }
  return {
    mode: null,
    reason: [
      binary.error,
      dockerCliAvailable() && dockerComposeAvailable()
        ? 'Docker daemon is not reachable.'
        : 'Docker Compose is not available.',
      'Run `agentops collector install-binary`, or start/install Docker, then rerun the command.'
    ].join(' ')
  };
}

function pidFile() {
  return path.join(collectorHome, 'otelcol.pid');
}

function logFile() {
  return path.join(collectorHome, 'otelcol.log');
}

function installedCollectorBinaryPath(platform = process.platform) {
  return path.join(collectorHome, 'bin', platform === 'win32' ? 'otelcol-contrib.exe' : 'otelcol-contrib');
}

function collectorPackageInfo({ version = defaultCollectorVersion, platform = process.platform, arch = process.arch } = {}) {
  const normalizedVersion = String(version || defaultCollectorVersion).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(normalizedVersion)) {
    throw new Error(`Collector version must look like 0.151.0, got: ${version}`);
  }

  const osMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const goos = osMap[platform];
  const goarch = archMap[arch];
  if (!goos || !goarch) {
    throw new Error(`Unsupported Collector binary platform: ${platform}/${arch}`);
  }

  const fileName = `otelcol-contrib_${normalizedVersion}_${goos}_${goarch}.tar.gz`;
  const checksumFileName = goos === 'windows'
    ? 'opentelemetry-collector-releases_otelcol-contrib_windows_checksums.txt'
    : 'opentelemetry-collector-releases_otelcol-contrib_checksums.txt';
  const releaseBaseUrl = `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${normalizedVersion}`;
  return {
    version: normalizedVersion,
    goos,
    goarch,
    fileName,
    checksumFileName,
    binaryName: goos === 'windows' ? 'otelcol-contrib.exe' : 'otelcol-contrib',
    url: `${releaseBaseUrl}/${fileName}`,
    checksumUrl: `${releaseBaseUrl}/${checksumFileName}`
  };
}

function downloadFile(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error(`Too many redirects while downloading ${url}`));
    const request = https.get(url, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const location = response.headers.location;
        if (!location) return reject(new Error(`Redirect from ${url} did not include a Location header.`));
        return resolve(downloadFile(new URL(location, url).toString(), destination, redirectCount + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed (${response.statusCode}) from ${url}`));
      }
      const file = fs.createWriteStream(destination, { mode: 0o600 });
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
      return null;
    });
    request.on('error', reject);
    return request;
  });
}

function validateBinaryConfig(binaryPath, privacy = 'strict') {
  const config = configPathFor('binary', privacy);
  if (!fs.existsSync(config)) {
    return { ok: false, mode: 'binary', privacyMode: privacy, config, error: `Config not found: ${config}` };
  }
  const result = run(binaryPath, ['validate', '--config', config], { timeout: 30000 });
  return {
    ok: result.status === 0,
    mode: 'binary',
    privacyMode: privacy,
    config,
    command: `${binaryPath} validate --config ${config}`,
    error: result.status === 0 ? null : (result.stderr || result.stdout || `collector validate exited ${result.status}`).trim()
  };
}

function validateCollectorArtifacts(options = {}) {
  const root = options.root || repoRoot;
  const collectorRoot = path.join(root, 'collector');
  const processorsDir = path.join(collectorRoot, 'processors');
  const fixturesDir = path.join(collectorRoot, 'tests', 'privacy-poison-fixtures');
  const requiredProcessors = [
    'strict-allowlist.yaml',
    'content-signal.yaml',
    'genai-normalizer.yaml',
    'mcp-normalizer.yaml',
    'span-to-run-summary.yaml'
  ];
  const requiredFixtures = ['content-poison.json', 'mcp-poison.json'];
  const errors = [];
  const warnings = [];

  for (const file of requiredProcessors) {
    const fullPath = path.join(processorsDir, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`missing collector processor fragment: ${fullPath}`);
      continue;
    }
    const body = fs.readFileSync(fullPath, 'utf8');
    if (file === 'strict-allowlist.yaml' && !body.includes('keep_keys')) errors.push(`${file}: missing keep_keys allowlist`);
    if (file === 'content-signal.yaml' && !body.includes('agentops.content_capture.signal')) errors.push(`${file}: missing content capture signal`);
    if (file === 'genai-normalizer.yaml' && !body.includes('gen_ai.operation.name')) errors.push(`${file}: missing GenAI operation mapping`);
    if (file === 'mcp-normalizer.yaml' && !body.includes('mcp.method.name')) errors.push(`${file}: missing MCP method mapping`);
    if (file === 'span-to-run-summary.yaml' && !body.includes('AgentOpsRunSummary_CL')) errors.push(`${file}: missing run summary table contract`);
  }

  const fixtureResults = [];
  for (const file of requiredFixtures) {
    const fullPath = path.join(fixturesDir, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`missing poison fixture: ${fullPath}`);
      continue;
    }
    let fixture;
    try {
      fixture = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (error) {
      errors.push(`${file}: invalid JSON: ${error.message}`);
      continue;
    }
    const sanitized = sanitizeAttributesStrict(fixture);
    const serialized = JSON.stringify(sanitized);
    const leaked = serialized.match(/SECRET_[A-Z_]+|api_key=|cat ~\/\.ssh\/id_rsa|this should never leave local machine/g) || [];
    const observedContent = Object.keys(fixture).some(key => contentLikeKeys.includes(key) || /argument|result|message|prompt|secret|token|url/i.test(key));
    const ok = leaked.length === 0 && (!observedContent || sanitized['agentops.content_capture.signal'] === true);
    if (!ok) errors.push(`${file}: strict sanitizer did not drop all poison content`);
    fixtureResults.push({
      file,
      ok,
      leaked,
      content_signal: sanitized['agentops.content_capture.signal'] === true
    });
  }

  const strictConfigs = ['otelcol.azuremonitor.strict.yaml', 'otelcol.binary.strict.yaml', 'otelcol.local.strict.yaml'];
  for (const file of strictConfigs) {
    const fullPath = path.join(collectorRoot, file);
    if (!fs.existsSync(fullPath)) errors.push(`missing strict collector config: ${fullPath}`);
    else if (!fs.readFileSync(fullPath, 'utf8').includes('transform/privacy_strict')) warnings.push(`${file}: does not reference transform/privacy_strict`);
  }

  return {
    ok: errors.length === 0,
    processors: requiredProcessors.map(file => path.join(processorsDir, file)),
    fixtures: fixtureResults,
    errors,
    warnings
  };
}

function parseChecksumFile(text, fileName) {
  const escaped = String(fileName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^([a-fA-F0-9]{64})\\s+\\*?${escaped}$`, 'm');
  const match = String(text || '').match(pattern);
  return match ? match[1].toLowerCase() : null;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function verifyChecksum({ archive, checksumsText, fileName }) {
  const expected = parseChecksumFile(checksumsText, fileName);
  if (!expected) {
    return { ok: false, fileName, error: `No SHA256 checksum found for ${fileName}.` };
  }
  const actual = sha256File(archive);
  return {
    ok: actual === expected,
    fileName,
    expected,
    actual,
    error: actual === expected ? null : `SHA256 mismatch for ${fileName}.`
  };
}

async function installBinary(options = {}) {
  const packageInfo = collectorPackageInfo({ version: options.version });
  const destination = installedCollectorBinaryPath();
  const binDir = path.dirname(destination);
  const existing = isExecutable(destination);

  if (existing && !options.force) {
    const validation = validateBinaryConfig(destination, options.privacy || 'strict');
    return {
      ok: validation.ok !== false,
      action: 'install-binary',
      alreadyInstalled: true,
      path: destination,
      version: packageInfo.version,
      url: packageInfo.url,
      checksumUrl: packageInfo.checksumUrl,
      validation
    };
  }

  if (!commandExists('tar')) {
    return { ok: false, action: 'install-binary', error: 'The tar command is required to extract the Collector release archive.' };
  }

  fs.mkdirSync(binDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otelcol-install-'));
  const archive = path.join(tempDir, packageInfo.fileName);
  const checksums = path.join(tempDir, packageInfo.checksumFileName);
  try {
    await downloadFile(packageInfo.url, archive);
    await downloadFile(packageInfo.checksumUrl, checksums);
    const checksum = verifyChecksum({
      archive,
      checksumsText: fs.readFileSync(checksums, 'utf8'),
      fileName: packageInfo.fileName
    });
    if (!checksum.ok) {
      return {
        ok: false,
        action: 'install-binary',
        url: packageInfo.url,
        checksumUrl: packageInfo.checksumUrl,
        checksum,
        error: checksum.error
      };
    }
    const extract = run('tar', ['-xzf', archive, '-C', tempDir], { timeout: 60000 });
    if (extract.status !== 0) {
      return {
        ok: false,
        action: 'install-binary',
        url: packageInfo.url,
        error: (extract.stderr || extract.stdout || `tar exited ${extract.status}`).trim()
      };
    }

    const extracted = path.join(tempDir, packageInfo.binaryName);
    if (!fs.existsSync(extracted)) {
      return { ok: false, action: 'install-binary', url: packageInfo.url, error: `Release archive did not contain ${packageInfo.binaryName}.` };
    }
    fs.copyFileSync(extracted, destination);
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);

    const validation = validateBinaryConfig(destination, options.privacy || 'strict');
    return {
      ok: validation.ok === true,
      action: 'install-binary',
      alreadyInstalled: false,
      path: destination,
      version: packageInfo.version,
      url: packageInfo.url,
      checksumUrl: packageInfo.checksumUrl,
      checksum,
      validation,
      error: validation.ok === true ? null : validation.error
    };
  } catch (error) {
    return { ok: false, action: 'install-binary', url: packageInfo.url, error: error.message };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function uninstallBinary(options = {}) {
  const stopped = stop({ mode: 'binary', privacy: options.privacy || 'strict' });
  const removed = [];
  for (const name of ['otelcol-contrib', 'otelcol-contrib.exe']) {
    const candidate = path.join(collectorHome, 'bin', name);
    if (fs.existsSync(candidate)) {
      fs.rmSync(candidate, { force: true });
      removed.push(candidate);
    }
  }
  fs.rmSync(pidFile(), { force: true });
  if (options.purge) {
    fs.rmSync(logFile(), { force: true });
    const binDir = path.join(collectorHome, 'bin');
    try {
      if (fs.existsSync(binDir) && fs.readdirSync(binDir).length === 0) fs.rmdirSync(binDir);
    } catch {}
  }
  return {
    ok: true,
    action: 'uninstall-binary',
    stopped,
    removed,
    purged: Boolean(options.purge),
    collectorHome
  };
}

function readPid() {
  try {
    return Number(fs.readFileSync(pidFile(), 'utf8').trim());
  } catch {
    return null;
  }
}

function processAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findCollectorProcessByConfig(configPath, binaryPath = null) {
  if (process.platform === 'win32' || !configPath) return null;
  const result = run('ps', ['-axo', 'pid=,command='], { timeout: 5000 });
  if (result.status !== 0) return null;
  const lines = String(result.stdout || '').split('\n');
  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (
      pid !== process.pid
      && (!binaryPath || command.includes(binaryPath))
      && command.includes('--config')
      && command.includes(configPath)
      && processAlive(pid)
    ) {
      return pid;
    }
  }
  return null;
}

function findManagedCollectorProcess(binaryPath, configPath) {
  return findCollectorProcessByConfig(configPath, binaryPath);
}

function findRunningBinaryCollector(binaryPath = null) {
  for (const privacy of privacyModes) {
    const config = configPathFor('binary', privacy);
    const pid = binaryPath ? findManagedCollectorProcess(binaryPath, config) : findCollectorProcessByConfig(config);
    if (pid) return { pid, privacy, config };
  }
  return null;
}

function healthCheck(url = healthUrl, timeoutMs = 1000) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: timeoutMs }, response => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 500, statusCode: response.statusCode });
    });
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', error => resolve({ ok: false, error: error.message }));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = await healthCheck();
  while (!last.ok && Date.now() < deadline) {
    await sleep(250);
    last = await healthCheck();
  }
  return last;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function otlpValue(value) {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { intValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  return { stringValue: String(value) };
}

function otlpAttributes(attributes) {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

function postJson(url, payload) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      },
      timeout: 5000
    }, response => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => resolve({ ok: false, error: error.message }));
    request.end(body);
  });
}

async function runtimePoisonSmoke({ privacy }) {
  if (privacy !== 'strict') return { status: 'skipped', reason: 'Runtime poison smoke only applies to strict privacy mode.' };
  const binary = findCollectorBinary();
  if (!binary.ok) return { status: 'skipped', reason: binary.error };

  const httpPort = await freePort();
  const grpcPort = await freePort();
  const healthPort = await freePort();
  const telemetryPort = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-smoke-'));
  const sourceConfig = collectorConfigPath({ target: 'local', privacy: 'strict' });
  const config = path.join(tempDir, 'otelcol.local.strict.yaml');
  const log = path.join(tempDir, 'otelcol.log');
  const configText = fs.readFileSync(sourceConfig, 'utf8')
    .replace(/127\.0\.0\.1:4318/g, `127.0.0.1:${httpPort}`)
    .replace(/127\.0\.0\.1:4317/g, `127.0.0.1:${grpcPort}`)
    .replace(/127\.0\.0\.1:13133/g, `127.0.0.1:${healthPort}`)
    .replace(
      /service:\n/,
      `service:\n  telemetry:\n    metrics:\n      readers:\n        - pull:\n            exporter:\n              prometheus:\n                host: 127.0.0.1\n                port: ${telemetryPort}\n`
    );
  fs.writeFileSync(config, configText);

  const validateResult = run(binary.path, ['validate', '--config', config], { timeout: 30000 });
  if (validateResult.status !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return {
      status: 'failed',
      ok: false,
      error: (validateResult.stderr || validateResult.stdout || `collector validate exited ${validateResult.status}`).trim()
    };
  }

  const out = fs.openSync(log, 'a');
  const child = childProcess.spawn(binary.path, ['--config', config], {
    detached: true,
    stdio: ['ignore', out, out]
  });

  const cleanup = () => {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {}
    fs.closeSync(out);
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    const health = await waitForHealthUrl(`http://127.0.0.1:${healthPort}`, 5000);
    if (!health.ok) return { status: 'failed', ok: false, error: 'Temporary collector health endpoint did not become ready.', health };

    const poison = makePoisonAttributes();
    const now = BigInt(Date.now()) * 1000000n;
    const payload = {
      resourceSpans: [{
        resource: {
          attributes: otlpAttributes({
            'service.name': 'agentops-poison-smoke',
            'service.namespace': 'copilot-agentops',
            'agent.framework': 'github-copilot',
            'agent.runtime': 'github-copilot-cli',
            'agentops.poison_id': poison['agentops.poison_id']
          })
        },
        scopeSpans: [{
          spans: [{
            traceId: crypto.randomBytes(16).toString('hex'),
            spanId: crypto.randomBytes(8).toString('hex'),
            name: 'agentops strict poison smoke',
            kind: 2,
            startTimeUnixNano: String(now),
            endTimeUnixNano: String(now + 1000000n),
            attributes: otlpAttributes(poison)
          }]
        }]
      }]
    };
    const post = await postJson(`http://127.0.0.1:${httpPort}/v1/traces`, payload);
    if (!post.ok) return { status: 'failed', ok: false, error: 'Poison OTLP POST failed.', post };

    const deadline = Date.now() + 8000;
    let output = '';
    while (Date.now() < deadline) {
      await sleep(250);
      output = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      if (output.includes(poison['agentops.poison_id'])) break;
    }
    const leaked = output.match(/SECRET_[A-Z_]+/g) || [];
    return {
      status: leaked.length === 0 && output.includes(poison['agentops.poison_id']) ? 'passed' : 'failed',
      ok: leaked.length === 0 && output.includes(poison['agentops.poison_id']),
      poison_id: poison['agentops.poison_id'],
      leaked,
      safe_fields_present: {
        poison_id: output.includes(poison['agentops.poison_id']),
        operation: output.includes('gen_ai.operation.name'),
        model: output.includes('poison-model'),
        scrub_signal: output.includes('agentops.content_capture.signal')
      },
      log_bytes: Buffer.byteLength(output)
    };
  } finally {
    cleanup();
  }
}

function waitForHealthUrl(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const check = async () => {
      const health = await healthCheck(url, 1000);
      if (health.ok || Date.now() >= deadline) return resolve(health);
      setTimeout(check, 250);
    };
    check();
  });
}

async function status(options = {}) {
  const requestedMode = normalizeMode(options.mode || process.env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const privacy = normalizePrivacy(options.privacy || process.env.AGENTOPS_PRIVACY_MODE || 'strict');
  const auto = requestedMode === 'auto' ? resolveAutoMode() : { mode: requestedMode, reason: 'explicit mode' };
  const health = await healthCheck();
  const binary = findCollectorBinary();
  const pid = readPid();
  const runningBinary = requestedMode === 'auto' && health.ok ? findRunningBinaryCollector(binary.path) : null;
  const effectiveMode = auto.mode || (runningBinary ? 'binary' : requestedMode);
  const effectivePrivacy = runningBinary?.privacy || privacy;
  const config = runningBinary?.config || configPathFor(effectiveMode === 'binary' ? 'binary' : 'docker', effectivePrivacy);
  const discoveredPid = effectiveMode === 'binary'
    ? (runningBinary?.pid || (binary.path ? findManagedCollectorProcess(binary.path, config) : findCollectorProcessByConfig(config)))
    : null;
  const effectivePid = processAlive(pid) ? pid : discoveredPid;
  const dockerAvailable = dockerCliAvailable();
  const daemonAvailable = dockerDaemonAvailable();
  const details = [];

  if (requestedMode === 'auto') details.push(`auto: ${auto.reason}`);
  if (!binary.ok) details.push(binary.error);
  if (!dockerAvailable) details.push('Docker CLI not found.');
  else if (!daemonAvailable) details.push('Docker daemon is not reachable.');
  if (!composeHasLocalhostBindings()) details.push('Docker Compose host bindings are not localhost-only.');
  if (pid && !processAlive(pid) && discoveredPid) details.push(`Binary PID file was stale; found running collector PID ${discoveredPid}.`);
  if (pid && !processAlive(pid) && health.ok && !discoveredPid) details.push('Binary PID file is stale, but the collector health endpoint is responding.');

  return {
    mode: requestedMode,
    effectiveMode,
    running: health.ok,
    endpoint: otlpHttpEndpoint,
    healthUrl,
    safeLocalhostBinding: composeHasLocalhostBindings(),
    privacyMode: effectivePrivacy,
    config: fs.existsSync(config)
      ? config
      : null,
    docker: {
      cli: dockerAvailable,
      compose: dockerComposeAvailable(),
      daemon: daemonAvailable,
      composeFile,
      projectName: dockerProjectName
    },
    binary: {
      ...binary,
      pid: effectivePid || pid,
      pidFile: pidFile(),
      logFile: logFile(),
      running: Boolean(effectivePid),
      discoveredPid
    },
    health,
    details
  };
}

function resolveConnectionString(env = process.env) {
  if (env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    return { ok: true, value: env.APPLICATIONINSIGHTS_CONNECTION_STRING, source: 'APPLICATIONINSIGHTS_CONNECTION_STRING' };
  }

  const config = legacy.readAgentOpsConfig?.().values || {};
  const resourceGroup = env.AZURE_RESOURCE_GROUP || env.AGENTOPS_AZURE_RESOURCE_GROUP || config.resourceGroup || 'rg-agentops-dev';
  const app = env.APPLICATIONINSIGHTS_NAME || env.AGENTOPS_APPLICATIONINSIGHTS_NAME || config.appInsightsName || 'appi-agentops-dev';
  const args = ['monitor', 'app-insights', 'component', 'show', '--resource-group', resourceGroup, '--app', app, '--query', 'connectionString', '-o', 'tsv'];
  if (env.AZURE_SUBSCRIPTION_ID || env.AGENTOPS_AZURE_SUBSCRIPTION_ID || config.subscriptionId) {
    args.push('--subscription', env.AZURE_SUBSCRIPTION_ID || env.AGENTOPS_AZURE_SUBSCRIPTION_ID || config.subscriptionId);
  }

  const result = run('az', args, { timeout: 15000 });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || 'az monitor app-insights component show failed').trim()
    };
  }
  const value = String(result.stdout || '').trim();
  return value
    ? { ok: true, value, source: 'az monitor app-insights component show' }
    : { ok: false, error: 'Application Insights connection string lookup returned an empty value.' };
}

async function start(options = {}) {
  const mode = normalizeMode(options.mode || 'auto');
  const privacy = normalizePrivacy(options.privacy || 'strict');
  const resolved = mode === 'auto' ? resolveAutoMode() : { mode, reason: 'explicit mode' };

  if (mode === 'none' || resolved.mode === 'none') {
    if (!options.unsafeNoCollector) {
      return {
        ok: false,
        mode: 'none',
        unsafe: true,
        error: 'Collector mode none requires AGENTOPS_ALLOW_NO_COLLECTOR=1 or --unsafe-no-collector.'
      };
    }
    return {
      ok: true,
      mode: 'none',
      unsafe: true,
      warning: 'No local collector is running; privacy scrubbing is not guaranteed.'
    };
  }

  if (!resolved.mode) {
    const currentHealth = await healthCheck();
    if (currentHealth.ok) {
      return {
        ok: true,
        mode,
        privacyMode: privacy,
        alreadyRunning: true,
        health: currentHealth,
        warning: 'Collector health endpoint is already responding; no new collector runtime was started.'
      };
    }
    return { ok: false, mode, error: resolved.reason };
  }

  if (resolved.mode === 'docker') return startDocker({ privacy });
  if (resolved.mode === 'binary') return startBinary({ privacy });
  return { ok: false, mode, error: `Unsupported resolved collector mode: ${resolved.mode}` };
}

function startDocker({ privacy }) {
  const connection = resolveConnectionString();
  if (!connection.ok) return { ok: false, mode: 'docker', error: connection.error };
  if (!dockerDaemonAvailable()) return { ok: false, mode: 'docker', error: 'Docker daemon is not reachable.' };
  const result = run('docker', dockerComposeArgs(['up', '-d', '--force-recreate'], privacy), {
    env: {
      APPLICATIONINSIGHTS_CONNECTION_STRING: connection.value,
      AGENTOPS_PRIVACY_MODE: privacy
    },
    timeout: 60000
  });
  return {
    ok: result.status === 0,
    mode: 'docker',
    privacyMode: privacy,
    composeFile,
    projectName: dockerProjectName,
    error: result.status === 0 ? null : (result.stderr || result.stdout || `docker compose exited ${result.status}`).trim()
  };
}

async function startBinary({ privacy }) {
  const binary = findCollectorBinary();
  if (!binary.ok) return { ok: false, mode: 'binary', error: binary.error };
  const connection = resolveConnectionString();
  if (!connection.ok) return { ok: false, mode: 'binary', error: connection.error };
  const config = configPathFor('binary', privacy);
  if (!fs.existsSync(config)) return { ok: false, mode: 'binary', error: `Collector config not found: ${config}` };
  fs.mkdirSync(collectorHome, { recursive: true });
  const currentHealth = await healthCheck();
  const pid = readPid();
  const discoveredPid = findManagedCollectorProcess(binary.path, config);
  const runningPid = processAlive(pid) ? pid : discoveredPid;
  if (currentHealth.ok) {
    if (runningPid) fs.writeFileSync(pidFile(), `${runningPid}\n`);
    return {
      ok: true,
      mode: 'binary',
      privacyMode: privacy,
      alreadyRunning: true,
      pid: runningPid || null,
      pidFile: pidFile(),
      logFile: logFile(),
      config
    };
  }
  const out = fs.openSync(logFile(), 'a');
  const child = childProcess.spawn(binary.path, ['--config', config], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, APPLICATIONINSIGHTS_CONNECTION_STRING: connection.value }
  });
  child.unref();
  fs.writeFileSync(pidFile(), `${child.pid}\n`);
  const health = await waitForHealth();
  return {
    ok: health.ok,
    mode: 'binary',
    privacyMode: privacy,
    pid: child.pid,
    pidFile: pidFile(),
    logFile: logFile(),
    config,
    health,
    error: health.ok ? null : 'Collector process started, but health endpoint did not become ready.'
  };
}

function stop(options = {}) {
  const mode = normalizeMode(options.mode || process.env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const resolved = mode === 'auto' ? resolveAutoMode() : { mode };
  const target = resolved.mode || mode;
  if (target === 'docker') {
    const result = run('docker', dockerComposeArgs(['down'], options.privacy || 'strict'), { timeout: 60000 });
    return {
      ok: result.status === 0,
      mode: 'docker',
      error: result.status === 0 ? null : (result.stderr || result.stdout || `docker compose exited ${result.status}`).trim()
    };
  }
  if (target === 'binary') {
    const privacy = normalizePrivacy(options.privacy || process.env.AGENTOPS_PRIVACY_MODE || 'strict');
    const binary = findCollectorBinary();
    const config = configPathFor('binary', privacy);
    const pid = readPid();
    const discoveredPid = binary.ok ? findManagedCollectorProcess(binary.path, config) : null;
    const targetPid = processAlive(pid) ? pid : discoveredPid;
    if (!processAlive(targetPid)) return { ok: true, mode: 'binary', stopped: false, detail: 'No AgentOps collector PID is running.' };
    process.kill(targetPid, 'SIGTERM');
    fs.rmSync(pidFile(), { force: true });
    return { ok: true, mode: 'binary', stopped: true, pid: targetPid };
  }
  return { ok: true, mode: target, stopped: false, detail: 'No managed collector runtime selected.' };
}

function validate(options = {}) {
  const mode = normalizeMode(options.mode || 'auto');
  const privacy = normalizePrivacy(options.privacy || 'strict');
  const artifactValidation = validateCollectorArtifacts();
  const resolved = mode === 'auto' ? resolveAutoMode() : { mode, reason: 'explicit mode' };
  if (!resolved.mode) return { ok: false, skipped: true, mode, privacyMode: privacy, artifact_validation: artifactValidation, error: resolved.reason };
  if (resolved.mode === 'none') return { ok: false, skipped: true, mode: 'none', artifact_validation: artifactValidation, error: 'No collector config is validated in none mode.' };

  const config = configPathFor(resolved.mode, privacy);
  if (!fs.existsSync(config)) return { ok: false, mode: resolved.mode, privacyMode: privacy, config, artifact_validation: artifactValidation, error: `Config not found: ${config}` };

  if (resolved.mode === 'binary') {
    const binary = findCollectorBinary();
    if (!binary.ok) return { ok: false, skipped: true, mode: 'binary', privacyMode: privacy, config, artifact_validation: artifactValidation, error: binary.error };
    const result = run(binary.path, ['validate', '--config', config], { timeout: 30000 });
    return {
      ok: result.status === 0 && artifactValidation.ok,
      mode: 'binary',
      privacyMode: privacy,
      config,
      artifact_validation: artifactValidation,
      command: `${binary.path} validate --config ${config}`,
      error: result.status === 0 && artifactValidation.ok ? null : (artifactValidation.errors[0] || result.stderr || result.stdout || `collector validate exited ${result.status}`).trim()
    };
  }

  if (!dockerDaemonAvailable()) {
    return {
      ok: false,
      skipped: true,
      mode: 'docker',
      privacyMode: privacy,
      config,
      artifact_validation: artifactValidation,
      error: 'Docker daemon is not reachable; start Docker/OrbStack or use binary mode.'
    };
  }
  const image = process.env.AGENTOPS_OTELCOL_IMAGE || 'otel/opentelemetry-collector-contrib:0.151.0';
  const result = run('docker', [
    'run',
    '--rm',
    '-v',
    `${collectorDir}:/etc/agentops:ro`,
    image,
    'validate',
    '--config',
    `/etc/agentops/${path.basename(config)}`
  ], { timeout: 60000 });
  return {
    ok: result.status === 0 && artifactValidation.ok,
    mode: 'docker',
    privacyMode: privacy,
    config,
    image,
    artifact_validation: artifactValidation,
    error: result.status === 0 && artifactValidation.ok ? null : (artifactValidation.errors[0] || result.stderr || result.stdout || `docker validate exited ${result.status}`).trim()
  };
}

async function smoke(options = {}) {
  const privacy = normalizePrivacy(options.privacy || 'strict');
  const localPoison = options.poison === false ? null : poisonCheck();
  const currentStatus = await status({ mode: options.mode || 'auto', privacy });
  const runtime = options.poison === false ? null : await runtimePoisonSmoke({ privacy });
  return {
    ok: privacy === 'strict' ? Boolean(localPoison?.ok && runtime?.ok !== false) : true,
    privacyMode: privacy,
    poison: localPoison,
    runtime_validation: currentStatus.running
      ? { status: 'collector-running', health: currentStatus.health, debug_exporter: runtime }
      : {
          status: 'skipped',
          reason: 'No local collector runtime is reachable in this environment. Offline strict sanitizer poison check was run.',
          debug_exporter: runtime
        }
  };
}

module.exports = {
  composeFile,
  composeHasLocalhostBindings,
  configPathFor,
  collectorPackageInfo,
  defaultCollectorVersion,
  dockerComposeArgs,
  dockerProjectName,
  findCollectorBinary,
  healthCheck,
  installBinary,
  installedCollectorBinaryPath,
  normalizeMode,
  normalizePrivacy,
  parseChecksumFile,
  parseCollectorOptions,
  resolveAutoMode,
  resolveConnectionString,
  sha256File,
  smoke,
  start,
  status,
  stop,
  uninstallBinary,
  validate,
  validateBinaryConfig,
  validateCollectorArtifacts,
  verifyChecksum
};
