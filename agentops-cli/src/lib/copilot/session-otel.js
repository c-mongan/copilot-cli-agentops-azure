const fs = require('node:fs');
const path = require('node:path');

const { collectorHome } = require('../paths');

const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;

function attributeValue(attributes, key) {
  if (attributes && !Array.isArray(attributes)) {
    const value = attributes[key];
    if (value && typeof value === 'object') return value.stringValue ?? value.intValue ?? value.boolValue ?? '';
    return value ?? '';
  }
  const value = attributes?.find(attribute => attribute.key === key)?.value;
  return value?.stringValue ?? value?.intValue ?? value?.boolValue ?? '';
}

// Unlike attributeValue() (which returns '' for both "absent" and "present but
// empty", a contract all of its other callers rely on), this distinguishes a
// genuinely missing attribute from a measured value, so token/usage counts
// that are never reported can stay null instead of collapsing to 0.
function attributePresent(attributes, key) {
  if (attributes && !Array.isArray(attributes)) return Object.prototype.hasOwnProperty.call(attributes, key);
  return Array.isArray(attributes) && attributes.some(attribute => attribute.key === key);
}

function numericAttributeOrNull(attributes, key) {
  if (!attributePresent(attributes, key)) return null;
  const number = Number(attributeValue(attributes, key));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function millisecondTime(nanoseconds) {
  try {
    const value = Number(BigInt(nanoseconds)) / 1000000;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function flatMillisecondTime(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [seconds, nanoseconds] = value;
  if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1000000000) return null;
  const milliseconds = seconds * 1000 + nanoseconds / 1000000;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

function timestampNanoseconds(span, edge) {
  const unixNano = span?.[`${edge}TimeUnixNano`];
  if (unixNano !== undefined && unixNano !== null && unixNano !== '') {
    try { return BigInt(unixNano); } catch { return null; }
  }
  const flat = span?.[`${edge}Time`];
  if (!Array.isArray(flat) || flat.length !== 2) return null;
  const [seconds, nanoseconds] = flat;
  if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1000000000) return null;
  return BigInt(seconds) * 1000000000n + BigInt(nanoseconds);
}

function protobufFields(buffer) {
  const fields = [];
  let offset = 0;
  const readVarint = () => {
    let value = 0n;
    let shift = 0n;
    while (offset < buffer.length && shift <= 63n) {
      const byte = buffer[offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
    throw new Error('invalid protobuf varint');
  };
  while (offset < buffer.length) {
    const tag = Number(readVarint());
    const number = tag >>> 3;
    const wire = tag & 7;
    if (!number) throw new Error('invalid protobuf field number');
    if (wire === 0) fields.push({ number, wire, value: readVarint() });
    else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new Error('truncated protobuf fixed64');
      fields.push({ number, wire, value: buffer.subarray(offset, offset + 8) }); offset += 8;
    } else if (wire === 2) {
      const length = Number(readVarint());
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > buffer.length) throw new Error('truncated protobuf bytes');
      fields.push({ number, wire, value: buffer.subarray(offset, offset + length) }); offset += length;
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new Error('truncated protobuf fixed32');
      fields.push({ number, wire, value: buffer.subarray(offset, offset + 4) }); offset += 4;
    } else throw new Error('unsupported protobuf wire type');
    if (fields.length > 200000) throw new Error('protobuf message has too many fields');
  }
  return fields;
}

function matching(fields, number, wire = 2) { return fields.filter(field => field.number === number && field.wire === wire); }
function textField(fields, number) { return matching(fields, number)[0]?.value.toString('utf8') || ''; }
function messageField(fields, number) { const field = matching(fields, number)[0]; return field ? protobufFields(field.value) : []; }
function repeatedMessages(fields, number) { return matching(fields, number).map(field => protobufFields(field.value)); }
function uintField(fields, number) {
  const field = matching(fields, number, 0)[0];
  if (field) return field.value;
  const fixed = matching(fields, number, 1)[0];
  return fixed ? fixed.value.readBigUInt64LE(0) : 0n;
}

function protobufAnyValue(fields) {
  for (const [number, key] of [[1, 'stringValue'], [2, 'boolValue'], [3, 'intValue'], [4, 'doubleValue'], [7, 'bytesValue']]) {
    const field = matching(fields, number, number === 4 ? 1 : (number === 2 || number === 3 ? 0 : 2))[0];
    if (!field) continue;
    if (number === 4) return field.value.readDoubleLE(0);
    if (number === 2) return field.value !== 0n;
    if (number === 3) return Number(BigInt.asIntN(64, field.value));
    if (number === 7) return field.value.toString('base64');
    return field.value.toString('utf8');
  }
  return null;
}

function protobufAttributes(fields) {
  const attributes = {};
  for (const keyValue of repeatedMessages(fields, 9)) {
    const key = textField(keyValue, 1);
    if (!key) continue;
    const anyValue = messageField(keyValue, 2);
    attributes[key] = protobufAnyValue(anyValue);
  }
  return attributes;
}

function decodeOtlpProtobuf(base64) {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES || bytes.toString('base64').replace(/=+$/, '') !== String(base64).replace(/=+$/, '')) {
    throw new Error('invalid OTLP protobuf receipt');
  }
  const request = protobufFields(bytes);
  const resourceSpans = [];
  for (const resourceSpansFields of repeatedMessages(request, 1)) {
    const resourceFields = messageField(resourceSpansFields, 1);
    const resourceAttributes = repeatedMessages(resourceFields, 1).map(keyValue => ({
      key: textField(keyValue, 1),
      value: protobufAnyValue(messageField(keyValue, 2))
    }));
    const scopeSpans = [];
    for (const scopeFields of repeatedMessages(resourceSpansFields, 2)) {
      const scope = messageField(scopeFields, 1);
      const spans = repeatedMessages(scopeFields, 2).map(fields => {
        const traceId = matching(fields, 1)[0]?.value || Buffer.alloc(0);
        const spanId = matching(fields, 2)[0]?.value || Buffer.alloc(0);
        const parentSpanId = matching(fields, 4)[0]?.value || Buffer.alloc(0);
        const status = messageField(fields, 15);
        const attributes = repeatedMessages(fields, 9).map(keyValue => ({
          key: textField(keyValue, 1), value: { stringValue: String(protobufAnyValue(messageField(keyValue, 2)) ?? '') }
        }));
        const events = repeatedMessages(fields, 11).map(event => ({
          timeUnixNano: String(uintField(event, 1)), name: textField(event, 2),
          attributes: repeatedMessages(event, 3).map(keyValue => ({ key: textField(keyValue, 1), value: { stringValue: String(protobufAnyValue(messageField(keyValue, 2)) ?? '') } }))
        }));
        if (traceId.length !== 16 || spanId.length !== 8 || (parentSpanId.length && parentSpanId.length !== 8)) throw new Error('OTLP protobuf span has invalid identifier width');
        return {
          traceId: traceId.toString('hex'), spanId: spanId.toString('hex'), parentSpanId: parentSpanId.toString('hex'),
          name: textField(fields, 5), kind: Number(uintField(fields, 6)),
          startTimeUnixNano: String(uintField(fields, 7)), endTimeUnixNano: String(uintField(fields, 8)),
          attributes, events, status: { code: Number(uintField(status, 3)) }
        };
      });
      scopeSpans.push({ scope: { name: textField(scope, 1) }, spans });
    }
    resourceSpans.push({ resource: { attributes: resourceAttributes }, scopeSpans });
  }
  return { resourceSpans };
}

function spanRecords(request) {
  if (request?.type === 'span') return [{ span: request, resourceAttributes: request.resource?.attributes || {} }];
  if (request?.type) return [];
  const records = [];
  for (const resource of request?.resourceSpans || []) {
    const resourceAttributes = Array.isArray(resource.resource?.attributes)
      ? Object.fromEntries(resource.resource.attributes.map(attribute => [attribute.key, attribute.value]))
      : resource.resource?.attributes || {};
    for (const scope of resource.scopeSpans || []) {
      for (const span of scope.spans || []) records.push({ span, resourceAttributes });
    }
  }
  return records;
}

function defaultReceiptFiles() {
  return ['native-receipt.jsonl', 'native-azure-receipt.jsonl']
    .map(name => path.join(collectorHome, name))
    .filter(file => fs.existsSync(file));
}

function readSessionOtelSpans(sessionId, files = defaultReceiptFiles(), options = {}) {
  const spans = [];
  const seen = new Set();
  let invalid = 0;
  let unsupported = 0;
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
      if (request?.contentType === 'application/x-protobuf' && request.bodyBase64) {
        try { request = decodeOtlpProtobuf(request.bodyBase64); } catch { invalid += 1; continue; }
      } else if (request?.contentType && request.contentType.includes('json') && request.payload) request = request.payload;
      for (const { span, resourceAttributes } of spanRecords(request)) {
        const attributes = span.attributes || [];
        const conversationId = attributeValue(attributes, 'gen_ai.conversation.id')
          || attributeValue(attributes, 'agentops.session.id')
          || attributeValue(resourceAttributes, 'gen_ai.conversation.id')
          || attributeValue(resourceAttributes, 'agentops.session.id');
        const runId = attributeValue(attributes, 'agentops.run.id') || attributeValue(resourceAttributes, 'agentops.run.id');
        const scriptName = String(attributeValue(attributes, 'agentops.script.name') || '');
        const stepName = String(attributeValue(attributes, 'agentops.step.name') || '');
        const ownedScript = span.name === 'agentops.script' || span.name === 'agentops.script.step'
          || Boolean(scriptName || stepName);
        const exactSession = !ownedScript && conversationId === sessionId;
        const runLinkedScript = Boolean(ownedScript && options.runId && runId === options.runId);
        if (!exactSession && !runLinkedScript) continue;
        const startNanoseconds = timestampNanoseconds(span, 'start');
        const endNanoseconds = timestampNanoseconds(span, 'end');
        const start = startNanoseconds !== null
          ? Number(startNanoseconds) / 1000000
          : Array.isArray(span.startTime) ? flatMillisecondTime(span.startTime) : millisecondTime(span.startTimeUnixNano);
        const end = endNanoseconds !== null
          ? Number(endNanoseconds) / 1000000
          : Array.isArray(span.endTime) ? flatMillisecondTime(span.endTime) : millisecondTime(span.endTimeUnixNano);
        const durationNs = startNanoseconds !== null && endNanoseconds !== null && endNanoseconds >= startNanoseconds
          ? endNanoseconds - startNanoseconds
          : null;
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
          durationNs: durationNs?.toString() ?? null,
          durationMs: durationNs === null ? end - start : Number(durationNs) / 1000000,
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId || '',
          spanName: ownedScript && scriptName
            ? (stepName ? 'agentops.script.step' : 'agentops.script')
            : String(span.name || 'unknown'),
          operation: String(attributeValue(attributes, 'gen_ai.operation.name') || span.name || 'unknown'),
          toolName: String(attributeValue(attributes, 'gen_ai.tool.name') || ''),
          toolCallId: String(attributeValue(attributes, 'gen_ai.tool.call.id') || ''),
          // Legacy/display-only: falls back to the requested model when no response model was observed.
          // modelRequested/modelActual below are the fields that assert actual request/response identity.
          model: String(attributeValue(attributes, 'gen_ai.response.model') || attributeValue(attributes, 'gen_ai.request.model') || ''),
          modelRequested: String(attributeValue(attributes, 'gen_ai.request.model') || ''),
          modelActual: String(attributeValue(attributes, 'gen_ai.response.model') || ''),
          provider: String(attributeValue(attributes, 'gen_ai.provider.name') || ''),
          agent: String(attributeValue(attributes, 'gen_ai.agent.name') || attributeValue(attributes, 'agentops.agent.name') || 'native OTel'),
          scriptName,
          stepName,
          scriptRuntimeName: String(attributeValue(attributes, 'agentops.script.runtime.name') || ''),
          scriptRuntimeVersion: String(attributeValue(attributes, 'agentops.script.runtime.version') || ''),
          scriptRuntimeImplementation: String(attributeValue(attributes, 'agentops.script.runtime.implementation') || ''),
          scriptLoaderName: String(attributeValue(attributes, 'agentops.script.loader.name') || ''),
          match: exactSession ? 'exact-session' : 'run-linked-script',
          runId: String(runId || (exactSession ? options.runId : '') || ''),
          sessionId: String(conversationId || (exactSession ? sessionId : '') || ''),
          errorType: String(attributeValue(attributes, 'error.type') || ''),
          // Null (not 0) when the attribute was never reported, so "unmeasured" stays
          // distinguishable from a genuinely measured zero all the way through the ledger.
          inputTokens: numericAttributeOrNull(attributes, 'gen_ai.usage.input_tokens'),
          outputTokens: numericAttributeOrNull(attributes, 'gen_ai.usage.output_tokens'),
          cacheReadTokens: numericAttributeOrNull(attributes, 'gen_ai.usage.cache_read.input_tokens'),
          cacheWriteTokens: numericAttributeOrNull(attributes, 'gen_ai.usage.cache_creation.input_tokens'),
          failed: Number(span.status?.code) === 2 || Boolean(attributeValue(attributes, 'error.type')),
          events,
          sourceFile: path.basename(file)
        });
      }
    }
  }
  return { spans, files, invalid, unsupported };
}

module.exports = { decodeOtlpProtobuf, defaultReceiptFiles, readSessionOtelSpans };
