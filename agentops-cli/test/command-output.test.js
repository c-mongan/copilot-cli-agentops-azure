const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  appendJsonlFile,
  jsonOutput,
  jsonlOutput,
  writeJson,
  writeJsonFile,
  writeJsonlFile,
  writeJsonOrRender
} = require('../src/lib/command-output');

function createOutput() {
  const chunks = [];
  return {
    chunks,
    stdout: {
      write(chunk) {
        chunks.push(chunk);
      }
    }
  };
}

test('command output helpers write pretty JSON with a trailing newline', () => {
  const output = createOutput();

  assert.equal(jsonOutput({ ok: true }), '{\n  "ok": true\n}\n');
  writeJson({ count: 2 }, output.stdout);

  assert.deepEqual(output.chunks, ['{\n  "count": 2\n}\n']);
});

test('command output helpers choose JSON or rendered text', () => {
  const json = createOutput();
  const text = createOutput();

  writeJsonOrRender({ ok: true }, true, value => `rendered ${value.ok}\n`, json.stdout);
  writeJsonOrRender({ ok: true }, false, value => `rendered ${value.ok}\n`, text.stdout);

  assert.deepEqual(json.chunks, ['{\n  "ok": true\n}\n']);
  assert.deepEqual(text.chunks, ['rendered true\n']);
});

test('command output helpers write pretty JSON files and create parent directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-command-output-'));
  const file = path.join(dir, 'nested', 'output.json');

  const written = writeJsonFile(file, { ok: true });

  assert.equal(written, file);
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "ok": true\n}\n');
});

test('command output helpers format JSONL rows with predictable newline behavior', () => {
  assert.equal(jsonlOutput([{ id: 1 }, { id: 2 }]), '{"id":1}\n{"id":2}\n');
  assert.equal(jsonlOutput([]), '');
  assert.equal(jsonlOutput([], { trailingNewline: true }), '\n');
});

test('command output helpers write JSONL files and create parent directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-command-output-'));
  const file = path.join(dir, 'nested', 'output.jsonl');

  const written = writeJsonlFile(file, [{ ok: true }]);

  assert.equal(written, file);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}\n');
});

test('command output helpers append JSONL rows and create parent directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-command-output-'));
  const file = path.join(dir, 'nested', 'output.jsonl');

  appendJsonlFile(file, { id: 1 });
  const written = appendJsonlFile(file, { id: 2 });

  assert.equal(written, file);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"id":1}\n{"id":2}\n');
});
