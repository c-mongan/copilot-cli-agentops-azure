function labelName(label) {
  return typeof label === 'string' ? label : String(label?.name || '');
}

function isRevertPullRequest(pr = {}) {
  const evidence = [
    pr.title,
    pr.headRefName,
    pr.body,
    ...(pr.labels || []).map(labelName)
  ].filter(Boolean).join(' ');
  return /\brevert(ed|ing)?\b/i.test(evidence);
}

module.exports = {
  isRevertPullRequest
};
