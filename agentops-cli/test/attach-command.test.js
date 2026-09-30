const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  attachCommand,
  coverageCommand,
  detachAttachment,
  discoverArchitecture,
  MANIFEST_RELATIVE_PATH,
  RECEIPT_RELATIVE_PATH
} = require('../src/lib/attach-command');
const { agentopsConfigure } = require('../src/lib/agentops-config');

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-attach-test-'));
  childProcess.execFileSync('git', ['init', '-q', root]);
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'agents', 'reviewer.agent.md'), 'agent fixture without prompt capture');
  fs.writeFileSync(path.join(root, '.github', 'agents', 'legacy-format.md'), 'legacy agent fixture');
  const skillRoot = path.join(root, '.github', 'skills', 'build-check');
  fs.mkdirSync(path.join(skillRoot, 'references'), { recursive: true });
  fs.mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), 'skill fixture');
  fs.writeFileSync(path.join(skillRoot, 'references', 'guide.md'), 'reference fixture');
  fs.writeFileSync(path.join(skillRoot, 'scripts', 'check.py'), 'print("synthetic")');
  fs.writeFileSync(path.join(skillRoot, 'config.json'), '{"fixture":"skill support file"}');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'worker.ts'), 'export const worker = true;');
  fs.mkdirSync(path.join(root, 'node_modules', 'dependency'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'dependency', 'index.js'), 'module.exports = true;');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'generated.py'), 'print("generated")');
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('architecture discovery finds agents, skills, references, and scripts without copying their contents', () => {
  const root = fixtureRepo();
  try {
    const architecture = discoverArchitecture(root);
    assert.equal(architecture.coverage.agents, 2);
    assert.equal(architecture.coverage.skills, 1);
    assert.equal(architecture.coverage.referenceFiles, 1);
    assert.equal(architecture.coverage.scriptFiles, 2);
    assert.equal(architecture.coverage.skillScriptFiles, 1);
    assert.equal(architecture.coverage.instrumentableScriptFiles, 2);
    assert.equal(architecture.runtimeScripts.length, 2);
    assert.deepEqual(architecture.runtimeScripts.map(script => script.path), [
      '.github/skills/build-check/scripts/check.py',
      'src/worker.ts'
    ]);
    assert.deepEqual(architecture.runtimeScripts[0].skillNames, ['build-check']);
    assert.deepEqual(architecture.runtimeScripts[1].skillNames, []);
    assert.equal(architecture.runtimeScripts.some(script => /node_modules|dist/.test(script.path)), false);
    assert.equal(architecture.coverage.executionObserved, false);
    assert.equal(architecture.skills[0].references[0].path, '.github/skills/build-check/references/guide.md');
    assert.equal(architecture.skills[0].scripts[0].path, '.github/skills/build-check/scripts/check.py');
    assert.equal(architecture.skills[0].otherFiles[0].path, '.github/skills/build-check/config.json');
    const serialized = JSON.stringify(architecture);
    assert.doesNotMatch(serialized, /reference fixture|print\("synthetic"\)|skill support file/);
    assert.match(serialized, /sha256/);
  } finally {
    cleanup(root);
  }
});

test('attach defaults to a no-write preview and writes only its two local files after explicit apply', () => {
  const root = fixtureRepo();
  try {
    const preview = attachCommand(['--repo', root, '--json'], { stdout: { write() {} } });
    assert.equal(preview.preview, true);
    assert.equal(preview.changed, false);
    assert.equal(fs.existsSync(path.join(root, '.agentops')), false);

    const applied = attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    assert.equal(applied.changed, true);
    assert.equal(fs.statSync(path.join(root, MANIFEST_RELATIVE_PATH)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(root, RECEIPT_RELATIVE_PATH)).mode & 0o777, 0o600);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_RELATIVE_PATH), 'utf8'));
    assert.equal(manifest.observation.hooksInstalled, false);
    assert.equal(manifest.observation.nativeOtel, 'inactive-until-explicit-agentops-copilot-launch');
    assert.equal(manifest.observation.scriptsInstrumented, false);
    assert.match(manifest.observation.scriptInstrumentation.python, /process-scoped root spans/);
    assert.match(manifest.observation.scriptInstrumentation.python, /standard-library OTLP fallback requires no package install/);
    assert.match(manifest.observation.scriptInstrumentation.node, /process-scoped root spans/);
    assert.equal(manifest.architecture.runtimeScripts.length, 2);
    assert.equal(fs.existsSync(path.join(root, '.github', 'hooks')), false);
    assert.match(applied.next, /copilot-session launch --repo \. -- --agent/);
    assert.match(applied.next, /agentops coverage --repo \. --json/);
    assert.match(applied.next, /Plain copilot remains unchanged/);
    assert.doesNotMatch(applied.next, /agentops copilot \.\.\./);
    const repeated = attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    assert.equal(repeated.already_attached, true);
    assert.equal(repeated.changed, false);
  } finally {
    cleanup(root);
  }
});

test('detach preview and apply remove only unchanged AgentOps-owned files', () => {
  const root = fixtureRepo();
  try {
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const userFile = path.join(root, '.agentops', 'user-data.json');
    fs.writeFileSync(userFile, '{"keep":true}');
    const preview = detachAttachment(root, false);
    assert.equal(preview.ok, true);
    assert.equal(preview.preview, true);
    assert.equal(fs.existsSync(path.join(root, MANIFEST_RELATIVE_PATH)), true);

    const removed = detachAttachment(root, true);
    assert.equal(removed.changed, true);
    assert.equal(fs.existsSync(path.join(root, MANIFEST_RELATIVE_PATH)), false);
    assert.equal(fs.existsSync(path.join(root, RECEIPT_RELATIVE_PATH)), false);
    assert.equal(fs.readFileSync(userFile, 'utf8'), '{"keep":true}');
  } finally {
    cleanup(root);
  }
});

test('detach preserves an attachment that a user changed after attach', () => {
  const root = fixtureRepo();
  try {
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const manifest = path.join(root, MANIFEST_RELATIVE_PATH);
    fs.appendFileSync(manifest, '\n');
    const result = detachAttachment(root, true);
    assert.equal(result.ok, false);
    assert.match(result.error, /changed|owned/);
    assert.equal(fs.existsSync(manifest), true);
    assert.equal(fs.existsSync(path.join(root, RECEIPT_RELATIVE_PATH)), true);
  } finally {
    cleanup(root);
  }
});

test('two repositories keep independent attachment and detach receipts', () => {
  const first = fixtureRepo();
  const second = fixtureRepo();
  try {
    const firstAttach = attachCommand(['--repo', first, '--yes', '--json'], { stdout: { write() {} } });
    const secondAttach = attachCommand(['--repo', second, '--yes', '--json'], { stdout: { write() {} } });
    assert.equal(firstAttach.changed, true);
    assert.equal(secondAttach.changed, true);
    const firstManifest = path.join(first, MANIFEST_RELATIVE_PATH);
    const secondManifest = path.join(second, MANIFEST_RELATIVE_PATH);
    assert.notEqual(fs.readFileSync(firstManifest, 'utf8'), fs.readFileSync(secondManifest, 'utf8'));

    const firstDetached = detachAttachment(first, true);
    assert.equal(firstDetached.changed, true);
    assert.equal(fs.existsSync(firstManifest), false);
    assert.equal(fs.existsSync(secondManifest), true);
    const secondDetached = detachAttachment(second, true);
    assert.equal(secondDetached.changed, true);
    assert.equal(fs.existsSync(secondManifest), false);
  } finally {
    cleanup(first);
    cleanup(second);
  }
});

test('coverage joins only matching repository run exports and labels unobserved inventory honestly', () => {
  const root = fixtureRepo();
  const agentopsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-coverage-home-'));
  try {
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const other = path.join(agentopsHome, 'runs', 'run_other_repo');
    const matching = path.join(agentopsHome, 'runs', 'run_this_repo');
    for (const directory of [other, matching]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const rootHash = require('../src/lib/attach-command').sha256(fs.realpathSync(root)).slice(0, 16);
    const manifestText = fs.readFileSync(path.join(root, MANIFEST_RELATIVE_PATH), 'utf8');
    const manifestHash = require('../src/lib/attach-command').sha256(manifestText);
    fs.writeFileSync(path.join(other, 'run-context.json'), JSON.stringify({
      managedBy: 'copilot-agentops', schemaVersion: 1, runId: 'run_other_repo', repositoryRootHash: '0'.repeat(16)
    }), { mode: 0o600 });
    const priorAttachment = path.join(agentopsHome, 'runs', 'run_prior_attachment');
    fs.mkdirSync(priorAttachment, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(priorAttachment, 'run-context.json'), JSON.stringify({
      managedBy: 'copilot-agentops', schemaVersion: 1, runId: 'run_prior_attachment', repositoryRootHash: rootHash,
      attachmentManifestSha256: 'f'.repeat(64)
    }), { mode: 0o600 });
    fs.writeFileSync(path.join(matching, 'run-context.json'), JSON.stringify({
      managedBy: 'copilot-agentops', schemaVersion: 1, runId: 'run_this_repo', repositoryRootHash: rootHash,
      attachmentManifestSha256: manifestHash
    }), { mode: 0o600 });
    fs.writeFileSync(path.join(matching, 'AgentOpsEvents_CL.jsonl'), [
      { AgentName: 'reviewer', SkillName: 'build-check', ReferenceName: '.github/skills/build-check/references/guide.md' },
      { AgentName: 'unlisted-agent', SkillName: 'unlisted-skill', ReferenceName: '../outside.md' }
    ].map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(matching, 'AgentOpsSpans_CL.jsonl'), `${JSON.stringify({ ScriptName: '.github/skills/build-check/scripts/check.py' })}\n`, { mode: 0o600 });

    const result = coverageCommand(['--repo', root, '--json'], { agentopsHome, stdout: { write() {} } });
    assert.equal(result.runtime.associatedRuns, 1);
    assert.equal(result.runtime.priorAttachmentRuns, 1);
    assert.equal(result.runtime.executionObserved, true);
    assert.equal(result.runtime.categories.skills.observed, 1);
    assert.equal(result.runtime.categories.referenceFiles.observed, 1);
    assert.equal(result.runtime.categories.scriptFiles.observed, 1);
    assert.equal(result.runtime.categories.agents.observed, 1);
    assert.match(result.runtime.note, /Not observed does not mean unused/);
    assert.deepEqual(result.runtime.categories.scriptFiles.observedItems, ['.github/skills/build-check/scripts/check.py']);
    assert.equal(result.inventoryMatchesAttachment, true);
  } finally {
    cleanup(root);
    fs.rmSync(agentopsHome, { recursive: true, force: true });
  }
});

test('coverage requires a valid attachment and reports no runtime evidence without associated exports', () => {
  const root = fixtureRepo();
  const agentopsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-coverage-empty-'));
  try {
    assert.throws(() => coverageCommand(['--repo', root, '--json'], { agentopsHome, stdout: { write() {} } }), /requires a valid AgentOps attachment/);
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const result = coverageCommand(['--repo', root, '--json'], { agentopsHome, stdout: { write() {} } });
    assert.equal(result.runtime.state, 'runtime-evidence-not-found');
    assert.equal(result.runtime.executionObserved, false);
    assert.match(result.runtime.note, /Static inventory does not prove runtime use/);
  } finally {
    cleanup(root);
    fs.rmSync(agentopsHome, { recursive: true, force: true });
  }
});

test('coverage connects private runtime interview labels to observed scripts and loader gaps', () => {
  const root = fixtureRepo();
  const agentopsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-coverage-runtime-profile-'));
  try {
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const config = agentopsConfigure({
      subcommand: 'set', scope: 'project', cwd: root, agentOpsHome: agentopsHome,
      values: { pythonRuntime: 'python3.12', nodeRuntime: 'node22.23', typescriptLoader: 'unknown' }
    });
    assert.equal(fs.statSync(config.path).mode & 0o777, 0o600);

    const first = coverageCommand(['--repo', root, '--json'], { agentopsHome, stdout: { write() {} } });
    assert.equal(first.runtimeProfile.python.runtime, 'python3.12');
    assert.equal(first.runtimeProfile.python.runtimeVerification, 'declared-unverified');
    assert.equal(first.runtimeProfile.python.declaredScripts, 1);
    assert.equal(first.runtimeProfile.python.state, 'declared-not-yet-observed');
    assert.equal(first.runtimeProfile.typescript.loader, 'unknown');
    assert.equal(first.runtimeProfile.typescript.loaderVerification, 'unknown');
    assert.equal(first.runtimeProfile.typescript.observedScripts, 0);

    const run = path.join(agentopsHome, 'runs', 'runtime-profile-run');
    fs.mkdirSync(run, { recursive: true, mode: 0o700 });
    const manifestText = fs.readFileSync(path.join(root, MANIFEST_RELATIVE_PATH), 'utf8');
    const rootHash = require('../src/lib/attach-command').sha256(fs.realpathSync(root)).slice(0, 16);
    fs.writeFileSync(path.join(run, 'run-context.json'), JSON.stringify({
      managedBy: 'copilot-agentops', schemaVersion: 1, runId: 'runtime-profile-run', repositoryRootHash: rootHash,
      attachmentManifestSha256: require('../src/lib/attach-command').sha256(manifestText)
    }), { mode: 0o600 });
    fs.writeFileSync(path.join(run, 'AgentOpsEvents_CL.jsonl'), '');
    fs.writeFileSync(path.join(run, 'AgentOpsSpans_CL.jsonl'), [
      { ScriptName: '.github/skills/build-check/scripts/check.py' },
      { ScriptName: 'src/worker.ts' }
    ].map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });

    const observedUnknown = coverageCommand(['--repo', root, '--json'], { agentopsHome, stdout: { write() {} } });
    assert.equal(observedUnknown.runtimeProfile.python.observedScripts, 1);
    assert.equal(observedUnknown.runtimeProfile.python.state, 'scripts-observed-runtime-unverified');
    assert.equal(observedUnknown.runtimeProfile.typescript.observedScripts, 1);
    assert.equal(observedUnknown.runtimeProfile.typescript.state, 'scripts-observed-runtime-unverified');
    assert.equal(observedUnknown.runtimeProfile.typescript.loaderVerification, 'unknown');
    assert.deepEqual(observedUnknown.runtimeProfile.typescript.observedItems, ['src/worker.ts']);

    agentopsConfigure({
      subcommand: 'set', scope: 'project', cwd: root, agentOpsHome: agentopsHome,
      values: { typescriptLoader: 'tsx4.23' }
    });
    const observed = coverageCommand(['--repo', root, '--json'], { agentopsHome, stdout: { write() {} } });
    assert.equal(observed.runtimeProfile.typescript.loader, 'tsx4.23');
    assert.equal(observed.runtimeProfile.typescript.loaderVerification, 'declared-unverified');
    assert.equal(observed.runtimeProfile.typescript.state, 'scripts-observed-runtime-unverified');
  } finally {
    cleanup(root);
    fs.rmSync(agentopsHome, { recursive: true, force: true });
  }
});

test('coverage flags when the current architecture differs from the attached inventory', () => {
  const root = fixtureRepo();
  const agentopsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-coverage-drift-'));
  try {
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    fs.writeFileSync(path.join(root, '.github', 'skills', 'build-check', 'scripts', 'check.py'), 'print("changed")');
    const result = coverageCommand(['--repo', root, '--json'], { agentopsHome, stdout: { write() {} } });
    assert.equal(result.inventoryMatchesAttachment, false);
    assert.equal(result.runtime.executionObserved, false);
  } finally {
    cleanup(root);
    fs.rmSync(agentopsHome, { recursive: true, force: true });
  }
});
