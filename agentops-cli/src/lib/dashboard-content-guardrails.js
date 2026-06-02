const fs = require('node:fs');
const path = require('node:path');

const { repoRoot } = require('./paths');

const explicitContentViewerTitle = 'Prompt and response viewer (explicit opt-in)';
const transcriptAvailabilityTitle = 'Transcript availability';

const rawContentTable = 'AgentOpsContent_CL';
const rawContentProjectionPatterns = [
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.input\.messages['"]\s*\]\s*\)/i,
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.output\.messages['"]\s*\]\s*\)/i,
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.system_instructions['"]\s*\]\s*\)/i,
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.tool\.definitions['"]\s*\]\s*\)/i,
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.prompt['"]\s*\]\s*\)/i,
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.completion['"]\s*\]\s*\)/i,
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.tool\.call\.arguments['"]\s*\]\s*\)/i,
  /tostring\s*\(\s*Properties\s*\[\s*['"]gen_ai\.tool\.call\.result['"]\s*\]\s*\)/i
];

const contentTextColumns = [
  'PromptText',
  'ResponseText',
  'MessageText'
];

function v2DashboardFiles(root = repoRoot) {
  const dir = path.join(root, 'grafana', 'dashboards', 'v2');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(dir, file))
    .sort();
}

function loadV2Dashboards(root = repoRoot) {
  return v2DashboardFiles(root).map(file => ({
    file,
    body: JSON.parse(fs.readFileSync(file, 'utf8'))
  }));
}

function collectPanels(panels = [], collected = []) {
  for (const panel of panels || []) {
    collected.push(panel);
    collectPanels(panel.panels, collected);
  }
  return collected;
}

function panelQueries(panel) {
  return (panel.targets || [])
    .map(target => target.azureLogAnalytics?.query || target.query || '')
    .filter(Boolean);
}

function queryProjectsContentText(query) {
  const normalized = String(query || '');
  if (rawContentProjectionPatterns.some(pattern => pattern.test(normalized))) return true;
  if (!normalized.includes(rawContentTable)) return false;
  const projectClauses = normalized.match(/\|\s*project\b[^|]*/gi) || [];
  return projectClauses.some(clause => contentTextColumns.some(column => new RegExp(`\\b${column}\\b`, 'i').test(clause)));
}

function validateDashboardContentGuardrails(options = {}) {
  const dashboards = options.dashboards || loadV2Dashboards(options.root || repoRoot);
  const errors = [];
  const allowedContentPanels = [];
  let checkedPanels = 0;

  for (const dashboard of dashboards) {
    for (const panel of collectPanels(dashboard.body?.panels || [])) {
      checkedPanels += 1;
      const title = panel.title || `panel-${panel.id || 'unknown'}`;
      const isExplicitViewer = title === explicitContentViewerTitle;
      const isTranscriptSummary = title === transcriptAvailabilityTitle;

      for (const query of panelQueries(panel)) {
        const usesContentTable = String(query).includes(rawContentTable);
        const projectsContentText = queryProjectsContentText(query);

        if (usesContentTable) {
          allowedContentPanels.push({
            dashboard: dashboard.body?.uid || path.basename(dashboard.file),
            panel: title
          });
        }
        if (usesContentTable && !isExplicitViewer && !isTranscriptSummary) {
          errors.push(`${dashboard.file}: ${title} uses ${rawContentTable}; only the explicit viewer or transcript availability panel may read optional content rows`);
        }
        if (projectsContentText && !isExplicitViewer) {
          errors.push(`${dashboard.file}: ${title} projects prompt/response text; only "${explicitContentViewerTitle}" may expose optional content text`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    dashboards: dashboards.length,
    checked_panels: checkedPanels,
    allowed_content_panels: allowedContentPanels,
    errors
  };
}

module.exports = {
  explicitContentViewerTitle,
  rawContentTable,
  validateDashboardContentGuardrails
};
