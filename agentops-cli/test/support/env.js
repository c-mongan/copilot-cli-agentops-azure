function setEnvForTest(values) {
  const original = {};
  for (const name of Object.keys(values)) original[name] = process.env[name];

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) delete process.env[name];
    else process.env[name] = String(value);
  }

  return () => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

module.exports = { setEnvForTest };
