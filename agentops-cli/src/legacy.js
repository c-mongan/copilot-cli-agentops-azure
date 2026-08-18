#!/usr/bin/env node

const runtime = require('./lib/legacy-runtime');

if (require.main === module) {
  runtime.main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = runtime;
