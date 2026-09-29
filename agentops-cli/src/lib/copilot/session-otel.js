const fs = require('node:fs');
const path = require('node:path');

const { collectorHome } = require('../paths');

const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;

function attributeValue(attributes, key) {
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
      for (const resource of request.resourceSpans || []) {
        const resourceAttributes = resource.resource?.attributes || [];
        for (const scope of resource.scopeSpans || []) {
          for (const span of scope.spans || []) {
            const attributes = span.attributes || [];
            const conversationId = attributeValue(attributes, 'gen_ai.conversation.id')
              || attributeValue(attributes, 'agentops.session.id')
              || attributeValue(resourceAttributes, 'gen_ai.conversation.id')
              || attributeValue(resourceAttributes, 'agentops.session.id');
            if (conversationId !== sessionId) continue;
            const start = millisecondTime(span.startTimeUnixNano);
            const end = millisecondTime(span.endTimeUnixNano);
            if (start === null || end === null || end < start) {
              invalid += 1;
              continue;
            }
            if (!span.traceId || !span.spanId) {
              invalid += 1;
              continue;
            }
            const identity = `${span.traceId || ''}:${span.spanId || ''}`;
            if (seen.has(identity)) continue;
            seen.add(identity);
            spans.push({
              start,
              end,
              traceId: span.traceId || '',
              spanId: span.spanId || '',
              parentSpanId: span.parentSpanId || '',
              operation: String(attributeValue(attributes, 'gen_ai.operation.name') || span.name || 'unknown'),
              toolName: String(attributeValue(attributes, 'gen_ai.tool.name') || ''),
              toolCallId: String(attributeValue(attributes, 'gen_ai.tool.call.id') || ''),
              model: String(attributeValue(attributes, 'gen_ai.response.model') || attributeValue(attributes, 'gen_ai.request.model') || ''),
              agent: String(attributeValue(attributes, 'agentops.agent.name') || 'native OTel'),
              inputTokens: attributeValue(attributes, 'gen_ai.usage.input_tokens'),
              outputTokens: attributeValue(attributes, 'gen_ai.usage.output_tokens'),
              failed: Number(span.status?.code) === 2 || Boolean(attributeValue(attributes, 'error.type')),
              sourceFile: path.basename(file)
            });
          }
        }
      }
    }
  }
  return { spans, files, invalid };
}

module.exports = { defaultReceiptFiles, readSessionOtelSpans };
