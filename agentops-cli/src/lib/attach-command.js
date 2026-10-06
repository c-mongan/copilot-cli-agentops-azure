const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { projectAgentOpsConfigPath, readAgentOpsConfig } = require('./agentops-config');

const MANIFEST_RELATIVE_PATH = '.agentops/attachment.json';
const RECEIPT_RELATIVE_PATH = '.agentops/.attachment-receipt.json';
const MAX_DISCOVERED_FILES = 5000;
const MAX_HASHED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_COVERAGE_RUNS = 500;
const MAX_COVERAGE_BYTES = 100 * 1024 * 1024;
const SKIP_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.venv', 'venv', '.tox', '.nox', '__pycache__',
  'node_modules', 'vendor', 'Pods', 'dist', 'build', 'out', 'target',
  'coverage', '.next', '.turbo', '.cache', '.mypy_cache', '.pytest_cache'
]);
const INSTRUMENTABLE_SCRIPT_EXTENSIONS = new Set([
  '.py', '.pyw', '.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx'
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseAttachArgs(args = []) {
  const repoIndex = args.indexOf('--repo');
  const repoEquals = args.find(value => value.startsWith('--repo='));
  const repo = repoEquals ? repoEquals.slice('--repo='.length) : repoIndex >= 0 ? args[repoIndex + 1] : null;
  return {
    repo,
    yes: args.includes('--yes'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h')
  };
}

function parseCoverageArgs(args = []) {
  const parsed = parseAttachArgs(args);
  return { ...parsed, help: parsed.help };
}

function gitRoot(repoPath) {
  const requested = path.resolve(repoPath || '.');
  const stat = fs.statSync(requested);
  if (!stat.isDirectory()) throw new Error(`--repo must be a directory: ${requested}`);
  const root = childProcess.execFileSync('git', ['-C', requested, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return fs.realpathSync.native(root);
}

function relativePath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function discoverArchitecture(root) {
  let discoveredFiles = 0;
  const descriptorCache = new Map();
  const skipped = { oversized: 0 };
  const skippedSymlinks = new Set();
  const fileDescriptor = absolutePath => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      skippedSymlinks.add(relativePath(root, absolutePath));
      return null;
    }
    if (!stat.isFile()) return null;
    const relative = relativePath(root, absolutePath);
    if (descriptorCache.has(relative)) return descriptorCache.get(relative);
    discoveredFiles += 1;
    if (discoveredFiles > MAX_DISCOVERED_FILES) {
      throw new Error(`architecture inventory exceeds the ${MAX_DISCOVERED_FILES} file safety limit`);
    }
    if (stat.size > MAX_HASHED_FILE_BYTES) {
      skipped.oversized += 1;
      const descriptor = { path: relative, sha256: null, coverage: 'file-too-large-to-hash' };
      descriptorCache.set(relative, descriptor);
      return descriptor;
    }
    const descriptor = { path: relative, sha256: sha256(fs.readFileSync(absolutePath)) };
    descriptorCache.set(relative, descriptor);
    return descriptor;
  };
  const filesUnder = (directory, excluded = new Set()) => {
    if (!fs.existsSync(directory)) return [];
    const directoryStat = fs.lstatSync(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return [];
    const results = [];
    const visit = current => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isSymbolicLink()) {
          skippedSymlinks.add(relativePath(root, absolutePath));
        } else if (entry.isDirectory()) {
          if (!SKIP_DIRECTORIES.has(entry.name)) visit(absolutePath);
        } else if (entry.isFile()) {
          if (excluded.has(absolutePath)) continue;
          const descriptor = fileDescriptor(absolutePath);
          if (descriptor) results.push(descriptor);
        }
      }
    };
    visit(directory);
    return results;
  };

  const agents = [];
  for (const directoryName of ['.github/agents', '.copilot/agents', '.agents/agents', 'agents', 'plugin/agents']) {
    const directory = path.join(root, directoryName);
    if (!fs.existsSync(directory)) continue;
    const directoryStat = fs.lstatSync(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      if (directoryStat.isSymbolicLink()) skippedSymlinks.add(relativePath(root, directory));
      continue;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const descriptor = fileDescriptor(path.join(directory, entry.name));
      if (descriptor) agents.push({ name: entry.name.replace(/(?:\.agent)?\.md$/i, ''), ...descriptor });
    }
  }

  const skills = [];
  const skillRootNames = ['.github/skills', '.agents/skills', '.copilot/skills', 'skills', 'plugin/skills'];
  for (const skillRootName of skillRootNames) {
    const skillRoot = path.join(root, skillRootName);
    if (!fs.existsSync(skillRoot)) continue;
    const skillRootStat = fs.lstatSync(skillRoot);
    if (skillRootStat.isSymbolicLink() || !skillRootStat.isDirectory()) {
      if (skillRootStat.isSymbolicLink()) skippedSymlinks.add(relativePath(root, skillRoot));
      continue;
    }
    const visitSkills = directory => {
      const skillFile = path.join(directory, 'SKILL.md');
      const skillStat = fs.existsSync(skillFile) ? fs.lstatSync(skillFile) : null;
      if (skillStat?.isSymbolicLink()) skippedSymlinks.add(relativePath(root, skillFile));
      if (skillStat?.isFile()) {
        const definition = fileDescriptor(skillFile);
        if (definition) {
          const files = filesUnder(directory, new Set([skillFile]));
          const paths = folderName => files.filter(file => file.path.startsWith(`${relativePath(root, path.join(directory, folderName))}/`));
          const categorizedPaths = new Set(['references', 'scripts', 'assets'].flatMap(folderName => paths(folderName).map(file => file.path)));
          skills.push({
            name: path.basename(directory),
            ...definition,
            references: paths('references'),
            scripts: paths('scripts'),
            assets: paths('assets'),
            otherFiles: files.filter(file => !categorizedPaths.has(file.path))
          });
        }
        return;
      }
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !SKIP_DIRECTORIES.has(entry.name)) visitSkills(path.join(directory, entry.name));
      }
    };
    for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !SKIP_DIRECTORIES.has(entry.name)) visitSkills(path.join(skillRoot, entry.name));
    }
  }

  const uniqueSkills = [...new Map(skills.map(skill => [skill.path, skill])).values()].sort((a, b) => a.path.localeCompare(b.path));
  const uniqueAgents = [...new Map(agents.map(agent => [agent.path, agent])).values()].sort((a, b) => a.path.localeCompare(b.path));
  const skillOwners = new Map();
  for (const skill of uniqueSkills) {
    for (const script of skill.scripts) {
      const owners = skillOwners.get(script.path) || [];
      owners.push(skill.name);
      skillOwners.set(script.path, owners);
    }
  }
  const runtimeScripts = [];
  const runtimeVisited = new Set();
  const visitRuntimeScripts = directory => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        skippedSymlinks.add(relativePath(root, absolutePath));
      } else if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) visitRuntimeScripts(absolutePath);
      } else if (entry.isFile() && INSTRUMENTABLE_SCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const descriptor = fileDescriptor(absolutePath);
        if (descriptor && !runtimeVisited.has(descriptor.path)) {
          runtimeVisited.add(descriptor.path);
          runtimeScripts.push({ ...descriptor, skillNames: skillOwners.get(descriptor.path) || [] });
        }
      }
    }
  };
  visitRuntimeScripts(root);
  runtimeScripts.sort((a, b) => a.path.localeCompare(b.path));
  return {
    agents: uniqueAgents,
    skills: uniqueSkills,
    runtimeScripts,
    coverage: {
      agents: uniqueAgents.length,
      skills: uniqueSkills.length,
      referenceFiles: uniqueSkills.reduce((sum, skill) => sum + skill.references.length, 0),
      scriptFiles: runtimeScripts.length,
      skillScriptFiles: uniqueSkills.reduce((sum, skill) => sum + skill.scripts.length, 0),
      instrumentableScriptFiles: runtimeScripts.filter(script => Boolean(script.sha256)).length,
      unhashableScriptFiles: runtimeScripts.filter(script => !script.sha256).length,
      oversizedFiles: skipped.oversized,
      skippedSymlinks: skippedSymlinks.size,
      executionObserved: false
    }
  };
}

function attachmentPaths(root) {
  const metadataDirectory = path.join(root, '.agentops');
  const stat = fs.existsSync(metadataDirectory) ? fs.lstatSync(metadataDirectory) : null;
  if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) {
    throw new Error('.agentops must be a real directory; refusing to write through a link or non-directory');
  }
  return {
    metadataDirectory,
    manifest: path.join(root, MANIFEST_RELATIVE_PATH),
    receipt: path.join(root, RECEIPT_RELATIVE_PATH)
  };
}

function readOwnedAttachment(root) {
  const paths = attachmentPaths(root);
  if (!fs.existsSync(paths.manifest) || !fs.existsSync(paths.receipt)) return { ok: false, error: 'no complete AgentOps attachment was found' };
  const manifestStat = fs.lstatSync(paths.manifest);
  const receiptStat = fs.lstatSync(paths.receipt);
  if (manifestStat.isSymbolicLink() || receiptStat.isSymbolicLink() || !manifestStat.isFile() || !receiptStat.isFile()) {
    return { ok: false, error: 'attachment files are not regular files; refusing to remove them' };
  }
  const manifestText = fs.readFileSync(paths.manifest, 'utf8');
  let manifest;
  let receipt;
  try {
    manifest = JSON.parse(manifestText);
    receipt = JSON.parse(fs.readFileSync(paths.receipt, 'utf8'));
  } catch {
    return { ok: false, error: 'attachment manifest or ownership receipt is not valid JSON' };
  }
  if (manifest.managedBy !== 'copilot-agentops' || manifest.schemaVersion !== 1
    || receipt.managedBy !== 'copilot-agentops' || receipt.schemaVersion !== 1
    || receipt.manifestSha256 !== sha256(manifestText)) {
    return { ok: false, error: 'attachment files changed or are not owned by this AgentOps version; preserving them' };
  }
  return { ok: true, paths, manifest, receipt };
}

function attachmentManifest(root) {
  const architecture = discoverArchitecture(root);
  return {
    managedBy: 'copilot-agentops',
    schemaVersion: 1,
    attachedAt: new Date().toISOString(),
    repository: {
      name: path.basename(root),
      rootHash: sha256(root).slice(0, 16)
    },
    observation: {
      activation: 'explicit-process-only',
      hooksInstalled: false,
      nativeOtel: 'inactive-until-explicit-agentops-copilot-launch',
      contentCapture: 'off-by-default',
      scriptsInstrumented: false,
      scriptInstrumentation: {
        python: 'process-scoped root spans for unchanged inventoried repository .py/.pyw files; standard-library OTLP fallback requires no package install, with the OpenTelemetry SDK used when already available',
        node: 'process-scoped root spans for unchanged inventoried repository JavaScript/TypeScript files; named steps use instrumentation/node/agentops-script.cjs',
        typescript: 'process-scoped root spans for unchanged inventoried repository TypeScript files when the selected runtime supports execution; loader compatibility must be verified'
      }
    },
    architecture
  };
}

function writeAttachment(root, manifest) {
  const paths = attachmentPaths(root);
  if (fs.existsSync(paths.manifest) || fs.existsSync(paths.receipt)) {
    const existing = readOwnedAttachment(root);
    if (existing.ok) return { alreadyAttached: true, ...paths };
    throw new Error('AgentOps attachment path already exists and is not fully owned by this command; no files were changed');
  }
  fs.mkdirSync(paths.metadataDirectory, { recursive: true, mode: 0o700 });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const receiptText = `${JSON.stringify({ managedBy: 'copilot-agentops', schemaVersion: 1, manifestSha256: sha256(manifestText) }, null, 2)}\n`;
  let manifestCreated = false;
  try {
    fs.writeFileSync(paths.manifest, manifestText, { flag: 'wx', mode: 0o600 });
    manifestCreated = true;
    fs.writeFileSync(paths.receipt, receiptText, { flag: 'wx', mode: 0o600 });
    return { alreadyAttached: false, ...paths };
  } catch (error) {
    if (manifestCreated && !fs.existsSync(paths.receipt)) fs.unlinkSync(paths.manifest);
    try { fs.rmdirSync(paths.metadataDirectory); } catch {}
    throw error;
  }
}

function detachAttachment(root, yes) {
  const owned = readOwnedAttachment(root);
  if (!owned.ok) return { ok: false, action: 'detach', repo: root, error: owned.error, changed: false };
  const files = [relativePath(root, owned.paths.manifest), relativePath(root, owned.paths.receipt)];
  if (!yes) return { ok: true, action: 'detach', repo: root, files, preview: true, changed: false };
  fs.unlinkSync(owned.paths.manifest);
  fs.unlinkSync(owned.paths.receipt);
  try { fs.rmdirSync(owned.paths.metadataDirectory); } catch {}
  return { ok: true, action: 'detach', repo: root, files, preview: false, changed: true };
}

function attachCommand(args = [], dependencies = {}) {
  const options = parseAttachArgs(args);
  const stdout = dependencies.stdout || process.stdout;
  if (options.help) {
    stdout.write('agentops attach --repo <git-repo> [--yes] [--json]\n');
    stdout.write('Preview is read-only. It inventories agent/skill files and Python/JavaScript/TypeScript scripts across the repo without copying contents. --yes writes only .agentops/attachment.json and its ownership receipt; no hooks or telemetry are activated.\n');
    return { ok: true, action: 'help' };
  }
  if (!options.repo) throw new Error('attach requires --repo <path>');
  const root = gitRoot(options.repo);
  const manifest = attachmentManifest(root);
  const paths = attachmentPaths(root);
  let result;
  if (fs.existsSync(paths.manifest) || fs.existsSync(paths.receipt)) {
    const existing = readOwnedAttachment(root);
    if (existing.ok) result = { ok: true, action: 'attach', repo: root, preview: !options.yes, already_attached: true, changed: false, manifest: MANIFEST_RELATIVE_PATH, coverage: existing.manifest.architecture.coverage, next: 'Start a fresh observed process with agentops copilot-session launch --repo . -- --agent <agent-name>, then check agentops coverage --repo . --json. Plain copilot remains unchanged.' };
    else throw new Error('AgentOps attachment path already exists and is not fully owned by this command; no files were changed');
  } else {
    if (options.yes) {
      const written = writeAttachment(root, manifest);
      result = { ok: true, action: 'attach', repo: root, preview: false, already_attached: written.alreadyAttached, changed: !written.alreadyAttached, manifest: MANIFEST_RELATIVE_PATH, coverage: manifest.architecture.coverage, next: 'Start a fresh observed process with agentops copilot-session launch --repo . -- --agent <agent-name>, then check agentops coverage --repo . --json. Plain copilot remains unchanged.' };
    } else {
      result = { ok: true, action: 'attach', repo: root, preview: true, already_attached: false, changed: false, would_write: [MANIFEST_RELATIVE_PATH, RECEIPT_RELATIVE_PATH], coverage: manifest.architecture.coverage, next: 'Review the discovered architecture, then rerun with --yes to save the project-local inventory.' };
    }
  }
  if (options.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else stdout.write(renderAttachResult(result));
  return result;
}

function renderAttachResult(result) {
  if (result.action === 'detach') {
    if (!result.ok) return `AgentOps detach stopped: ${result.error}\n`;
    return `${result.preview ? 'Detach preview' : 'Detached'}: ${result.repo}\nFiles: ${(result.files || []).join(', ')}\n`;
  }
  const state = result.already_attached ? 'already attached' : result.preview ? 'preview only' : 'attached';
  return [
    `AgentOps ${state}: ${result.repo}`,
    `Declared components: ${result.coverage?.agents || 0} agents · ${result.coverage?.skills || 0} skills · ${result.coverage?.referenceFiles || 0} references · ${result.coverage?.scriptFiles || 0} scripts`,
    `Script tracing eligibility: ${result.coverage?.instrumentableScriptFiles || 0}/${result.coverage?.scriptFiles || 0} hash-scoped Python/JavaScript/TypeScript files${result.coverage?.unhashableScriptFiles ? ` · ${result.coverage.unhashableScriptFiles} too large to hash` : ''}`,
    `Observed execution: ${result.coverage?.executionObserved ? 'yes' : 'no; discovery does not prove use'}`,
    ...(result.would_write ? [`Would write: ${result.would_write.join(', ')}`] : []),
    result.next
  ].filter(Boolean).join('\n') + '\n';
}

function readJsonlRows(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 20 * 1024 * 1024) return { rows: [], invalid: 1 };
    const result = { rows: [], invalid: 0 };
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        if (row && typeof row === 'object' && !Array.isArray(row)) result.rows.push(row);
        else result.invalid += 1;
      } catch {
        result.invalid += 1;
      }
    }
    return result;
  } catch (error) {
    return { rows: [], invalid: error.code === 'ENOENT' ? 0 : 1 };
  }
}

function observedCoverage(root, architecture, options = {}) {
  const runsDirectory = path.join(options.agentopsHome || require('./paths').agentopsHome, 'runs');
  const rootHash = sha256(fs.realpathSync.native(root)).slice(0, 16);
  const observed = { agents: new Set(), skills: new Set(), referenceFiles: new Set(), scriptFiles: new Set() };
  let associatedRuns = 0;
  let unassociatedRuns = 0;
  let priorAttachmentRuns = 0;
  let scannedRuns = 0;
  let scannedBytes = 0;
  let scanTruncated = false;
  let invalidEvidenceRows = 0;
  const attachment = readOwnedAttachment(root);
  try {
    const directoryStat = fs.lstatSync(runsDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('unsafe runs directory');
    for (const entry of fs.readdirSync(runsDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_.:-]{1,128}$/.test(entry.name)) continue;
      scannedRuns += 1;
      if (scannedRuns > MAX_COVERAGE_RUNS) {
        scanTruncated = true;
        break;
      }
      const runDirectory = path.join(runsDirectory, entry.name);
      const contextPath = path.join(runDirectory, 'run-context.json');
      let context;
      try {
        const stat = fs.lstatSync(contextPath);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024) continue;
        context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
      } catch {
        unassociatedRuns += 1;
        continue;
      }
      if (context.managedBy !== 'copilot-agentops' || context.schemaVersion !== 1
        || context.runId !== entry.name || !/^[a-f0-9]{16}$/.test(context.repositoryRootHash || '')) continue;
      if (context.repositoryRootHash !== rootHash) continue;
      if (!attachment.ok || context.attachmentManifestSha256 !== attachment.receipt.manifestSha256) {
        priorAttachmentRuns += 1;
        continue;
      }
      associatedRuns += 1;
      const eventsPath = path.join(runDirectory, 'AgentOpsEvents_CL.jsonl');
      const spansPath = path.join(runDirectory, 'AgentOpsSpans_CL.jsonl');
      const evidencePaths = [eventsPath, spansPath];
      const evidenceSizes = evidencePaths.map(file => {
        try {
          const stat = fs.lstatSync(file);
          return stat.isSymbolicLink() || !stat.isFile() ? 0 : stat.size;
        } catch {
          return 0;
        }
      });
      if (evidenceSizes.some(size => size > 20 * 1024 * 1024)
        || scannedBytes + evidenceSizes.reduce((sum, size) => sum + size, 0) > MAX_COVERAGE_BYTES) {
        scanTruncated = true;
        associatedRuns -= 1;
        continue;
      }
      scannedBytes += evidenceSizes.reduce((sum, size) => sum + size, 0);
      const eventEvidence = readJsonlRows(eventsPath);
      const spanEvidence = readJsonlRows(spansPath);
      invalidEvidenceRows += eventEvidence.invalid + spanEvidence.invalid;
      for (const row of eventEvidence.rows) {
        if (row.AgentName) observed.agents.add(row.AgentName);
        if (row.SubAgentName) observed.agents.add(row.SubAgentName);
        if (row.SkillName) observed.skills.add(row.SkillName);
        if (row.ReferenceName) observed.referenceFiles.add(row.ReferenceName);
      }
      for (const row of spanEvidence.rows) {
        if (row.ScriptName) observed.scriptFiles.add(row.ScriptName);
      }
    }
  } catch {}

  const declared = {
    agents: architecture.agents.map(item => item.name),
    skills: architecture.skills.map(item => item.name),
    referenceFiles: architecture.skills.flatMap(skill => skill.references.map(item => item.path)),
    scriptFiles: architecture.runtimeScripts.map(item => item.path)
  };
  const categories = {};
  for (const [key, items] of Object.entries(declared)) {
    const matched = [...observed[key]].filter(value => items.includes(value)).sort();
    categories[key] = {
      declared: items.length,
      observed: matched.length,
      notObserved: Math.max(0, items.length - matched.length),
      observedItems: matched
    };
  }
  return {
    state: associatedRuns ? 'runtime-evidence-found' : 'runtime-evidence-not-found',
    associatedRuns,
    unassociatedHistoricalRuns: unassociatedRuns,
    priorAttachmentRuns,
    scanTruncated,
    invalidEvidenceRows,
    evidenceScanComplete: !scanTruncated && invalidEvidenceRows === 0,
    executionObserved: associatedRuns > 0 && Object.values(categories).some(category => category.observed > 0),
    categories,
    note: invalidEvidenceRows
      ? 'Some local evidence rows were malformed or unreadable; coverage is incomplete. Not observed does not mean unused.'
      : scanTruncated
      ? 'The bounded local scan was truncated; observed counts may be incomplete. Not observed does not mean unused.'
      : associatedRuns
        ? 'Observed means a matching local run export contains this inventoried name. Not observed does not mean unused.'
        : 'No repository-associated run exports were found. Static inventory does not prove runtime use.'
  };
}

function coverageCommand(args = [], dependencies = {}) {
  const options = parseCoverageArgs(args);
  const stdout = dependencies.stdout || process.stdout;
  if (options.help) {
    stdout.write('agentops coverage --repo <git-repo> [--json]\n');
    stdout.write('Read-only comparison of the attached inventory with locally retained, explicitly associated run exports.\n');
    return { ok: true, action: 'help' };
  }
  if (!options.repo) throw new Error('coverage requires --repo <path>');
  const root = gitRoot(options.repo);
  const owned = readOwnedAttachment(root);
  if (!owned.ok) throw new Error(`coverage requires a valid AgentOps attachment: ${owned.error}`);
  const architecture = discoverArchitecture(root);
  const inventoryMatchesAttachment = sha256(JSON.stringify(architecture))
    === sha256(JSON.stringify(owned.manifest.architecture));
  const configPath = projectAgentOpsConfigPath({ cwd: root, agentOpsHome: dependencies.agentopsHome });
  const projectConfig = readAgentOpsConfig({ configPath, quiet: true }).values;
  const runtime = observedCoverage(root, architecture, dependencies);
  const result = {
    ok: true,
    action: 'coverage',
    repo: root,
    attachedAt: owned.manifest.attachedAt,
    currentInventory: architecture.coverage,
    inventoryMatchesAttachment,
    runtime,
    runtimeProfile: scriptRuntimeProfile(architecture, runtime, projectConfig)
  };
  if (options.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else stdout.write(renderCoverageResult(result));
  return result;
}

function scriptRuntimeProfile(architecture, runtime, projectConfig = {}) {
  const groups = {
    python: { extensions: new Set(['.py', '.pyw']), runtime: projectConfig.pythonRuntime || null },
    javascript: { extensions: new Set(['.js', '.cjs', '.mjs']), runtime: projectConfig.nodeRuntime || null },
    typescript: {
      extensions: new Set(['.ts', '.cts', '.mts', '.tsx']),
      runtime: projectConfig.nodeRuntime || null,
      loader: projectConfig.typescriptLoader || null
    },
    jsx: { extensions: new Set(['.jsx']), runtime: projectConfig.nodeRuntime || null }
  };
  const observedItems = new Set(runtime.categories.scriptFiles.observedItems);
  return Object.fromEntries(Object.entries(groups).map(([name, group]) => {
    const scripts = architecture.runtimeScripts.filter(script => group.extensions.has(path.extname(script.path).toLowerCase()));
    const declaredPaths = scripts.map(script => script.path);
    const observed = declaredPaths.filter(scriptPath => observedItems.has(scriptPath)).sort();
    const notObserved = declaredPaths.filter(scriptPath => !observedItems.has(scriptPath)).sort();
    let state = 'not-applicable';
    if (scripts.length > 0) {
      if (observed.length === 0) state = group.runtime ? 'declared-not-yet-observed' : 'runtime-not-declared';
      else if (observed.length < scripts.length) state = 'partially-observed';
      else state = 'scripts-observed-runtime-unverified';
    }
    return [name, {
      runtime: group.runtime,
      runtimeVerification: group.runtime ? 'declared-unverified' : 'not-declared',
      ...(name === 'typescript' ? { loader: group.loader } : {}),
      ...(name === 'typescript' ? {
        loaderVerification: !group.loader ? 'not-declared' : group.loader === 'unknown' ? 'unknown' : 'declared-unverified'
      } : {}),
      declaredScripts: scripts.length,
      observedScripts: observed.length,
      notObservedScripts: notObserved.length,
      observedItems: observed,
      notObservedItems: notObserved,
      state
    }];
  }));
}

function renderCoverageResult(result) {
  const runtime = result.runtime;
  const lines = [
    `AgentOps coverage: ${result.repo}`,
    `Current inventory: ${result.currentInventory.agents} agents · ${result.currentInventory.skills} skills · ${result.currentInventory.referenceFiles} references · ${result.currentInventory.scriptFiles} scripts`,
    `Inventory matches attached snapshot: ${result.inventoryMatchesAttachment ? 'yes' : 'no; runtime names may describe an earlier version'}`,
    `Associated local runs: ${runtime.associatedRuns} · runtime evidence: ${runtime.state}`,
    ...Object.entries(runtime.categories).map(([name, coverage]) => `${name}: ${coverage.observed}/${coverage.declared} observed · ${coverage.notObserved} not observed`),
    ...Object.entries(result.runtimeProfile || {}).map(([name, profile]) => `${name} scripts: ${profile.observedScripts}/${profile.declaredScripts} observed · runtime=${profile.runtime || 'not declared'} (${profile.runtimeVerification})${name === 'typescript' ? ` · loader=${profile.loader || 'not declared'} (${profile.loaderVerification})` : ''} · ${profile.state}`),
    runtime.note
  ];
  return `${lines.join('\n')}\n`;
}

function detachCommand(args = [], dependencies = {}) {
  const options = parseAttachArgs(args);
  const stdout = dependencies.stdout || process.stdout;
  if (options.help) {
    stdout.write('agentops detach --repo <git-repo> [--yes] [--json]\n');
    stdout.write('Preview is read-only. --yes removes only unchanged AgentOps-owned attachment files.\n');
    return { ok: true, action: 'help' };
  }
  if (!options.repo) throw new Error('detach requires --repo <path>');
  const result = detachAttachment(gitRoot(options.repo), options.yes);
  if (options.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else stdout.write(renderAttachResult(result));
  if (!result.ok) process.exitCode = 1;
  return result;
}

module.exports = {
  MANIFEST_RELATIVE_PATH,
  RECEIPT_RELATIVE_PATH,
  attachCommand,
  attachmentManifest,
  detachAttachment,
  detachCommand,
  coverageCommand,
  discoverArchitecture,
  gitRoot,
  parseAttachArgs,
  parseCoverageArgs,
  readOwnedAttachment,
  renderAttachResult,
  renderCoverageResult,
  scriptRuntimeProfile,
  observedCoverage,
  sha256,
  writeAttachment
};
