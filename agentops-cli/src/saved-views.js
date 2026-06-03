const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

function createSavedViews({ savedViewsPath, readJson, buildLink }) {
  function readSavedViews(filePath = savedViewsPath) {
    if (!fs.existsSync(filePath)) return { views: [] };
    const payload = readJson(filePath);
    return {
      views: Array.isArray(payload.views) ? payload.views : []
    };
  }

  function writeSavedViews(payload, filePath = savedViewsPath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  function readJsonl(filePath) {
    if (!filePath) return [];
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }

  function stringValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return String(value);
  }

  function propertyValue(row = {}, key) {
    const props = row.Properties && typeof row.Properties === 'object'
      ? row.Properties
      : {};
    return row[key]
      ?? row[`agentops.custom.${key}`]
      ?? row[`agentops.${key}`]
      ?? props[key]
      ?? props[`agentops.custom.${key}`]
      ?? props[`agentops.${key}`]
      ?? '';
  }

  function parseDetailsValue(details, key) {
    const text = stringValue(details);
    if (!text) return '';
    const pattern = new RegExp(`${key}[=: ]+([A-Za-z0-9_.@/-]+)`);
    return pattern.exec(text)?.[1] || '';
  }

  function normalizeConfigChangeAnnotation(row = {}) {
    const props = row.Properties && typeof row.Properties === 'object' ? row.Properties : {};
    const eventName = stringValue(row.EventName || row.Event || row.event || props['agentops.event.name'] || props['event.name']);
    const eventType = stringValue(row.EventType || row.Type || row.type);
    const details = stringValue(row.Details || row.ResultCode || row.details || '');
    const annotationType = stringValue(propertyValue(row, 'annotation_type') || row.AnnotationType || parseDetailsValue(details, 'annotation_type'));
    const isConfigAnnotation = eventName === 'agentops.config.changed'
      || annotationType === 'config_change'
      || eventType === 'annotation'
      || details.includes('config_change');
    if (!isConfigAnnotation) return null;

    return {
      time_generated: stringValue(row.TimeGenerated || row.time || row.timestamp),
      component: stringValue(row.ChangeComponent || propertyValue(row, 'component') || propertyValue(row, 'entity.type') || row.EntityType || parseDetailsValue(details, 'component')),
      target: stringValue(row.ChangeTarget || propertyValue(row, 'target') || propertyValue(row, 'entity.id_hash') || row.EntityIdHash || parseDetailsValue(details, 'target')),
      change_type: stringValue(row.ChangeType || propertyValue(row, 'change_type') || parseDetailsValue(details, 'change_type') || 'updated'),
      change_id: stringValue(row.ChangeId || propertyValue(row, 'change_id') || parseDetailsValue(details, 'change_id')),
      version: stringValue(row.Version || propertyValue(row, 'version') || parseDetailsValue(details, 'version')),
      run_id: stringValue(row.RunId || propertyValue(row, 'run.id')),
      session_id: stringValue(row.SessionId || propertyValue(row, 'session.id') || props['gen_ai.conversation.id']),
      trace_id: stringValue(row.TraceId || propertyValue(row, 'trace.id')),
      event_name: eventName || 'agentops.config.changed'
    };
  }

  function annotationsForSession(events = [], session) {
    const normalizedSession = String(session || '').trim();
    if (!normalizedSession) return [];
    return events
      .map(normalizeConfigChangeAnnotation)
      .filter(annotation => annotation && annotation.session_id === normalizedSession)
      .slice(0, 10);
  }

  function annotationRefs(annotations = []) {
    return annotations
      .map(annotation => [annotation.component, annotation.target].filter(Boolean).join(':'))
      .filter(Boolean);
  }

  function parseSavedViewArgs(args) {
    const [subcommand, rawName, ...rawRest] = args;
    if (!subcommand) throw new Error('saved-view requires add, list, show, open, or export');
    const name = rawName && !rawName.startsWith('--') ? rawName : undefined;
    const rest = name ? rawRest : [rawName, ...rawRest].filter(Boolean);
    const options = { subcommand, name, tags: [] };

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--url' || arg === '--dashboard') {
        options.url = rest[index + 1];
        index += 1;
      } else if (arg === '--query-file') {
        const queryFile = rest[index + 1];
        if (!queryFile) throw new Error('--query-file requires a file');
        options.queryFile = path.resolve(queryFile);
        options.query = fs.readFileSync(options.queryFile, 'utf8');
        index += 1;
      } else if (arg === '--description') {
        options.description = rest[index + 1] || '';
        index += 1;
      } else if (arg === '--tag') {
        options.tags.push(rest[index + 1]);
        index += 1;
      } else if (arg === '--out') {
        const outDir = rest[index + 1];
        if (!outDir) throw new Error('--out requires a directory');
        options.outDir = path.resolve(outDir);
        index += 1;
      } else if (arg === '--events') {
        const eventsFile = rest[index + 1];
        if (!eventsFile) throw new Error('--events requires a JSONL file');
        options.eventsFile = path.resolve(eventsFile);
        options.events = readJsonl(options.eventsFile);
        index += 1;
      } else if (arg === '--session') {
        const sessionId = rest[index + 1];
        if (!sessionId) throw new Error('--session requires a session id');
        const link = buildLink('session', sessionId);
        options.url = link.grafana_url;
        options.query = link.query;
        options.session = sessionId;
        index += 1;
      } else {
        throw new Error(`Unknown saved-view option: ${arg}`);
      }
    }

    return options;
  }

  function stableId(value, prefix = 'view') {
    return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
  }

  function savedViewRow(view, timeGenerated = new Date().toISOString()) {
    return {
      TimeGenerated: timeGenerated,
      SavedViewId: stableId([view.name, view.url, view.session || '', view.createdAt || ''].join('|')),
      Name: view.name || '',
      Description: view.description || '',
      Url: view.url || '',
      QueryHash: view.query ? stableId(view.query, 'query') : '',
      Tags: Array.isArray(view.tags) ? view.tags : [],
      SessionId: view.session || '',
      CreatedAt: view.createdAt || '',
      ChangeAnnotations: Array.isArray(view.changeAnnotations) ? view.changeAnnotations : [],
      ChangeAnnotationCount: Array.isArray(view.changeAnnotations) ? view.changeAnnotations.length : 0,
      ChangeTargetRefs: annotationRefs(view.changeAnnotations)
    };
  }

  function viewWithAnnotations(view, events = []) {
    const existing = Array.isArray(view.changeAnnotations) ? view.changeAnnotations : [];
    const matched = existing.length ? existing : annotationsForSession(events, view.session);
    return {
      ...view,
      changeAnnotations: matched,
      changeTargetRefs: annotationRefs(matched)
    };
  }

  function exportSavedViews(views, outDir, options = {}) {
    const absoluteDir = path.resolve(outDir);
    fs.mkdirSync(absoluteDir, { recursive: true });
    const rows = views.map(view => savedViewRow(viewWithAnnotations(view, options.events || [])));
    const file = path.join(absoluteDir, 'AgentOpsSavedViews_CL.jsonl');
    fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`);
    const manifest = path.join(absoluteDir, 'saved-views-manifest.json');
    fs.writeFileSync(manifest, `${JSON.stringify({
      generated_at: new Date().toISOString(),
      table: 'AgentOpsSavedViews_CL',
      file,
      rows_written: rows.length,
      privacy: 'metadata-only; query text is represented by QueryHash and is not exported'
    }, null, 2)}\n`);
    return { out_dir: absoluteDir, file, manifest, rows_written: rows.length, rows };
  }

  function savedViewCommand(options, filePath = savedViewsPath) {
    const payload = readSavedViews(filePath);

    if (options.subcommand === 'list') {
      return {
        path: filePath,
        views: payload.views.map(view => ({
          name: view.name,
          url: view.url,
          tags: view.tags || [],
          createdAt: view.createdAt
        }))
      };
    }

    if (options.subcommand === 'export') {
      const views = options.name ? payload.views.filter(item => item.name === options.name) : payload.views;
      if (options.name && views.length === 0) throw new Error(`Unknown saved view: ${options.name}`);
      return {
        path: filePath,
        export: exportSavedViews(views, options.outDir || path.join(path.dirname(filePath), 'saved-views-export'), options)
      };
    }

    if (!options.name) throw new Error(`saved-view ${options.subcommand} requires a name`);

    if (options.subcommand === 'add') {
      if (!options.url) throw new Error('saved-view add requires --url or --session');
      const view = {
        name: options.name,
        description: options.description || '',
        url: options.url,
        query: options.query || '',
        tags: options.tags.filter(Boolean),
        session: options.session || null,
        changeAnnotations: annotationsForSession(options.events || [], options.session),
        createdAt: new Date().toISOString()
      };
      const nextViews = payload.views.filter(item => item.name !== options.name).concat(view)
        .sort((left, right) => left.name.localeCompare(right.name));
      writeSavedViews({ views: nextViews }, filePath);
      return { path: filePath, saved: view };
    }

    const view = payload.views.find(item => item.name === options.name);
    if (!view) throw new Error(`Unknown saved view: ${options.name}`);

    if (options.subcommand === 'show') return { path: filePath, view };
    if (options.subcommand === 'open') return { name: view.name, url: view.url };
    throw new Error('saved-view requires add, list, show, open, or export');
  }

  return {
    exportSavedViews,
    parseSavedViewArgs,
    readSavedViews,
    savedViewCommand,
    savedViewRow
  };
}

module.exports = {
  createSavedViews
};
