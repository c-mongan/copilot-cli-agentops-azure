function hasFlag(args, name) {
  return args.includes(name);
}

function optionValue(args, names, fallback = null) {
  const list = Array.isArray(names) ? names : [names];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of list) {
      if (arg === name) return args[index + 1] ?? fallback;
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return fallback;
}

function requiredOptionValue(args, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const index = args.indexOf(name);
    if (index !== -1) {
      if (!args[index + 1]) throw new Error(`${name} requires a value`);
      return args[index + 1];
    }
  }
  return null;
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

function firstPositional(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && index + 1 < args.length && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    return arg;
  }
  return 'latest';
}

function parseJsonFlag(args) {
  return hasFlag(args, '--json');
}

function withoutFlags(args, names) {
  const list = Array.isArray(names) ? names : [names];
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (list.includes(arg)) {
      if (index + 1 < args.length && !args[index + 1].startsWith('-')) index += 1;
      continue;
    }
    if (list.some(name => arg.startsWith(`${name}=`))) continue;
    result.push(arg);
  }
  return result;
}

module.exports = {
  firstPositional,
  hasFlag,
  optionValue,
  optionValues,
  parseJsonFlag,
  requiredOptionValue,
  withoutFlags
};
