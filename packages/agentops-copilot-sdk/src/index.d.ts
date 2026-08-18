export type AgentOpsEvent = Record<string, unknown>;

/** Local exporter state. Collector acceptance does not prove downstream or Azure ingestion. */
export interface AgentOpsDeliveryStatus {
  queuedInMemory: number;
  collectorAccepted: number;
  retryAttempts: number;
  terminalFailures: number;
  pendingInMemory: number;
  queueOverflowed: number;
  lastCollectorAcceptedAt: string | null;
  maxPendingEvents: number;
}

export interface AgentOpsClientOptions {
  otlpEndpoint?: string;
  exporterType?: string;
  otlpProtocol?: 'http/json' | 'http/protobuf';
  filePath?: string;
  sourceName?: string;
  serviceName?: string;
  captureContent?: boolean;
  telemetry?: Record<string, unknown>;
  privacyMode?: 'strict' | 'compat' | 'unsafe';
  runId?: string;
  sessionId?: string;
  traceId?: string;
  usdPerCostUnit?: number;
  hooks?: Record<string, (...args: unknown[]) => unknown>;
  emit?: (event: AgentOpsEvent) => void;
  onGetTraceContext?: () => Record<string, string>;
  exportOrderedEvents?: boolean;
  exportTimeoutMs?: number;
  onExportError?: (error: Error) => void;
  onInstrumentationError?: (error: Error) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxPendingEvents?: number;
}

export interface AgentOpsSessionObserver {
  attach(session: { on(handler: (event: unknown) => void): unknown }): () => void;
  observe(event: { id?: string; timestamp?: string; parentId?: string; type: string; data?: Record<string, unknown> }): AgentOpsEvent;
  context: Record<string, string>;
  eventTypes: string[];
}

export function createAgentOpsClientOptions(options?: AgentOpsClientOptions): Record<string, unknown>;
export function createAgentOpsCopilotClient<T>(CopilotClient: new (options: Record<string, unknown>) => T, options?: AgentOpsClientOptions): T & {
  agentops: Record<string, unknown>;
  agentopsHooks: Record<string, (...args: unknown[]) => unknown>;
  agentopsObserver: AgentOpsSessionObserver;
  agentopsDeliveryStatus(): AgentOpsDeliveryStatus;
  createAgentOpsSessionConfig(config?: Record<string, unknown>): Record<string, unknown>;
  observeAgentOpsSession(session: { on(handler: (event: unknown) => void): unknown }): () => void;
  createAgentOpsSession(config?: Record<string, unknown>): Promise<unknown>;
  resumeAgentOpsSession(sessionId: string, config?: Record<string, unknown>): Promise<unknown>;
  flushAgentOpsTelemetry(): Promise<AgentOpsDeliveryStatus>;
};
export function createAgentOpsHooks(options?: AgentOpsClientOptions): Record<string, (...args: unknown[]) => unknown>;
export function createAgentOpsSessionObserver(options?: AgentOpsClientOptions): AgentOpsSessionObserver;
export function createOtlpJsonExporter(options?: AgentOpsClientOptions): { emit(event: AgentOpsEvent): AgentOpsEvent; flush(): Promise<AgentOpsDeliveryStatus>; deliveryStatus(): AgentOpsDeliveryStatus; endpoint: string };
export function createSafeEventNormalizer(options?: { context?: AgentOpsEvent }): (event: AgentOpsEvent) => AgentOpsEvent;
export const otelAttributeMap: Record<string, string>;
export const safeEventFields: Set<string>;
export const sessionEventTypes: string[];
export function composeHooks(agentOpsHooks?: Record<string, (...args: unknown[]) => unknown>, userHooks?: Record<string, (...args: unknown[]) => unknown>): Record<string, (...args: unknown[]) => unknown>;
export function composeEventHandlers(agentOpsHandler: (event: unknown) => unknown, userHandler?: (event: unknown) => unknown, onInstrumentationError?: (error: Error) => void): (event: unknown) => unknown;
export function denyPermissionsByDefault(): { kind: 'reject'; feedback: string };
export function createTelemetryConfig(options?: AgentOpsClientOptions): Record<string, unknown>;
export function createTraceContext(): { traceparent: string; tracestate?: string };
export function createTraceContextCallback(existing?: () => Record<string, string>, traceSeed?: unknown): () => Record<string, string>;
export function traceIdHex(seed?: unknown): string;
export function stableHash(value: unknown, prefix?: string): string;
