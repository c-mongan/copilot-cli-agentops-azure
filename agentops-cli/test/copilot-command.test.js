const assert = require('node:assert/strict');
const test = require('node:test');

const {
  removeAgentOpsCopilotFlags,
  receiptDeliveryText,
  renderCopilotReceipt,
  safeReceiptName,
  wrapperReplayUrl
} = require('../src/lib/copilot/command');

test('copilot command helpers strip wrapper flags and build replay links', () => {
  assert.deepEqual(
    removeAgentOpsCopilotFlags(['--collector-mode', 'none', '--privacy=strict', '--unsafe-no-collector', '-p', 'hello']),
    ['-p', 'hello']
  );
  assert.equal(
    wrapperReplayUrl(
      { runId: 'wrapper run,=id', sessionId: 'wrapper session' },
      { v2_replay_url: 'https://grafana.example/d/agentops-v2-run-replay?var-session_id=old' }
    ),
    'https://grafana.example/d/agentops-v2-run-replay?var-run_id=wrapper+run%2C%3Did&var-session_id=wrapper+session'
  );
});

test('normal Copilot receipt is immediate, privacy-safe, and honest about ingestion', () => {
  const envelope = { runId: 'run-123', sessionId: 'session-123' };
  const observed = renderCopilotReceipt({
    envelope,
    exitCode: 0,
    privacy: 'strict',
    replayUrl: 'https://grafana.example/d/run-story',
    wallDurationMs: 7100,
    agent: 'agentops-kitchen-sink-smoke',
    summary: {
      sessionId: 'native-session',
      model: 'gpt-5.6-sol',
      inputTokens: 20226,
      outputTokens: 8,
      aiCredits: 12.664,
      apiDurationMs: 2012,
      tools: ['read_file'],
      filesModified: 1,
      linesAdded: 4,
      linesRemoved: 2
    }
  });
  const unobserved = renderCopilotReceipt({ envelope, exitCode: 2, fallbackUnobserved: true });

  assert.match(observed, /AgentOps receipt/);
  assert.match(observed, /Completed · exit 0/);
  assert.match(observed, /Best effort · delivery not yet confirmed/);
  assert.match(observed, /Coverage\s+Detailed Copilot activity is best effort; use agentops latest to check what arrived/);
  assert.doesNotMatch(observed, /Recorded locally|Visible in Azure/);
  assert.match(observed, /AgentOps did not record prompts, answers, code, or tool payloads/);
  assert.match(observed, /Details\s+agentops latest/);
  assert.match(observed, /Run Story\s+https:\/\/grafana\.example/);
  assert.match(observed, /Copilot\s+native-session/);
  assert.match(observed, /Details\s+agentops latest · run run-123 · wrapper session session-123/);
  assert.match(observed, /Agent\s+agentops-kitchen-sink-smoke/);
  assert.match(observed, /Tokens\s+20,226 in · 8 out/);
  assert.match(observed, /AI credits\s+12\.7/);
  assert.match(observed, /Time\s+7\.1s wall · 2\.0s API/);
  assert.match(observed, /Tools\s+1 · read_file/);
  assert.match(observed, /Code\s+1 files · \+4 \/ -2/);
  assert.match(renderCopilotReceipt({
    envelope,
    exitCode: 0,
    privacy: 'strict',
    requestedPrivacy: 'compat'
  }), /Privacy\s+strict effective · compat requested/);
  assert.match(unobserved, /Needs attention · exit 2/);
  assert.match(unobserved, /Not observed · collector unavailable/);
  assert.equal(safeReceiptName('unsafe\nagent'), '');
});

test('receipt delivery wording separates local receipt evidence from native detail coverage', () => {
  assert.match(receiptDeliveryText('local_pending'), /Run receipt saved locally/);
  assert.match(receiptDeliveryText('azure_acknowledged'), /accepted by Azure/);
  assert.match(receiptDeliveryText('overflow'), /NOT SAVED/);
  assert.match(receiptDeliveryText('expired'), /held locally/);
  assert.match(receiptDeliveryText('quarantined'), /needs review/);
});
