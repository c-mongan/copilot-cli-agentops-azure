#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// Explicit files avoid shell wildcard differences on Windows and Node 20.
const files = ['extensions/agentops-native/test', 'companion/test'].flatMap(directory => fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith('.test.js')).sort().map(name => path.join(directory, name)));
files.push('scripts/test/package-native-companion.test.js');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) process.stderr.write('Native test runner could not start.\n');
process.exitCode = result.status ?? 1;
