const fs = require('node:fs');
const path = require('node:path');

const { changeRef, configChangeAnnotationsForSession } = require('./lib/change-annotations');
const { writeJsonFile, writeJsonlFile } = require('./lib/command-output');
const { prefixedHash } = require('./lib/hash');
const { readJsonl } = require('./lib/json');

function createSavedViews({ savedViewsPath, readJson, buildLink }) {
  function readSavedViews(filePath = savedViewsPath) {
    if (!fs.existsSync(filePath)) return { views: [] };
    const payload = readJson(filePath);
    return {
      views: Array.isArray(payload.views) ? payload.views : []
    };
  }

  function writeSavedViews(payload, filePath = savedViewsPath) {
    writeJsonFile(filePath, payload);
  }

  function annotationsForSession(events = [], session) {
    return configChangeAnnotationsForSession(events, session);
  }

  function annotationRefs(annotations = []) {
    return annotations
      .map(changeRef)
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

  function savedViewRow(view, timeGenerated = new Date().toISOString()) {
    return {
      TimeGenerated: timeGenerated,
      SavedViewId: prefixedHash([view.name, view.url, view.session || '', view.createdAt || ''].join('|'), 'view'),
      Name: view.name || '',
      Description: view.description || '',
      Url: view.url || '',
      QueryHash: view.query ? prefixedHash(view.query, 'query') : '',
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
    const rows = views.map(view => savedViewRow(viewWithAnnotations(view, options.events || [])));
    const file = path.join(absoluteDir, 'AgentOpsSavedViews_CL.jsonl');
    writeJsonlFile(file, rows);
    const manifest = path.join(absoluteDir, 'saved-views-manifest.json');
    writeJsonFile(manifest, {
      generated_at: new Date().toISOString(),
      table: 'AgentOpsSavedViews_CL',
      file,
      rows_written: rows.length,
      privacy: 'metadata-only; query text is represented by QueryHash and is not exported'
    });
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
