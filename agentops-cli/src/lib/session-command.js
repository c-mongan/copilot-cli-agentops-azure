const sessionCommandNames = Object.freeze(['latest', 'live', 'tail', 'replay', 'explain', 'recommend', 'open']);

function createSessionCommand(dependencies = {}) {
  const {
    explainLatest,
    latestSummaryFromArgs,
    liveViewFromArgs,
    openLinksSummary,
    optionValue,
    parseLastArg,
    recommendationForExplanation,
    renderExplanation,
    renderLatest,
    renderLive,
    renderOpenLinks,
    renderRecommendation,
    renderReplay,
    replayTimeline,
    runAzureLogAnalyticsQuery,
    sessionQuery,
    sleep,
    spanRowsFromSource,
    stdout = process.stdout,
    validateKqlDuration
  } = dependencies;

  async function liveCommand(args) {
    const intervalIndex = args.indexOf('--interval');
    const intervalSec = intervalIndex === -1 ? 5 : Number(args[intervalIndex + 1]);
    if (intervalIndex !== -1 && (!Number.isFinite(intervalSec) || intervalSec <= 0)) {
      throw new Error('--interval must be a positive number of seconds');
    }
    const follow = args.includes('--follow');
    do {
      stdout.write(renderLive(liveViewFromArgs(args)));
      if (!follow) return;
      await sleep(intervalSec * 1000);
    } while (follow);
  }

  function replayCommand(args) {
    const sessionId = args[0];
    if (!sessionId) throw new Error('replay requires a session id or latest');
    const replayArgs = args.slice(1);
    let source;
    if (sessionId === 'latest' || optionValue(replayArgs, ['--file', '--jsonl'])) {
      source = spanRowsFromSource(replayArgs, '7d');
    } else {
      const last = validateKqlDuration(parseLastArg(replayArgs, '7d'));
      const query = sessionQuery(sessionId, last);
      const result = runAzureLogAnalyticsQuery(query);
      source = { mode: 'azure', last, rows: result.ok ? result.rows : [], query, error: result.ok ? null : result.error };
    }
    if (source.error) {
      stdout.write(`Session replay: ${sessionId}\n\nCould not read telemetry: ${source.error}\n`);
      return;
    }
    stdout.write(renderReplay(replayTimeline(source.rows, { sessionId, source: source.mode })));
  }

  async function sessionCommand(command, args) {
    if (command === 'latest') {
      stdout.write(renderLatest(latestSummaryFromArgs(args)));
      return;
    }
    if (command === 'live' || command === 'tail') {
      await liveCommand(args);
      return;
    }
    if (command === 'replay') {
      replayCommand(args);
      return;
    }
    if (command === 'explain') {
      if (args[0] !== 'latest') throw new Error('explain currently supports: explain latest');
      stdout.write(renderExplanation(explainLatest(latestSummaryFromArgs(args.slice(1)))));
      return;
    }
    if (command === 'recommend') {
      if (args[0] !== 'latest') throw new Error('recommend currently supports: recommend latest');
      const recommendArgs = args.slice(1);
      const summary = latestSummaryFromArgs(recommendArgs);
      const last = parseLastArg(recommendArgs, '7d');
      stdout.write(renderRecommendation(recommendationForExplanation(explainLatest(summary), { last })));
      return;
    }
    if (command === 'open') {
      stdout.write(renderOpenLinks(openLinksSummary(latestSummaryFromArgs(args))));
      return;
    }
    throw new Error(`Unknown session command: ${command}`);
  }

  return {
    sessionCommand,
    sessionCommandNames
  };
}

module.exports = {
  createSessionCommand
};
