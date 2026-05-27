#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const grafanaDir = path.join(repoRoot, 'grafana');

function optionValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function optionValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      if (!args[index + 1]) throw new Error(`${name} requires a value`);
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseVars(values) {
  const vars = {
    conversation: '__all',
    model: '__all',
    operation: '__all',
    agent: '__all',
    agentops_agent: '__all',
    skill: '__all',
    mcp_server: '__all',
    script: '__all',
    repo: '__all',
    tool: '__all',
    risk: 'all',
    benchmark_suite: '__all',
    benchmark_task: '__all',
    benchmark_variant: '__all',
    benchmark_run: '__all',
    hypothesis: '__all',
  };

  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error('--var expects name=value');
    vars[value.slice(0, separator)] = value.slice(separator + 1);
  }

  return vars;
}

function kqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvValue(value) {
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

function singlequoteValue(value) {
  const values = Array.isArray(value) ? value : String(value).split(',').filter(Boolean);
  return values.length ? values.map(kqlString).join(',') : kqlString('__all');
}

function textValue(value) {
  const values = Array.isArray(value) ? value : String(value).split(',').filter(Boolean);
  if (values.length === 0 || values.some(item => item === '__all' || item === '$__all' || item === '*')) {
    return 'All';
  }
  return values.join(' + ');
}

function substituteQuery(query, options) {
  let rendered = query;
  rendered = rendered.replace(/\$__timeFilter\(([^)]+)\)/g, `$1 > ago(${options.last})`);
  rendered = rendered.replace(/\$__interval/g, options.interval);
  rendered = rendered.replace(/\$\{([A-Za-z0-9_]+):csv\}/g, (_, name) => csvValue(options.vars[name] ?? '__all'));
  rendered = rendered.replace(/\$\{([A-Za-z0-9_]+):raw\}/g, (_, name) => csvValue(options.vars[name] ?? '__all'));
  rendered = rendered.replace(/\$\{([A-Za-z0-9_]+):singlequote\}/g, (_, name) => singlequoteValue(options.vars[name] ?? '__all'));
  rendered = rendered.replace(/\$\{([A-Za-z0-9_]+):text\}/g, (_, name) => textValue(options.vars[name] ?? '__all'));
  rendered = rendered.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name) => String(options.vars[name] ?? ''));
  rendered = rendered.replace(/\$\{workspaceResource\}/g, options.workspaceResource || '');
  rendered = rendered.replace(/\$risk\b/g, String(options.vars.risk ?? 'all'));
  rendered = rendered.replace(/\$([A-Za-z][A-Za-z0-9_]*)\b/g, (_, name) => String(options.vars[name] ?? `\$${name}`));
  return rendered;
}

function dashboardFiles(args) {
  const selected = optionValues(args, '--dashboard');
  if (selected.length > 0) {
    return selected.map(item => {
      if (path.isAbsolute(item)) return item;
      if (item.includes(path.sep)) return path.resolve(item);
      return path.join(grafanaDir, item.endsWith('.json') ? item : `${item}.json`);
    });
  }
  return fs.readdirSync(grafanaDir)
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(grafanaDir, file))
    .sort();
}

function panelQueries(file) {
  const dashboard = JSON.parse(fs.readFileSync(file, 'utf8'));
  const panels = Array.isArray(dashboard.panels) ? dashboard.panels : [];
  const queries = [];
  for (const panel of panels) {
    for (const target of panel.targets || []) {
      const query = target.azureLogAnalytics?.query || target.query;
      if (query) {
        queries.push({
          dashboard: dashboard.title || path.basename(file),
          uid: dashboard.uid || path.basename(file, '.json'),
          panel: panel.title || `panel-${panel.id}`,
          panelId: panel.id,
          query,
        });
      }
    }
  }
  return queries;
}

function variableQueries(file) {
  const dashboard = JSON.parse(fs.readFileSync(file, 'utf8'));
  const variables = Array.isArray(dashboard.templating?.list) ? dashboard.templating.list : [];
  return variables
    .map(variable => {
      const query = variable.query?.azureLogAnalytics?.query || (typeof variable.query === 'string' ? variable.query : '');
      if (!query || variable.type === 'constant' || variable.type === 'custom') return null;
      return {
        dashboard: dashboard.title || path.basename(file),
        uid: dashboard.uid || path.basename(file, '.json'),
        panel: `variable:${variable.name}`,
        panelId: `variable:${variable.name}`,
        query,
      };
    })
    .filter(Boolean);
}

function runQuery(workspaceId, query) {
  const result = childProcess.spawnSync('az', [
    'monitor',
    'log-analytics',
    'query',
    '--workspace',
    workspaceId,
    '--analytics-query',
    query,
    '--output',
    'json',
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    return {
      ok: false,
      rows: 0,
      error: (result.stderr || result.stdout || '').trim(),
    };
  }

  const rows = JSON.parse(result.stdout || '[]');
  return {
    ok: true,
    rows: Array.isArray(rows) ? rows.length : 0,
    data: Array.isArray(rows) ? rows : [],
    error: null,
  };
}

function firstVariableValue(variableName, rows) {
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value = row[variableName] ?? Object.values(row)[0];
    if (value !== null && value !== undefined && String(value) !== '') return String(value);
  }
  return null;
}

function variableSamples(workspaceId, variableItems, options) {
  const samples = {};

  for (const item of variableItems) {
    const name = String(item.panel).replace(/^variable:/, '');
    const query = substituteQuery(item.query, options);
    const result = runQuery(workspaceId, query);
    if (!result.ok) {
      samples[name] = { ok: false, value: null, error: result.error };
      continue;
    }
    samples[name] = {
      ok: true,
      value: firstVariableValue(name, result.data),
      rows: result.rows,
    };
  }

  return samples;
}

function queryUsesVariable(query, name) {
  return query.includes('${' + name) || new RegExp('(^|[^A-Za-z0-9_])\\$' + name + '\\b').test(query);
}

function main(argv) {
  const workspaceId = optionValue(argv, '--workspace', process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID || process.env.LOG_ANALYTICS_WORKSPACE_ID);
  if (!workspaceId) throw new Error('--workspace is required or set AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID');

  const options = {
    last: optionValue(argv, '--last', '2h'),
    interval: optionValue(argv, '--interval', '5m'),
    workspaceResource: optionValue(argv, '--workspace-resource', process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID || ''),
    vars: parseVars(optionValues(argv, '--var')),
  };

  const files = dashboardFiles(argv);
  const exerciseVars = hasFlag(argv, '--exercise-vars');
  const requireUsedVars = hasFlag(argv, '--require-used-vars');
  const queries = files.flatMap(file => [...variableQueries(file), ...panelQueries(file)]);
  const results = [];
  const coverageFailures = [];

  for (const item of queries) {
    const query = substituteQuery(item.query, options);
    const result = runQuery(workspaceId, query);
    results.push({ ...item, ...result });
    const status = result.ok ? 'ok' : 'fail';
    console.log(`${status}\trows=${result.rows}\t${item.uid}\t${item.panel}`);
    if (!result.ok) {
      console.error(result.error);
    }
  }

  if (requireUsedVars) {
    for (const file of files) {
      const panels = panelQueries(file);
      const variables = variableQueries(file);
      for (const variable of variables) {
        const name = String(variable.panel).replace(/^variable:/, '');
        if (panels.some(panel => queryUsesVariable(panel.query, name))) continue;
        coverageFailures.push({
          uid: variable.uid,
          variable: name,
          error: 'visible variable is not used by any panel query',
        });
        console.log(`fail\tcoverage\t${variable.uid}\tvariable:${name}\tunused`);
      }
    }
  }

  if (exerciseVars) {
    for (const file of files) {
      const variableItems = variableQueries(file);
      const panelItems = panelQueries(file);
      const samples = variableSamples(workspaceId, variableItems, options);
      for (const [name, sample] of Object.entries(samples)) {
        if (!sample.ok || !sample.value || sample.value === '__all' || sample.value === '$__all') continue;
        const scopedOptions = {
          ...options,
          vars: {
            ...options.vars,
            [name]: sample.value,
          },
        };
        for (const item of panelItems) {
          if (!queryUsesVariable(item.query, name)) continue;
          const query = substituteQuery(item.query, scopedOptions);
          const result = runQuery(workspaceId, query);
          results.push({ ...item, scenario: `${name}=${sample.value}`, ...result });
          const status = result.ok ? 'ok' : 'fail';
          console.log(`${status}\trows=${result.rows}\t${item.uid}\t${item.panel}\tvar:${name}=${sample.value}`);
          if (!result.ok) {
            console.error(result.error);
          }
        }
      }
    }
  }

  const failed = results.filter(result => !result.ok);
  const summary = {
    ok: failed.length === 0 && coverageFailures.length === 0,
    dashboards: new Set(results.map(result => result.uid)).size,
    panels: results.length,
    failed: failed.length,
    coverage_failed: coverageFailures.length,
    non_empty: results.filter(result => result.rows > 0).length,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
