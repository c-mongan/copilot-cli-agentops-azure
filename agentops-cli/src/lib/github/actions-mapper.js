function ciStatusFromChecks(checks = []) {
  if (!Array.isArray(checks) || checks.length === 0) return 'unknown';
  if (checks.some(check => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(String(check.conclusion || '').toUpperCase()))) return 'failed';
  if (checks.every(check => String(check.conclusion || '').toUpperCase() === 'SUCCESS')) return 'passed';
  return 'pending';
}

module.exports = {
  ciStatusFromChecks
};
