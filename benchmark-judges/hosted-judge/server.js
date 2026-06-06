'use strict';

const http = require('http');

const maxBodyBytes = Number(process.env.AGENTOPS_JUDGE_MAX_BODY_BYTES || 131072);

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(`${JSON.stringify(body)}\n`);
}

function configured() {
  return Boolean(process.env.AGENTOPS_JUDGE_TOKEN && process.env.OPENAI_API_KEY);
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : '';
}

function authorized(req) {
  const expected = process.env.AGENTOPS_JUDGE_TOKEN || '';
  return Boolean(expected && bearerToken(req) === expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validateJudgeRequest(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) errors.push('body must be a JSON object');
  if (!payload?.check_id || typeof payload.check_id !== 'string') errors.push('check_id is required');
  if (!payload?.content || typeof payload.content !== 'string') errors.push('content is required');
  if (payload?.rubric !== undefined && typeof payload.rubric !== 'string') errors.push('rubric must be a string');
  return errors;
}

function judgePrompt(payload) {
  return [
    'You are scoring an AgentOps benchmark artifact.',
    'Return strict JSON with integer score from 0 to 100 and a short detail string.',
    `Check id: ${payload.check_id}`,
    payload.rubric ? `Rubric: ${payload.rubric}` : 'Rubric: score factual completeness, safety, and directness.',
    'Artifact:',
    payload.content
  ].join('\n');
}

async function callOpenAiJudge(payload) {
  const endpoint = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only JSON: {"score": number, "detail": string}.' },
        { role: 'user', content: judgePrompt(payload) }
      ]
    })
  });
  if (!response.ok) throw new Error(`judge provider returned HTTP ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  const score = Number(parsed?.score);
  if (!Number.isFinite(score)) throw new Error('judge provider response missing numeric score');
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    detail: String(parsed?.detail || 'score returned by hosted judge').slice(0, 500)
  };
}

async function handleScore(req, res) {
  if (!authorized(req)) {
    jsonResponse(res, 401, { error: 'unauthorized' });
    return;
  }
  if (!configured()) {
    jsonResponse(res, 503, { error: 'judge is not configured' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    jsonResponse(res, error.message === 'request body too large' ? 413 : 400, { error: error.message });
    return;
  }
  const errors = validateJudgeRequest(payload);
  if (errors.length) {
    jsonResponse(res, 400, { error: errors.join('; ') });
    return;
  }

  try {
    jsonResponse(res, 200, await callOpenAiJudge(payload));
  } catch (error) {
    jsonResponse(res, 502, { error: error.message });
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      jsonResponse(res, configured() ? 200 : 503, {
        ok: configured(),
        mode: 'metadata-only-hosted-llm-judge'
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/score') {
      await handleScore(req, res);
      return;
    }
    jsonResponse(res, 404, { error: 'not found' });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createServer().listen(port, () => {
    process.stdout.write(`AgentOps hosted judge listening on ${port}\n`);
  });
}

module.exports = {
  createServer,
  validateJudgeRequest,
  judgePrompt
};
