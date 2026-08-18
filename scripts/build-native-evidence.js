#!/usr/bin/env node
'use strict';

// Build a small, sealed, machine-readable summary of a native OTLP pilot.
// Raw receipts, query responses, endpoint URLs, and Azure identifiers stay out
// of this artifact by design.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find(arg => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function gitValue(args) {
  const result = childProcess.spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function status(value, name) {
  const allowed = new Set(['verified', 'not-run', 'failed', 'blocked']);
  if (!allowed.has(value)) throw new Error(`${name} must be verified, not-run, failed, or blocked`);
  return value;
}

function writeSealed(filePath, document) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(temporary, 0o600); } catch {}
  fs.renameSync(temporary, absolute);
  try { fs.chmodSync(absolute, 0o600); } catch {}
  return absolute;
}

function buildEvidence() {
  const checks = {
    traces: status(option('traces', 'not-run'), 'traces'),
    logs: status(option('logs', 'not-run'), 'logs'),
    metrics: status(option('metrics', 'not-run'), 'metrics'),
    collector_replay: status(option('replay', 'not-run'), 'replay'),
    package: status(option('package', 'not-run'), 'package')
  };
  const leaks = [];
  const sealed = Object.values(checks).every(value => value === 'verified') && leaks.length === 0;
  const sourceRevision = gitValue(['rev-parse', 'HEAD']);
  const dirty = Boolean(gitValue(['status', '--porcelain']));
  return {
    schema_version: 1,
    evidence_id: `native-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`,
    generated_at: new Date().toISOString(),
    evidence_class: sealed ? 'query-verified' : 'review-only',
    sealed,
    product: 'Copilot CLI AgentOps for Azure',
    architecture: 'native-copilot-otel-local-strict-collector',
    target: {
      profile: 'development-preview',
      region: option('region', 'redacted'),
      subscription: 'redacted',
      resource_group: 'redacted',
      application_insights: 'redacted'
    },
    checks,
    privacy: {
      content_capture: false,
      leaks
    },
    metric_query_surface: 'azure-monitor-workspace-promql',
    promotion: {
      npm_publish_authorized: false,
      hosted_staging_verified: false,
      production_verified: false
    },
    source: {
      revision: sourceRevision,
      worktree_dirty: dirty,
      node: process.version,
      platform: `${process.platform}/${os.arch()}`
    }
  };
}

if (require.main === module) {
  try {
    const out = option('out');
    if (!out) throw new Error('Usage: build-native-evidence.js --out=<file> [--traces=verified] [--logs=verified] [--metrics=verified] [--replay=verified] [--package=verified]');
    const document = buildEvidence();
    const file = writeSealed(out, document);
    process.stdout.write(`${JSON.stringify({ ...document, file }, null, 2)}\n`);
    process.exit(document.sealed ? 0 : 2);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

module.exports = { buildEvidence, writeSealed };
