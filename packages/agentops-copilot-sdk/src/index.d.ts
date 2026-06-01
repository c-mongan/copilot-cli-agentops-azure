export type AgentOpsEvent = Record<string, unknown>;

export interface AgentOpsClientOptions {
  otlpEndpoint?: string;
  exporterType?: string;
  sourceName?: string;
  captureContent?: boolean;
  telemetry?: Record<string, unknown>;
  privacyMode?: 'strict' | 'compat' | 'unsafe';
  runId?: string;
  sessionId?: string;
  traceId?: string;
  hooks?: Record<string, (...args: unknown[]) => unknown>;
  emit?: (event: AgentOpsEvent) => void;
  onGetTraceContext?: () => Record<string, string>;
}

export function createAgentOpsClientOptions(options?: AgentOpsClientOptions): Record<string, unknown>;
export function createAgentOpsCopilotClient<T>(CopilotClient: new (options: Record<string, unknown>) => T, options?: AgentOpsClientOptions): T;
export function createAgentOpsHooks(options?: AgentOpsClientOptions): Record<string, (...args: unknown[]) => unknown>;
export function composeHooks(agentOpsHooks?: Record<string, (...args: unknown[]) => unknown>, userHooks?: Record<string, (...args: unknown[]) => unknown>): Record<string, (...args: unknown[]) => unknown>;
export function createTelemetryConfig(options?: AgentOpsClientOptions): Record<string, unknown>;
export function createTraceContext(): { traceparent: string; tracestate?: string };
export function createTraceContextCallback(existing?: () => Record<string, string>): () => Record<string, string>;
export function stableHash(value: unknown, prefix?: string): string;
