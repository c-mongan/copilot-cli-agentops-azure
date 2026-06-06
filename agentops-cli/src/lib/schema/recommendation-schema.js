const RECOMMENDATION_SCHEMA_VERSION = 'agentops.recommendation-row.v1';

const requiredFields = [
  'TimeGenerated',
  'RecommendationId',
  'Action',
  'Severity',
  'ObservedPattern',
  'NextAction',
  'DashboardTitles',
  'DashboardCount',
  'Validation',
  'RollbackCondition'
];

const fieldTypes = {
  TimeGenerated: 'string',
  SchemaVersion: 'string',
  RecommendationId: 'string',
  RunId: 'string',
  SessionId: 'string',
  TraceId: 'string',
  Action: 'string',
  Severity: 'string',
  ObservedPattern: 'string',
  NextAction: 'string',
  PatternId: 'string',
  PatternKey: 'string',
  PatternDimension: 'string',
  EvalBucket: 'string',
  BenchmarkRunId: 'string',
  BenchmarkDecision: 'string',
  BenchmarkApprovalStatus: 'string',
  BenchmarkApprovalApprovedAt: 'string',
  BenchmarkApprovalTicket: 'string',
  BenchmarkApprovalSource: 'string',
  DashboardCount: 'number',
  RollbackCondition: 'string'
};

const arrayFields = [
  'BenchmarkArtifactFiles',
  'BenchmarkArtifactContentDiffs',
  'BenchmarkHiddenCheckPacks',
  'BenchmarkPolicyTasks',
  'BenchmarkSemanticChecks',
  'ChangeAnnotations',
  'ChangeTargetRefs',
  'DashboardTitles',
  'Validation'
];

const objectFields = [
  'AfterTelemetry',
  'BeforeTelemetry',
  'BenchmarkPermissionProfiles',
  'ExpectedMetricMovement',
  'ObservedMetricMovement',
  'OperatorReview'
];

const numericFields = [
  'PatternRuns',
  'EvalOverall',
  'BenchmarkPassRatePct',
  'BenchmarkAverageScore',
  'BenchmarkSafetyViolationCount',
  'BenchmarkToolFailures',
  'BenchmarkArtifactAdded',
  'BenchmarkArtifactModified',
  'BenchmarkArtifactDeleted',
  'BenchmarkArtifactTotalChanged',
  'BenchmarkHiddenChecksPassed',
  'BenchmarkHiddenChecksFailed',
  'BenchmarkPolicyBlocks',
  'BenchmarkSemanticCheckCount',
  'BenchmarkSemanticAverageScore',
  'BenchmarkApprovalCount',
  'BenchmarkRequiredApprovals',
  'DashboardCount'
];

const allowedSeverity = ['critical', 'high', 'medium', 'low'];

const forbiddenRawContentFields = [
  'Prompt',
  'Response',
  'ToolArguments',
  'ToolResult',
  'SecretValue',
  'UrlContent',
  'FileContent',
  'SourceCode'
];

function hasValue(value) {
  return value !== undefined && value !== null && String(value) !== '';
}

function isNullableNumber(value) {
  return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function validateRecommendationRow(row = {}) {
  const errors = [];
  const warnings = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, errors: ['recommendation row must be an object'], warnings };
  }

  for (const field of requiredFields) {
    if (!hasValue(row[field])) errors.push(`missing required recommendation field: ${field}`);
  }

  for (const [field, type] of Object.entries(fieldTypes)) {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== type) {
      errors.push(`${field} must be ${type}`);
    }
  }

  for (const field of numericFields) {
    if (!isNullableNumber(row[field])) errors.push(`${field} must be a number or null`);
  }

  for (const field of arrayFields) {
    if (row[field] !== undefined && !Array.isArray(row[field])) errors.push(`${field} must be an array`);
  }

  for (const field of objectFields) {
    if (row[field] !== undefined && (row[field] === null || typeof row[field] !== 'object' || Array.isArray(row[field]))) {
      errors.push(`${field} must be an object`);
    }
  }

  if (hasValue(row.Severity) && !allowedSeverity.includes(String(row.Severity))) {
    errors.push(`Severity=${row.Severity} must be one of ${allowedSeverity.join(', ')}`);
  }

  if (Array.isArray(row.DashboardTitles) && typeof row.DashboardCount === 'number' && row.DashboardCount !== row.DashboardTitles.length) {
    errors.push('DashboardCount must match DashboardTitles length');
  }

  for (const field of forbiddenRawContentFields) {
    if (hasValue(row[field])) errors.push(`recommendation rows must not export raw content field: ${field}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function recommendationSchemaDocument() {
  return {
    version: RECOMMENDATION_SCHEMA_VERSION,
    table: 'AgentOpsRecommendations_CL',
    required_fields: requiredFields,
    field_types: fieldTypes,
    numeric_fields: numericFields,
    array_fields: arrayFields,
    object_fields: objectFields,
    enums: {
      Severity: allowedSeverity
    },
    forbidden_raw_content_fields: forbiddenRawContentFields,
    privacy: 'metadata-only recommendation rows; no prompts, responses, tool arguments, tool results, secrets, URL contents, file contents, or source code'
  };
}

module.exports = {
  RECOMMENDATION_SCHEMA_VERSION,
  recommendationSchemaDocument,
  validateRecommendationRow
};
