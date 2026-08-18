const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readJson, readJsonl, readJsonlIfExists, readJsonlRows } = require('../src/lib/json');

test('readJsonl reads newline-delimited JSON rows and tolerates missing paths', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-jsonl-')), 'rows.jsonl');

  fs.writeFileSync(file, '{"id":1}\n\n{"id":2}\r\n');

  assert.deepEqual(readJsonl(file), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(readJsonl(''), []);
  assert.deepEqual(readJsonl(null), []);
});

test('readJsonlRows preserves the shared JSONL row-reader surface', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-jsonl-rows-')), 'rows.jsonl');

  fs.writeFileSync(file, '{"name":"first"}\n{"name":"second"}\n');

  assert.deepEqual(readJsonlRows(file), [{ name: 'first' }, { name: 'second' }]);
});

test('readJsonlIfExists returns an empty list for missing files', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-jsonl-missing-')), 'missing.jsonl');

  assert.deepEqual(readJsonlIfExists(file), []);
});

test('readJson reads a UTF-8 JSON file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-json-')), 'payload.json');

  fs.writeFileSync(file, '{"ok":true,"count":2}');

  assert.deepEqual(readJson(file), { ok: true, count: 2 });
});
