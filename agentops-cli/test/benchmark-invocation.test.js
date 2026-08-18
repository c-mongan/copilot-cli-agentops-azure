const assert = require('node:assert/strict');
const test = require('node:test');

const {
  benchmarkCopilotInvocation,
  benchmarkSandboxProfile,
  mergeResourceAttributes
} = require('../src/lib/benchmark-invocation');

function benchmarkRun(osSandbox = null) {
  return {
    copilot: {
      command: 'copilot',
      args: ['--allow-tool=read_file'],
      prompt: 'Inspect the fixture.'
    },
    copilotHome: '/tmp/agentops/copilot-home',
    osSandbox
  };
}

test('benchmark invocation merges escaped resource attributes', () => {
  const merged = mergeResourceAttributes('existing=true', {
    'agentops.benchmark.task_id': 'task,one',
    'agentops.benchmark.workspace': 'fixtures\\tiny'
  });

  assert.equal(merged, 'existing=true,agentops.benchmark.task_id=task\\,one,agentops.benchmark.workspace=fixtures\\\\tiny');
});

test('benchmark invocation builds container sandbox command', () => {
  const invocation = benchmarkCopilotInvocation(
    benchmarkRun({ mode: 'container-network-blocked', image: 'agentops/copilot-runner:test' }),
    '/tmp/agentops/workspace',
    { containerRuntimeCommand: 'podman' }
  );

  assert.equal(invocation.command, 'podman');
  assert.deepEqual(invocation.args.slice(0, 5), ['run', '--rm', '--network', 'none', '-v']);
  assert.ok(invocation.args.includes('/tmp/agentops/workspace:/workspace'));
  assert.ok(invocation.args.includes('COPILOT_HOME=/copilot-home'));
  assert.deepEqual(invocation.args.slice(-4), ['copilot', '--allow-tool=read_file', '-p', 'Inspect the fixture.']);
  assert.deepEqual(invocation.sandbox, {
    mode: 'container-network-blocked',
    active: true,
    command: 'podman',
    image: 'agentops/copilot-runner:test',
    network: 'blocked'
  });
});

test('benchmark invocation builds macOS sandbox profiles and fails closed elsewhere', () => {
  const run = benchmarkRun({ mode: 'macos-network-blocked' });
  const profile = benchmarkSandboxProfile(run, '/tmp/agentops/workspace');
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\/tmp\/agentops\/workspace/);

  const darwin = benchmarkCopilotInvocation(run, '/tmp/agentops/workspace', { platform: 'darwin' });
  assert.equal(darwin.command, 'sandbox-exec');
  assert.equal(darwin.args[0], '-p');
  assert.equal(darwin.args[2], 'copilot');
  assert.deepEqual(darwin.sandbox, {
    mode: 'macos-network-blocked',
    active: true,
    command: 'sandbox-exec'
  });

  const linux = benchmarkCopilotInvocation(run, '/tmp/agentops/workspace', { platform: 'linux' });
  assert.equal(linux.command, 'copilot');
  assert.deepEqual(linux.sandbox, {
    mode: 'macos-network-blocked',
    active: false,
    error: 'macos-network-blocked requires macOS sandbox-exec'
  });
});
