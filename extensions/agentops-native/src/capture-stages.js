'use strict';

// Each stage is proved separately. A later stage never implies an earlier one,
// and no stage implies capture coverage or task success.
const STAGE_LABELS = {
  collector: 'Local Collector',
  nativeReceipt: 'Native Copilot receipt',
  scriptReceipt: 'Project script receipt',
  upload: 'Azure upload acceptance',
  cloudReadback: 'Azure cloud readback'
};
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function collectorStage({ connected, busy, stopReason } = {}) {
  if (busy) return { state: 'starting', detail: 'Capture setup is in progress.' };
  if (connected) return { state: 'ready', detail: 'Collector is listening on the loopback endpoint.' };
  if (['storage_limit', 'storage_scan_limit', 'storage_scan_unsafe'].includes(stopReason)) return { state: 'blocked', detail: 'Retained local storage blocks a new capture.' };
  if (stopReason === 'output_limit') return { state: 'stopped', detail: 'Stopped at the local output size limit.' };
  if (stopReason) return { state: 'stopped', detail: 'Collector stopped or could not start.' };
  return { state: 'off', detail: 'Collector is not running.' };
}

function nativeStage(report, reportError) {
  if (reportError) return { state: 'unknown', detail: 'The local receipt could not be read safely.' };
  if (!report) return { state: 'none', detail: 'No receipt exists for this capture.' };
  const spans = count(report.nativeSpanCount);
  if (spans === null) return { state: 'unknown', detail: 'The native span count is unavailable.' };
  return spans > 0 ? { state: 'received', detail: `${spans} native spans parsed locally.`, count: spans } : { state: 'none', detail: 'No supported native spans have been parsed yet.', count: 0 };
}

function scriptStage(report, reportError, script) {
  const run = !script ? 'No selected script has run in this window.'
    : script.started === false ? 'The selected script did not start.'
      : script.cancelled || script.signal ? 'The selected script stopped early.'
        : script.exitCode === 0 ? 'The selected script exited successfully.' : 'The selected script exited with an error.';
  if (reportError) return { state: 'unknown', detail: `${run} The local receipt could not be read safely.` };
  const spans = count(report?.librarySpanCount);
  if (spans === null) return { state: report ? 'unknown' : 'none', detail: report ? `${run} The library span count is unavailable.` : `${run} No receipt exists for this capture.` };
  return spans > 0 ? { state: 'received', detail: `${run} ${spans} library spans parsed locally.`, count: spans } : { state: 'none', detail: `${run} No library spans have been parsed yet.`, count: 0 };
}

function uploadStage(upload) {
  if (upload === 'unavailable') return { state: 'unavailable', detail: 'Azure publishing is unavailable here.' };
  if (!upload) return { state: 'not-attempted', detail: 'No Azure publish has run in this window.' };
  if (upload.failed) return { state: 'failed', detail: 'The last Azure publish did not complete.' };
  const accepted = count(upload.acknowledged), refused = count(upload.refused);
  if (accepted === null || refused === null) return { state: 'unknown', detail: 'The last Azure publish result is incomplete.' };
  return { state: accepted > 0 ? 'accepted' : 'none', detail: `Azure accepted ${accepted} metadata events. Refused: ${refused}.`, count: accepted };
}

function readbackStage(readback, upload) {
  if (upload === 'unavailable' || readback === 'unavailable') return { state: 'unavailable', detail: 'Azure cloud readback is unavailable here.' };
  if (!readback) return { state: 'unverified', detail: 'No cloud readback has run in this window.' };
  if (readback.failed) return { state: 'failed', detail: 'The last cloud readback did not complete.' };
  if (readback.state === 'denied') return { state: 'denied', detail: 'Log Analytics refused the read. The account needs Log Analytics Reader on the workspace.' };
  const expected = count(readback.expected), found = count(readback.found), mismatched = count(readback.mismatched);
  if (expected === null || found === null || mismatched === null) return { state: 'unknown', detail: 'The last cloud readback result is incomplete.' };
  const sample = readback.sampled ? ` Checked the latest ${expected} published events.` : '';
  if (readback.state === 'verified') return { state: 'verified', detail: `${found} of ${expected} published events were found with the expected typed fields.${sample}`, count: found };
  if (readback.state === 'mismatch') return { state: 'mismatch', detail: `Rows were found, but ${mismatched} did not match the expected typed fields, or extra rows were returned.${sample}`, count: found };
  if (readback.state === 'partial') return { state: 'partial', detail: `${found} of ${expected} published events were found. Ingestion can lag by several minutes. Try again later.${sample}`, count: found };
  if (readback.state === 'missing') return { state: 'pending', detail: `None of ${expected} published events were found yet. Ingestion can lag by several minutes. Try again later.${sample}`, count: 0 };
  return { state: 'unknown', detail: 'The last cloud readback result is incomplete.' };
}

function captureStages({ collector, report, reportError, script, upload, readback } = {}) {
  const stages = {
    collector: collectorStage(collector),
    nativeReceipt: nativeStage(report, reportError),
    scriptReceipt: scriptStage(report, reportError, script),
    upload: uploadStage(upload),
    // Readback comes only from the explicit typed Log Analytics query command.
    cloudReadback: readbackStage(readback, upload)
  };
  return Object.entries(stages).map(([id, stage]) => ({ id, label: STAGE_LABELS[id], ...stage }));
}

function stagesText(stages) {
  return stages.map(stage => `${stage.label}: ${stage.state}.`).join(' ');
}

module.exports = { captureStages, readbackStage, stagesText, STAGE_LABELS };
