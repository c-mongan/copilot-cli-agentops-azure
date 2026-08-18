const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { optionValue } = require('../src/lib/cli-options');
const { createSetupInit } = require('../src/lib/setup-init');
const { usage: legacyUsage } = require('../src/lib/usage');
const { usage: surfaceUsage } = require('../src/lib/cli-surface');

function createHarness() {
  const calls = [];
  const setup = createSetupInit({
    agentopsStatusSummary({ checks }) {
      calls.push(['status', checks]);
      return {
        required_files: { found: 1, total: 1, missing: [] },
        content_capture_off: true,
        collector_localhost: true
      };
    },
    commandCandidates: () => [],
    configFromEnvValues: () => ({}),
    configuredCloudValues: () => ({}),
    defaultInstallDir: path.join(os.tmpdir(), 'agentops-native-onboarding-bin'),
    doctor(options) {
      calls.push(['doctor', options]);
      return [{ name: 'exists:local', ok: true }];
    },
    grafanaDashboardImportCommand: () => 'not-used',
    installDefaultAgents(options) {
      const target = path.join(options.copilotHome, 'agents', 'agentops.agent.md');
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'agentops');
      }
      return {
        targetDir: path.dirname(target),
        agents: [{ name: 'agentops', file: 'agentops.agent.md' }],
        installedAgents: [{ target }],
        updated: [],
        skipped: []
      };
    },
    installDefaultSkills(options) {
      const target = path.join(options.copilotHome, 'skills', 'agentops', 'SKILL.md');
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'agentops');
      }
      return {
        targetDir: path.dirname(target),
        skills: [{ name: 'agentops', directory: 'agentops' }],
        installedSkills: [{ target: path.dirname(target) }],
        updated: [],
        skipped: []
      };
    },
    installedShimStatus: () => ({ agentops_cli_installed: false }),
    isConfiguredValue: () => false,
    optionValue,
    parseEnvAssignments: () => ({}),
    plural: (count, noun) => `${count} ${noun}`,
    realCopilotSmokeCommand: () => 'copilot',
    validateAzure: () => {
      throw new Error('Azure must not be consulted by local-only init');
    }
  });
  return { calls, setup };
}

test('local-only init parser separates native local setup from full compatibility init', () => {
  const { setup } = createHarness();

  assert.deepEqual(setup.parseInitArgs(['--local-only']), {
    dryRun: true,
    full: false,
    localOnly: true,
    yes: false,
    shell: 'bash',
    confirmationRequired: true,
    confirmationCommand: 'agentops init --local-only --yes --shell bash',
    forceSkills: false,
    json: false,
    importDashboards: false,
    noSkills: false,
    provisionCloud: false,
    forceProvisionCloud: false,
    runSmoke: false,
    triageLatest: false,
    copilotHome: null,
    checkAzureAccount: true
  });

  const applied = setup.parseInitArgs(['--local-only', '--yes', '--shell', 'fish', '--no-skills']);
  assert.equal(applied.dryRun, false);
  assert.equal(applied.localOnly, true);
  assert.equal(applied.shell, 'fish');
  assert.equal(applied.confirmationRequired, false);
  assert.equal(applied.noSkills, true);

  const full = setup.parseInitArgs(['--full', '--dry-run', '--no-skills']);
  assert.equal(full.full, true);
  assert.equal(full.localOnly, false);
  assert.equal(full.shell, null);
  assert.throws(() => setup.parseInitArgs(['--local-only', '--provision-cloud']), /cannot be combined/);
  assert.throws(() => setup.parseInitArgs(['--local-only', '--shell', 'cmd']), /must be/);
  assert.throws(() => setup.parseInitArgs(['--shell', 'zsh']), /only supported/);
});

test('local-only preview is side-effect free, cloud-free, wrapper-free, and uses planned vocabulary', () => {
  const { calls, setup } = createHarness();
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-preview-'));
  try {
    const result = setup.agentopsInit({
      localOnly: true,
      dryRun: true,
      confirmationRequired: true,
      confirmationCommand: 'agentops init --local-only --yes --shell zsh',
      copilotHome,
      shell: 'zsh'
    });
    const output = setup.renderInit(result);

    assert.equal(result.mutates, false);
    assert.equal(result.cloud.checked, false);
    assert.equal(result.wrapper_required, false);
    assert.deepEqual(result.would_start, ['agentops collector start --mode local --privacy strict']);
    assert.equal(result.applied, null);
    assert.equal(fs.existsSync(path.join(copilotHome, 'skills')), false);
    assert.equal(fs.existsSync(path.join(copilotHome, 'agents')), false);
    assert.match(output, /Mode: preview/);
    assert.match(output, /would_install:/);
    assert.match(output, /would_write:/);
    assert.match(output, /would_start:/);
    assert.match(output, /would_emit/);
    assert.doesNotMatch(output, /installed/i);
    assert.doesNotMatch(output, /az account|azd provision|agentops copilot/);
    const jsonPreview = setup.renderInit({ ...result, native_otel: { ...result.native_otel, shell: 'json' } });
    assert.doesNotMatch(jsonPreview, /installed/i);
    assert.deepEqual(calls.map(([name]) => name), ['doctor', 'status']);
  } finally {
    fs.rmSync(copilotHome, { recursive: true, force: true });
  }
});

test('local-only yes applies only AgentOps-owned assets and emits native exports for every shell', () => {
  const shells = ['bash', 'zsh', 'fish', 'powershell', 'json'];
  for (const shell of shells) {
    const { setup } = createHarness();
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), `agentops-native-${shell}-`));
    try {
      const result = setup.agentopsInit({
        localOnly: true,
        dryRun: false,
        copilotHome,
        shell
      });
      const output = setup.renderInit(result);

      assert.equal(result.mutates, true);
      assert.equal(result.cloud.checked, false);
      assert.equal(result.wrapper_required, false);
      assert.equal(result.native_otel.exports.COPILOT_OTEL_ENABLED, 'true');
      assert.equal(result.native_otel.exports.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:4318');
      assert.equal(result.native_otel.exports.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, 'false');
      assert.equal(fs.existsSync(path.join(copilotHome, 'skills', 'agentops', 'SKILL.md')), true);
      assert.equal(fs.existsSync(path.join(copilotHome, 'agents', 'agentops.agent.md')), true);
      assert.equal(result.applied.collector, 'not_started_by_init');
    assert.ok(result.next.some(command => command.startsWith('copilot')));
    assert.ok(result.next.includes('copilot --no-remote-export'));

      if (shell === 'json') {
        const parsed = JSON.parse(output);
        assert.equal(parsed.local_only, true);
        assert.equal(parsed.shell_exports.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/protobuf');
      } else if (shell === 'fish') {
        assert.match(output, /set -gx COPILOT_OTEL_ENABLED/);
      } else if (shell === 'powershell') {
        assert.match(output, /\$env:COPILOT_OTEL_ENABLED/);
      } else {
        assert.match(output, /export COPILOT_OTEL_ENABLED='true'/);
      }
    } finally {
      fs.rmSync(copilotHome, { recursive: true, force: true });
    }
  }
});

test('help surfaces expose local native onboarding and retain full-init compatibility', () => {
  assert.match(surfaceUsage(), /eval.*init --local-only --yes --shell zsh/);
  assert.match(surfaceUsage(), /init --local-only \[--yes\] \[--shell bash\|zsh\|fish\|powershell\|json\]/);
  assert.match(surfaceUsage(), /init \[--dry-run\] --full/);
  assert.match(legacyUsage(), /init --local-only \[--yes\] \[--shell bash\|zsh\|fish\|powershell\|json\]/);
});
