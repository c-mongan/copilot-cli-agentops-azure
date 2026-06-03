#!/usr/bin/env node

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

function truthy(value) {
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return Boolean(value);
}

function numberValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function summarize(input = {}) {
  const metadata = input.metadata || input.meta || {};
  const changes = input.changes || input.changeSummary || metadata.changes || {};
  const warnings = [];

  const toolFailures = numberValue(
    input.toolFailures,
    input.tool_failures,
    input.failedToolCalls,
    input.failed_tool_calls,
    metadata.toolFailures,
    metadata.tool_failures,
    metadata['agentops.tool_failures']
  );
  const unresolvedToolFailures = numberValue(
    input.unresolvedToolFailures,
    input.unresolved_tool_failures,
    metadata.unresolvedToolFailures,
    metadata.unresolved_tool_failures,
    metadata['agentops.unresolved_tool_failures'],
    toolFailures
  );
  const contentCapture = [
    input.contentCapture,
    input.content_capture,
    input.contentCaptureEnabled,
    input.content_capture_enabled,
    metadata.contentCapture,
    metadata.content_capture,
    metadata.contentCaptureEnabled,
    metadata.content_capture_enabled,
    metadata['agentops.content_capture.signal']
  ].some(truthy);
  const filesEdited = numberValue(
    input.filesEdited,
    input.files_edited,
    changes.filesEdited,
    changes.files_edited,
    metadata.filesEdited,
    metadata.files_edited,
    metadata['agentops.files_edited']
  ) + arrayValue(input.changedFiles || input.changed_files || changes.files || metadata.changedFiles).length;
  const benchmarkRan = [
    input.benchmarkRan,
    input.benchmark_ran,
    input.testsRan,
    input.tests_ran,
    metadata.benchmarkRan,
    metadata.benchmark_ran,
    metadata.testsRan,
    metadata.tests_ran,
    metadata['agentops.benchmark_ran']
  ].some(truthy);

  if (unresolvedToolFailures > 0) {
    warnings.push({
      category: 'unresolved-tool-failures',
      message: `${unresolvedToolFailures} unresolved tool failure${unresolvedToolFailures === 1 ? '' : 's'} observed; review before handing off.`
    });
  }
  if (contentCapture) {
    warnings.push({
      category: 'content-capture',
      message: 'Content capture was enabled; verify no prompt, code, tool args, or tool output were exported.'
    });
  }
  if (filesEdited > 0 && !benchmarkRan) {
    warnings.push({
      category: 'missing-validation',
      message: 'Files changed without benchmark/test validation metadata; run an appropriate local check before keeping the change.'
    });
  }

  return {
    ok: warnings.length === 0,
    decision: 'warn',
    hook: input.hookType || input.hook_type || input.type || 'agentStop',
    warnings,
    recommendation: warnings.length > 0
      ? 'Review the warning categories, then run the smallest relevant validation command.'
      : 'No AgentOps stop-gate warnings from metadata-only checks.'
  };
}

(async () => {
  let input;
  try {
    input = JSON.parse(await readStdin() || '{}');
  } catch {
    input = {};
  }
  const result = summarize(input);
  if (result.warnings.length > 0) {
    process.stdout.write(JSON.stringify(result));
  }
  process.exit(0);
})();
