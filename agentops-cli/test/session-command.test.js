const assert = require('node:assert/strict');
const test = require('node:test');

const { createSessionCommand } = require('../src/lib/session-command');

function createOutput() {
  let text = '';
  return {
    stdout: {
      write(chunk) {
        text += String(chunk);
        return true;
      }
    },
    text() {
      return text;
    }
  };
}

test('session command writes latest output through injected stdout', async () => {
  const output = createOutput();
  const calls = [];
  const { sessionCommand, sessionCommandNames } = createSessionCommand({
    stdout: output.stdout,
    latestSummaryFromArgs(args) {
      calls.push(args);
      return { id: 'summary-1' };
    },
    renderLatest(summary) {
      return `latest:${summary.id}`;
    }
  });

  assert.ok(sessionCommandNames.includes('latest'));

  await sessionCommand('latest', ['--last', '1h']);

  assert.deepEqual(calls, [['--last', '1h']]);
  assert.equal(output.text(), 'latest:summary-1');
});

test('session command replays local latest spans without Azure lookup', async () => {
  const output = createOutput();
  const calls = [];
  const { sessionCommand } = createSessionCommand({
    stdout: output.stdout,
    optionValue(args, names) {
      calls.push(['optionValue', args, names]);
      return args.includes('--file');
    },
    spanRowsFromSource(args, last) {
      calls.push(['spanRowsFromSource', args, last]);
      return { mode: 'file', rows: [{ span_id: 'span-1' }] };
    },
    replayTimeline(rows, options) {
      calls.push(['replayTimeline', rows, options]);
      return { rows, options };
    },
    renderReplay(timeline) {
      return JSON.stringify(timeline);
    }
  });

  await sessionCommand('replay', ['latest', '--file', 'run.jsonl']);

  assert.deepEqual(calls, [
    ['spanRowsFromSource', ['--file', 'run.jsonl'], '7d'],
    ['replayTimeline', [{ span_id: 'span-1' }], { sessionId: 'latest', source: 'file' }]
  ]);
  assert.equal(output.text(), '{"rows":[{"span_id":"span-1"}],"options":{"sessionId":"latest","source":"file"}}');
});

test('session command recommends only the latest session and keeps lookback context', async () => {
  const output = createOutput();
  const calls = [];
  const { sessionCommand } = createSessionCommand({
    stdout: output.stdout,
    latestSummaryFromArgs(args) {
      calls.push(['latestSummaryFromArgs', args]);
      return { id: 'summary-2' };
    },
    parseLastArg(args, fallback) {
      calls.push(['parseLastArg', args, fallback]);
      return '2h';
    },
    explainLatest(summary) {
      calls.push(['explainLatest', summary]);
      return { classification: 'failed_tool' };
    },
    recommendationForExplanation(explanation, context) {
      calls.push(['recommendationForExplanation', explanation, context]);
      return { action: 'inspect-tools' };
    },
    renderRecommendation(recommendation) {
      return `recommend:${recommendation.action}`;
    }
  });

  await sessionCommand('recommend', ['latest', '--last', '2h']);

  assert.deepEqual(calls, [
    ['latestSummaryFromArgs', ['--last', '2h']],
    ['parseLastArg', ['--last', '2h'], '7d'],
    ['explainLatest', { id: 'summary-2' }],
    ['recommendationForExplanation', { classification: 'failed_tool' }, { last: '2h' }]
  ]);
  assert.equal(output.text(), 'recommend:inspect-tools');
});

test('session command rejects unsupported live interval and explain target', async () => {
  const { sessionCommand } = createSessionCommand({});

  await assert.rejects(
    () => sessionCommand('live', ['--interval', '0']),
    /--interval must be a positive number/
  );
  await assert.rejects(
    () => sessionCommand('explain', ['session-1']),
    /explain currently supports: explain latest/
  );
});
