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
  hasFlag,
  optionValue,
  parseJsonFlag,
  withoutFlags
};
