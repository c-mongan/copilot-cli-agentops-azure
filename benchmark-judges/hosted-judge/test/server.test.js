'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const { createServer, judgePrompt, validateJudgeRequest } = require('../server');

function listen(server) {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('hosted judge validates metadata-only score requests', () => {
  assert.deepEqual(validateJudgeRequest({ check_id: 'quality', content: 'answer' }), []);
  assert.deepEqual(validateJudgeRequest({ content: 'answer' }), ['check_id is required']);
  assert.match(judgePrompt({ check_id: 'quality', content: 'answer', rubric: 'be concise' }), /Rubric: be concise/);
});

test('hosted judge health and auth fail closed', async () => {
  const originalToken = process.env.AGENTOPS_JUDGE_TOKEN;
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.AGENTOPS_JUDGE_TOKEN;
  delete process.env.OPENAI_API_KEY;
  const server = createServer();
  const port = await listen(server);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 503);

    const score = await fetch(`http://127.0.0.1:${port}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check_id: 'quality', content: 'answer' })
    });
    assert.equal(score.status, 401);
  } finally {
    server.close();
    if (originalToken === undefined) delete process.env.AGENTOPS_JUDGE_TOKEN;
    else process.env.AGENTOPS_JUDGE_TOKEN = originalToken;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('hosted judge score endpoint returns provider score', async () => {
  const originalToken = process.env.AGENTOPS_JUDGE_TOKEN;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.AGENTOPS_JUDGE_TOKEN = 'test-token';
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages[1].content.includes('Check id: quality'), true);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({ score: 87.6, detail: 'clear and safe' })
          }
        }]
      })
    };
  };

  const server = createServer();
  const port = await listen(server);
  try {
    const response = await originalFetch(`http://127.0.0.1:${port}/score`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ check_id: 'quality', content: 'answer' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { score: 88, detail: 'clear and safe' });
  } finally {
    server.close();
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.AGENTOPS_JUDGE_TOKEN;
    else process.env.AGENTOPS_JUDGE_TOKEN = originalToken;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
