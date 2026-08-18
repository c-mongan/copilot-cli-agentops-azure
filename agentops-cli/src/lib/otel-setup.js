const net = require('node:net');
const { otlpHttpEndpoint } = require('./collector-endpoints');

function parseOtelSetupArgs(args = []) {
  const options = {
    endpoint: otlpHttpEndpoint,
    serviceName: 'github-copilot',
    shell: 'bash',
    captureContent: false,
    unsafeDirect: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--endpoint') {
      if (!args[index + 1]) throw new Error('--endpoint requires a URL');
      options.endpoint = args[index + 1];
      index += 1;
    } else if (arg === '--service-name') {
      if (!args[index + 1]) throw new Error('--service-name requires a value');
      options.serviceName = args[index + 1];
      index += 1;
    } else if (arg === '--shell') {
      if (!args[index + 1]) throw new Error('--shell requires bash, powershell, or json');
      options.shell = args[index + 1];
      index += 1;
    } else if (arg === '--capture-content') {
      options.captureContent = true;
    } else if (arg === '--unsafe-direct') {
      options.unsafeDirect = true;
    } else {
      throw new Error(`Unknown otel-setup option: ${arg}`);
    }
  }
  if (!['bash', 'powershell', 'json'].includes(options.shell)) {
    throw new Error('--shell must be bash, powershell, or json');
  }
  assertOtelEndpoint(options.endpoint, options.unsafeDirect);
  return options;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function classifyOtelEndpoint(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { classification: 'malformed', reason: 'endpoint must be a non-empty URL' };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    return { classification: 'malformed', reason: 'endpoint is not a valid URL' };
  }

  if (parsed.protocol === 'file:') {
    return { classification: 'file', protocol: parsed.protocol, hostname: parsed.hostname };
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
    return { classification: 'malformed', reason: 'endpoint must be an HTTP(S) URL without embedded credentials' };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { classification: 'loopback', protocol: parsed.protocol, hostname };
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    const octets = hostname.split('.').map(Number);
    if (octets[0] === 127) {
      return { classification: 'loopback', protocol: parsed.protocol, hostname };
    }
    if (octets[0] === 169 && octets[1] === 254) {
      return { classification: 'link-local', protocol: parsed.protocol, hostname };
    }
  } else if (ipVersion === 6) {
    if (hostname === '::1') {
      return { classification: 'loopback', protocol: parsed.protocol, hostname };
    }
    const firstHextet = Number.parseInt(hostname.split(':')[0] || '0', 16);
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) {
      return { classification: 'link-local', protocol: parsed.protocol, hostname };
    }
  }

  return { classification: 'public', protocol: parsed.protocol, hostname };
}

function assertOtelEndpoint(endpoint, unsafeDirect = false) {
  const policy = classifyOtelEndpoint(endpoint);
  if (policy.classification !== 'loopback' && !unsafeDirect) {
    throw new Error(
      `OTLP endpoint classified as ${policy.classification}; only loopback endpoints are allowed by default. `
      + 'Use --unsafe-direct to explicitly opt in to a direct endpoint.'
    );
  }
  return policy;
}

function buildOtelSetup(options = {}) {
  const endpoint = options.endpoint || otlpHttpEndpoint;
  const serviceName = options.serviceName || 'github-copilot';
  const captureContent = Boolean(options.captureContent);
  const unsafeDirect = Boolean(options.unsafeDirect);
  const endpointPolicy = assertOtelEndpoint(endpoint, unsafeDirect);
  const resourceAttributes = [
    'agent.framework=github-copilot',
    `agent.runtime=${serviceName}`,
    'agentops.profile=bring-your-own-otel'
  ].join(',');
  const nativeEnv = {
    COPILOT_OTEL_ENABLED: 'true',
    COPILOT_OTEL_EXPORTER_TYPE: 'otlp-http',
    COPILOT_OTEL_SOURCE_NAME: 'github.copilot',
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_SERVICE_NAME: serviceName,
    OTEL_RESOURCE_ATTRIBUTES: resourceAttributes,
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: captureContent ? 'true' : 'false'
  };
  const env = {
    ...nativeEnv,
    // Retain the old shape for consumers that inspect JSON, but do not render these aliases.
    COPILOT_OTEL_ENDPOINT: endpoint,
    COPILOT_OTEL_CAPTURE_CONTENT: captureContent ? 'true' : 'false'
  };
  const vscode = {
    'github.copilot.chat.otel.enabled': true,
    'github.copilot.chat.otel.exporterType': 'otlp-http',
    'github.copilot.chat.otel.otlpEndpoint': endpoint,
    'github.copilot.chat.otel.captureContent': captureContent,
    'github.copilot.chat.otel.maxAttributeSizeChars': 0,
    'github.copilot.chat.otel.dbSpanExporter.enabled': false
  };
  const fileExport = {
    vscode: {
      'github.copilot.chat.otel.enabled': true,
      'github.copilot.chat.otel.exporterType': 'file',
      'github.copilot.chat.otel.outfile': './copilot-otel.jsonl',
      'github.copilot.chat.otel.captureContent': captureContent
    },
    env: {
      COPILOT_OTEL_ENABLED: 'true',
      COPILOT_OTEL_EXPORTER_TYPE: 'file',
      COPILOT_OTEL_FILE_EXPORTER_PATH: './copilot-otel.jsonl',
      COPILOT_OTEL_SOURCE_NAME: 'github.copilot',
      OTEL_SERVICE_NAME: serviceName,
      OTEL_RESOURCE_ATTRIBUTES: resourceAttributes,
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: captureContent ? 'true' : 'false',
      COPILOT_OTEL_CAPTURE_CONTENT: captureContent ? 'true' : 'false'
    }
  };
  const sessionExport = {
    remoteExport: false,
    cliFlag: '--no-remote-export',
    settingsPath: '~/.copilot/settings.json',
    settings: { remoteExport: false }
  };
  const sdkTypescript = `import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({
  telemetry: {
    otlpEndpoint: "${endpoint}",
    exporterType: "otlp-http",
    sourceName: "github.copilot",
    captureContent: ${captureContent}
  }
});`;

  return {
    endpoint,
    serviceName,
    captureContent,
    unsafeDirect,
    endpointPolicy,
    nativeEnv,
    env,
    vscode,
    fileExport,
    sessionExport,
    sdkTypescript
  };
}

function renderOtelSetup(setup, options = {}) {
  if (options.shell === 'json') return `${JSON.stringify(setup, null, 2)}\n`;
  const lines = [
    'AgentOps bring-your-own-OTel setup',
    '',
    'VS Code settings.json:',
    JSON.stringify(setup.vscode, null, 2),
    '',
    'Copilot CLI native OTel environment:'
  ];

  if (options.shell === 'powershell') {
    for (const [key, value] of Object.entries(setup.nativeEnv || setup.env)) {
      lines.push(`$env:${key} = "${String(value).replace(/"/g, '`"')}"`);
    }
  } else {
    for (const [key, value] of Object.entries(setup.nativeEnv || setup.env)) {
      lines.push(`export ${key}=${shellQuote(value)}`);
    }
  }

  lines.push(
    '',
    'Copilot SDK TypeScript:',
    setup.sdkTypescript,
    '',
    'Optional JSONL file export for offline review:',
    JSON.stringify(setup.fileExport, null, 2),
    '',
    'Run Copilot with the environment above and use your OTLP/HTTP collector as the destination.',
    'agentops compat-check --last 2h',
    '',
    'Session export controls are separate from OTel; --no-remote is not proof that session data cannot be exported.',
    'For a session-local run, use copilot --no-remote-export or set {"remoteExport": false} in ~/.copilot/settings.json.',
    'The direct-endpoint safety policy is loopback-only by default; use --unsafe-direct only when you have reviewed the destination.'
  );

  return `${lines.join('\n')}\n`;
}

module.exports = {
  assertOtelEndpoint,
  buildOtelSetup,
  classifyOtelEndpoint,
  parseOtelSetupArgs,
  renderOtelSetup
};
