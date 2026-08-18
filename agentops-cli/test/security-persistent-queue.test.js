const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { persistentCollectorQueueCheck } = require('../src/lib/security-audit');

const repoRoot = path.resolve(__dirname, '..', '..');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-queue-audit-'));
  fs.cpSync(path.join(repoRoot, 'collector'), path.join(root, 'collector'), { recursive: true });
  const queue = path.join(root, 'runtime-queue');
  fs.mkdirSync(queue, { mode: 0o700 });
  return { root, queue };
}

function rewrite(file, change) {
  fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')));
}

test('persistent collector queue audit accepts bounded privacy-first configs and private runtime storage', t => {
  const { root, queue } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = persistentCollectorQueueCheck({ root, collectorQueueDir: queue });

  assert.equal(result.ok, true, result.detail);
  assert.equal(result.evidence.filter(item => item.file).length, 4);
  assert.ok(result.evidence.filter(item => item.file).every(item => item.queue_size === 1000));
  const runtime = result.evidence.at(-1);
  assert.equal(runtime.directory, queue);
  assert.equal(runtime.exists, true);
  assert.equal(runtime.permissions_checked, process.platform !== 'win32');
  if (process.platform !== 'win32') assert.equal(runtime.mode, '700');
});

test('persistent collector queue audit rejects unbounded, non-persistent, and privacy-late configs', t => {
  const { root, queue } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const compat = path.join(root, 'collector', 'otelcol.binary.compat.yaml');
  const strict = path.join(root, 'collector', 'otelcol.binary.strict.yaml');
  rewrite(compat, body => body
    .replace('      storage: file_storage\n', '')
    .replace('      queue_size: 1000', '      queue_size: 1000000'));
  rewrite(strict, body => body.replace(
    'processors: [memory_limiter, transform/privacy_strict, batch]',
    'processors: [memory_limiter, batch, transform/privacy_strict]'
  ));

  const result = persistentCollectorQueueCheck({ root, collectorQueueDir: queue });

  assert.equal(result.ok, false);
  assert.match(result.detail, /persist through file_storage/);
  assert.match(result.detail, /bounded between 1 and 10000/);
  assert.match(result.detail, /sanitize before batch\/queue\/export/);
});

test('persistent collector queue audit rejects group or world-readable runtime storage on POSIX', {
  skip: process.platform === 'win32'
}, t => {
  const { root, queue } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.chmodSync(queue, 0o750);

  const result = persistentCollectorQueueCheck({ root, collectorQueueDir: queue });

  assert.equal(result.ok, false);
  assert.match(result.detail, /must not grant group\/other access/);
  assert.equal(result.evidence.at(-1).mode, '750');
});
