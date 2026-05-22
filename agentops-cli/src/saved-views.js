const fs = require('node:fs');
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

  function parseSavedViewArgs(args) {
    const [subcommand, name, ...rest] = args;
    if (!subcommand) throw new Error('saved-view requires add, list, show, or open');
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
    throw new Error('saved-view requires add, list, show, or open');
  }

  return {
    parseSavedViewArgs,
    readSavedViews,
    savedViewCommand
  };
}

module.exports = {
  createSavedViews
};
