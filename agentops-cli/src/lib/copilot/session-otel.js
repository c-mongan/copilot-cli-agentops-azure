const fs = require('node:fs');
const path = require('node:path');

const { collectorHome } = require('../paths');

const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;

function attributeValue(attributes, key) {
  if (attributes && !Array.isArray(attributes)) return attributes[key] ?? '';
  const value = attributes?.find(attribute => attribute.key === key)?.value;
  return value?.stringValue ?? value?.intValue ?? value?.boolValue ?? '';
}

function millisecondTime(nanoseconds) {
  try {
    const value = Number(BigInt(nanoseconds) / 1000000n);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function flatMillisecondTime(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [seconds, nanoseconds] = value;
  if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1000000000) return null;
  const milliseconds = seconds * 1000 + Math.floor(nanoseconds / 1000000);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

function spanRecords(request) {
  if (request?.type === 'span') return [{ span: request, resourceAttributes: request.resource?.attributes || {} }];
  if (request?.type) return [];
  const records = [];
  for (const resource of request?.resourceSpans || []) {
    for (const scope of resource.scopeSpans || []) {
      for (const span of scope.spans || []) records.push({ span, resourceAttributes: resource.resource?.attributes || [] });
    }
  }
  return records;
}

function defaultReceiptFiles() {
  return ['native-receipt.jsonl', 'native-azure-receipt.jsonl']
    .map(name => path.join(collectorHome, name))
    .filter(file => fs.existsSync(file));
}

function readSessionOtelSpans(sessionId, files = defaultReceiptFiles()) {
  const spans = [];
  const seen = new Set();
  let invalid = 0;
  for (const file of files) {
    if (fs.statSync(file).size > MAX_RECEIPT_BYTES) {
      throw new Error(`native OTel receipt exceeds ${MAX_RECEIPT_BYTES} bytes: ${file}`);
    }
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        invalid += 1;
        continue;
      }
      for (const { span, resourceAttributes } of spanRecords(request)) {
        const attributes = span.attributes || [];
        const conversationId = attributeValue(attributes, 'gen_ai.conversation.id')
          || attributeValue(attributes, 'agentops.session.id')
          || attributeValue(resourceAttributes, 'gen_ai.conversation.id')
          || attributeValue(resourceAttributes, 'agentops.session.id');
        if (conversationId !== sessionId) continue;
        const start = span.type === 'span' ? flatMillisecondTime(span.startTime) : millisecondTime(span.startTimeUnixNano);
        const end = span.type === 'span' ? flatMillisecondTime(span.endTime) : millisecondTime(span.endTimeUnixNano);
        if (start === null || end === null || end < start) {
          invalid += 1;
          continue;
        }
        if (!span.traceId || !span.spanId) {
          invalid += 1;
          continue;
        }
        const identity = `${span.traceId}:${span.spanId}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const events = (span.events || []).map(event => ({
          time: flatMillisecondTime(event.time) ?? millisecondTime(event.timeUnixNano),
          name: String(event.name || ''),
          attributes: event.attributes || {}
        })).filter(event => event.time !== null && event.name);
        spans.push({
          start,
          end,
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId || '',
          operation: String(attributeValue(attributes, 'gen_ai.operation.name') || span.name || 'unknown'),
          toolName: String(attributeValue(attributes, 'gen_ai.tool.name') || ''),
          toolCallId: String(attributeValue(attributes, 'gen_ai.tool.call.id') || ''),
          model: String(attributeValue(attributes, 'gen_ai.response.model') || attributeValue(attributes, 'gen_ai.request.model') || ''),
          agent: String(attributeValue(attributes, 'gen_ai.agent.name') || attributeValue(attributes, 'agentops.agent.name') || 'native OTel'),
          inputTokens: attributeValue(attributes, 'gen_ai.usage.input_tokens'),
          outputTokens: attributeValue(attributes, 'gen_ai.usage.output_tokens'),
          failed: Number(span.status?.code) === 2 || Boolean(attributeValue(attributes, 'error.type')),
          events,
          sourceFile: path.basename(file)
        });
      }
    }
  }
  return { spans, files, invalid };
}

module.exports = { defaultReceiptFiles, readSessionOtelSpans };
