function parseBenchmarkFixturePackArgs(args) {
  const fixtureDir = args[0];
  if (!fixtureDir) throw new Error('benchmark fixture-pack requires a fixture directory');

  const options = { fixtureDir };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--id') {
      if (!args[index + 1]) throw new Error('--id requires a value');
      options.id = args[index + 1];
      index += 1;
    } else if (arg === '--title') {
      if (!args[index + 1]) throw new Error('--title requires a value');
      options.title = args[index + 1];
      index += 1;
    } else if (arg === '--fixture') {
      if (!args[index + 1]) throw new Error('--fixture requires a suite-relative fixture path');
      options.fixture = args[index + 1];
      index += 1;
    } else if (arg === '--output') {
      if (!args[index + 1]) throw new Error('--output requires a path');
      options.output = args[index + 1];
      index += 1;
    } else if (arg === '--sign-key-id') {
      if (!args[index + 1]) throw new Error('--sign-key-id requires a value');
      options.signKeyId = args[index + 1];
      index += 1;
    } else if (arg === '--sign-private-key') {
      if (!args[index + 1]) throw new Error('--sign-private-key requires a path');
      options.signPrivateKey = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark fixture-pack option: ${arg}`);
    }
  }

  if (typeof options.id !== 'string' || options.id.trim() === '') {
    throw new Error('benchmark fixture-pack requires --id <id>');
  }
  return options;
}

function parseBenchmarkRunArgs(args) {
  const suite = args[0];
  if (!suite) throw new Error('benchmark run requires a suite');

  const options = {
    suite,
    repeat: 1,
    dryRun: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--variant') {
      options.variant = args[index + 1];
      index += 1;
    } else if (arg === '--repeat') {
      options.repeat = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--hypothesis') {
      options.hypothesis = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark run option: ${arg}`);
    }
  }

  if (!options.variant) throw new Error('benchmark run requires --variant <name>');
  if (!Number.isInteger(options.repeat) || options.repeat <= 0) {
    throw new Error('--repeat must be a positive integer');
  }

  return options;
}

function parseBenchmarkReportArgs(args, options = {}) {
  const runId = args[0];
  if (!runId) throw new Error('benchmark report requires a run id');

  const result = {
    runId,
    azure: false,
    last: '24h',
    verifyExternalReview: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--azure') {
      result.azure = true;
    } else if (arg === '--verify-external-review') {
      result.verifyExternalReview = true;
    } else if (arg === '--approval-file') {
      if (!args[index + 1]) throw new Error('--approval-file requires a path');
      result.approvalFile = args[index + 1];
      index += 1;
    } else if (arg === '--last') {
      if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
      result.last = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark report option: ${arg}`);
    }
  }

  if (result.azure) (options.validateDuration || (value => value))(result.last);
  return result;
}

function parseBenchmarkCompareArgs(args, options = {}) {
  const beforeRunId = args[0];
  const afterRunId = args[1];
  if (!beforeRunId || !afterRunId) throw new Error('benchmark compare requires before and after run ids');

  const result = {
    beforeRunId,
    afterRunId,
    azure: false,
    last: '24h',
    verifyExternalReview: false
  };

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--azure') {
      result.azure = true;
    } else if (arg === '--verify-external-review') {
      result.verifyExternalReview = true;
    } else if (arg === '--approval-file') {
      if (!args[index + 1]) throw new Error('--approval-file requires a path');
      result.approvalFile = args[index + 1];
      index += 1;
    } else if (arg === '--last') {
      if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
      result.last = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark compare option: ${arg}`);
    }
  }

  if (result.azure) (options.validateDuration || (value => value))(result.last);
  return result;
}

function parseBenchmarkApproveArgs(args) {
  const runId = args[0];
  if (!runId) throw new Error('benchmark approve requires a run id');

  const options = {
    runId,
    approvedBy: [],
    status: 'approved'
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--by') {
      if (!args[index + 1]) throw new Error('--by requires a name');
      options.approvedBy.push(args[index + 1]);
      index += 1;
    } else if (arg === '--ticket') {
      if (!args[index + 1]) throw new Error('--ticket requires a value');
      options.ticket = args[index + 1];
      index += 1;
    } else if (arg === '--status') {
      if (!args[index + 1]) throw new Error('--status requires approved, pending, or rejected');
      options.status = args[index + 1];
      index += 1;
    } else if (arg === '--review-system') {
      if (!args[index + 1]) throw new Error('--review-system requires a value');
      options.externalReview = options.externalReview || {};
      options.externalReview.system = args[index + 1];
      index += 1;
    } else if (arg === '--review-id') {
      if (!args[index + 1]) throw new Error('--review-id requires a value');
      options.externalReview = options.externalReview || {};
      options.externalReview.id = args[index + 1];
      index += 1;
    } else if (arg === '--review-url') {
      if (!args[index + 1]) throw new Error('--review-url requires a value');
      options.externalReview = options.externalReview || {};
      options.externalReview.url = args[index + 1];
      index += 1;
    } else if (arg === '--review-status') {
      if (!args[index + 1]) throw new Error('--review-status requires approved, pending, or rejected');
      options.externalReview = options.externalReview || {};
      options.externalReview.status = args[index + 1];
      index += 1;
    } else if (arg === '--approved-at') {
      if (!args[index + 1]) throw new Error('--approved-at requires an ISO timestamp');
      options.approvedAt = args[index + 1];
      index += 1;
    } else if (arg === '--output') {
      if (!args[index + 1]) throw new Error('--output requires a path');
      options.output = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark approve option: ${arg}`);
    }
  }

  if (!['approved', 'pending', 'rejected'].includes(options.status)) {
    throw new Error('--status must be approved, pending, or rejected');
  }
  if (options.externalReview?.status !== undefined && !['approved', 'pending', 'rejected'].includes(options.externalReview.status)) {
    throw new Error('--review-status must be approved, pending, or rejected');
  }
  if (options.status === 'approved' && options.approvedBy.length === 0) {
    throw new Error('benchmark approve requires at least one --by approver');
  }
  return options;
}

function parseBenchmarkArtifactsArgs(args) {
  const runId = args[0];
  if (!runId) throw new Error('benchmark artifacts requires a run id');

  const options = {
    runId,
    includeContent: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--task') {
      if (!args[index + 1]) throw new Error('--task requires a task id');
      options.taskId = args[index + 1];
      index += 1;
    } else if (arg === '--repeat') {
      if (!args[index + 1]) throw new Error('--repeat requires a number');
      options.repeat = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--include-content') {
      options.includeContent = true;
    } else {
      throw new Error(`Unknown benchmark artifacts option: ${arg}`);
    }
  }

  if (options.repeat !== undefined && (!Number.isInteger(options.repeat) || options.repeat <= 0)) {
    throw new Error('--repeat must be a positive integer');
  }
  return options;
}

module.exports = {
  parseBenchmarkApproveArgs,
  parseBenchmarkArtifactsArgs,
  parseBenchmarkCompareArgs,
  parseBenchmarkFixturePackArgs,
  parseBenchmarkReportArgs,
  parseBenchmarkRunArgs
};
