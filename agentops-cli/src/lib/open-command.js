const path = require('node:path');

const legacy = require('../legacy');
const { firstPositional, hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const {
  nativeOpenResult,
  readNativeReceiptFromArgs,
  renderNativeReceipt
} = require('./native-receipt');
const { openV2FromFiles, renderOpenV2, v2OpenLinksForRun } = require('./v2-open-links');

function openCommand(args = []) {
  if (!optionValue(args, '--runs')) {
    const native = readNativeReceiptFromArgs(args);
    const shouldUseNative = native.recognized || ['env', 'default'].includes(native.selected_by);
    if (shouldUseNative) {
      const result = nativeOpenResult(native, legacy.openLinksSummary());
      writeJsonOrRender(result, hasFlag(args, '--json'), renderNativeReceipt);
      return;
    }

    const summary = legacy.latestSummaryFromArgs(args);
    const links = legacy.openLinksSummary(summary);
    writeJsonOrRender(links, hasFlag(args, '--json'), legacy.renderOpenLinks);
    return;
  }

  const result = openV2FromFiles({
    runId: firstPositional(args),
    runsFile: path.resolve(optionValue(args, '--runs'))
  });
  writeJsonOrRender(result, hasFlag(args, '--json'), renderOpenV2);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  firstPositional,
  openCommand,
  openV2FromFiles,
  nativeOpenResult,
  readNativeReceiptFromArgs,
  renderNativeReceipt,
  renderOpenV2,
  v2OpenLinksForRun
};
