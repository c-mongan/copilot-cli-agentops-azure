const { writeJsonlFile } = require('../../src/lib/command-output');

function writeJsonlFixture(file, rows) {
  return writeJsonlFile(file, rows);
}

module.exports = {
  writeJsonlFixture
};
