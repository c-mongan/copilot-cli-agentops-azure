const deliveryText = Object.freeze({
  local_pending: 'Run receipt saved locally · waiting for Azure',
  azure_acknowledged: 'Run receipt accepted by Azure · visibility may take a few minutes',
  overflow: 'NOT SAVED · local delivery queue is full',
  expired: 'Not sent · retry time expired · held locally',
  quarantined: 'Held locally · needs review',
  native_best_effort: 'Best effort · delivery not yet confirmed',
  unobserved: 'Not observed · collector unavailable'
});

function receiptDeliveryText(state = 'native_best_effort') {
  return deliveryText[state] || deliveryText.native_best_effort;
}

function deliveryStateFromEnqueue(result = {}) {
  if (result.status === 'pending' || result.status === 'deduplicated') return 'local_pending';
  if (result.status === 'overflow') return 'overflow';
  if (result.status === 'expired') return 'expired';
  if (result.status === 'quarantined') return 'quarantined';
  return 'native_best_effort';
}

function summarizeDeliveryStatus(status = null) {
  if (!status) return {
    state: 'native_best_effort',
    headline: 'Native Copilot telemetry is best effort; delivery is not confirmed.'
  };
  const pending = Number(status.pending || 0) + Number(status.uploading || 0);
  const quarantined = Number(status.quarantined || 0);
  const expired = Number(status.expired || 0);
  const overflow = Number(status.overflow || 0);
  const acknowledged = Number(status.acknowledged || 0);
  const state = quarantined > 0 ? 'quarantined'
    : overflow > 0 ? 'overflow'
      : expired > 0 ? 'expired'
        : pending > 0 ? 'local_pending'
          : acknowledged > 0 ? 'azure_acknowledged'
            : 'native_best_effort';
  return {
    state,
    headline: `${pending} waiting · ${quarantined} held for review · ${expired} expired`,
    pending,
    quarantined,
    expired,
    acknowledged_cumulative: acknowledged,
    overflow_cumulative: overflow
  };
}

module.exports = {
  deliveryStateFromEnqueue,
  deliveryText,
  receiptDeliveryText,
  summarizeDeliveryStatus
};
