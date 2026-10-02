#!/usr/bin/env node
'use strict';

// Local-only, read-only MCP fixture. The caller cannot select a path: the
// server reads the pinned synthetic StockPilot CSV beside this file, and it
// never exposes write or network operations.
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');

const MAX_LINE_BYTES = 64 * 1024;
const MAX_DATA_BYTES = 1024 * 1024;
const STOCK_FILE = path.resolve(__dirname, '../data/stock_levels.csv');
const WAREHOUSES = new Set(['WH-EAST', 'WH-WEST', 'WH-CENTRAL']);
const tools = [
  {
    name: 'stock_snapshot',
    description: 'Return the latest synthetic on-hand snapshot for one exact SKU and warehouse.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', pattern: '^SKU-[0-9]{4}$', maxLength: 8 },
        warehouse: { type: 'string', enum: [...WAREHOUSES] }
      },
      required: ['sku', 'warehouse'],
      additionalProperties: false
    }
  },
  {
    name: 'unavailable_snapshot',
    description: 'Return a planted synthetic read failure for failure-path observation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
];

function protocolError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function validateObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

function latestStock({ sku, warehouse }) {
  if (typeof sku !== 'string' || !/^SKU-[0-9]{4}$/.test(sku)
    || typeof warehouse !== 'string' || !WAREHOUSES.has(warehouse)) {
    throw new TypeError('sku and warehouse must match the synthetic fixture schema');
  }
  const stat = fs.lstatSync(STOCK_FILE);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DATA_BYTES) {
    throw new Error('synthetic stock source is unavailable or exceeds 1 MiB');
  }
  const lines = fs.readFileSync(STOCK_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.shift() !== 'date,sku,warehouse,on_hand') throw new Error('synthetic stock source schema mismatch');
  let latest = null;
  for (const line of lines) {
    const fields = line.split(',');
    if (fields.length !== 4) throw new Error('synthetic stock source contains a malformed row');
    const [date, rowSku, rowWarehouse, rawOnHand] = fields;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^-?\d+$/.test(rawOnHand)) {
      throw new Error('synthetic stock source contains a malformed row');
    }
    if (rowSku === sku && rowWarehouse === warehouse && (!latest || date > latest.observed_on)) {
      latest = { synthetic: true, sku, warehouse, observed_on: date, on_hand: Number(rawOnHand), source: 'stock_levels.csv' };
    }
  }
  return latest;
}

function respond(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0'
    || typeof message.method !== 'string') {
    return protocolError(null, -32600, 'Invalid request');
  }
  if (!Object.hasOwn(message, 'id')) return null;
  const id = message.id;
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'stockpilot-readonly', version: '1.0.0' }
      }
    };
  }
  if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } };
  if (message.method !== 'tools/call') return protocolError(id, -32601, 'Method not found');

  const params = message.params;
  // MCP request metadata belongs beside arguments. Runtime tracing/progress
  // clients may add it; it never selects fixture data or enters the response.
  const meta = params?._meta;
  if (!validateObject(params, ['name', 'arguments', '_meta']) || typeof params.name !== 'string'
    || (meta !== undefined && (!meta || typeof meta !== 'object' || Array.isArray(meta)))
    || (meta?.progressToken !== undefined && typeof meta.progressToken !== 'string'
      && !(typeof meta.progressToken === 'number' && Number.isFinite(meta.progressToken)))) {
    return protocolError(id, -32602, 'Invalid tool or arguments');
  }
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!validateObject(args, params.name === 'stock_snapshot' ? ['sku', 'warehouse'] : [])) {
    return protocolError(id, -32602, 'Invalid tool or arguments');
  }
  if (params.name === 'unavailable_snapshot') {
    return {
      jsonrpc: '2.0', id,
      result: { content: [{ type: 'text', text: 'SYNTHETIC_STOCK_SOURCE_UNAVAILABLE' }], isError: true }
    };
  }
  if (params.name !== 'stock_snapshot' || Object.keys(args).length !== 2) {
    return protocolError(id, -32602, 'Invalid tool or arguments');
  }
  if (typeof args.sku !== 'string' || !/^SKU-[0-9]{4}$/.test(args.sku)
    || typeof args.warehouse !== 'string' || !WAREHOUSES.has(args.warehouse)) {
    return protocolError(id, -32602, 'Invalid tool or arguments');
  }
  try {
    const snapshot = latestStock(args);
    if (!snapshot) {
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: 'SYNTHETIC_STOCK_NOT_FOUND' }], isError: true }
      };
    }
    return {
      jsonrpc: '2.0', id,
      result: { content: [{ type: 'text', text: JSON.stringify(snapshot) }], structuredContent: snapshot, isError: false }
    };
  } catch {
    return {
      jsonrpc: '2.0', id,
      result: { content: [{ type: 'text', text: 'SYNTHETIC_STOCK_SOURCE_INVALID' }], isError: true }
    };
  }
}

function serve(input, output) {
  let pending = Buffer.alloc(0);
  const processLine = line => {
    if (!line.trim()) return;
    let reply;
    try {
      reply = respond(JSON.parse(line));
    } catch {
      reply = protocolError(null, -32700, 'Parse error');
    }
    if (reply) output.write(`${JSON.stringify(reply)}\n`);
  };
  const lines = new Transform({
    transform(chunk, _encoding, callback) {
      pending = Buffer.concat([pending, chunk]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) {
        if (newline > MAX_LINE_BYTES) return callback(new Error('MCP line exceeds 64 KiB'));
        processLine(pending.subarray(0, newline).toString('utf8'));
        pending = pending.subarray(newline + 1);
      }
      if (pending.length > MAX_LINE_BYTES) return callback(new Error('MCP line exceeds 64 KiB'));
      callback();
    },
    flush(callback) {
      if (pending.length > MAX_LINE_BYTES) return callback(new Error('MCP line exceeds 64 KiB'));
      processLine(pending.toString('utf8'));
      callback();
    }
  });
  input.pipe(lines);
  return lines;
}

if (require.main === module) {
  serve(process.stdin, process.stdout).on('error', error => {
    console.error(error.message);
    process.exitCode = 1;
    process.stdin.destroy();
  });
}

module.exports = { MAX_DATA_BYTES, MAX_LINE_BYTES, STOCK_FILE, latestStock, respond, serve, tools };
