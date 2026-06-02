#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkReleaseDistribution } = require('./check-release-distribution');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const templatePath = path.join(root, 'homebrew', 'Formula', 'copilot-agentops-cli.rb.template');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function releaseUrl(version, filename) {
  return `https://github.com/c-mongan/copilot-cli-agentops-azure/releases/download/v${version}/${filename}`;
}

function renderFormula(template, artifact, version) {
  const url = releaseUrl(version, artifact.filename);
  return template
    .replaceAll('{{URL}}', url)
    .replaceAll('{{SHA256}}', artifact.sha256);
}

function validateTemplate(template) {
  const required = [
    'class CopilotAgentopsCli < Formula',
    'homepage "https://github.com/c-mongan/copilot-cli-agentops-azure"',
    'url "{{URL}}"',
    'sha256 "{{SHA256}}"',
    'license "MIT"',
    'depends_on "node@20"',
    'bin.install_symlink libexec/"src/index.js" => "agentops"',
    'test do',
    'agentops --help',
    'agentops doctor --local-only',
    'agentops dashboard verify'
  ];
  return required.filter(term => !template.includes(term));
}

function validateRenderedFormula(formula, artifact, version) {
  const url = releaseUrl(version, artifact.filename);
  const failures = [];
  if (formula.includes('{{URL}}') || formula.includes('{{SHA256}}')) {
    failures.push('rendered formula still contains template placeholders');
  }
  if (!formula.includes(`url "${url}"`)) failures.push('rendered formula URL does not match CLI release artifact');
  if (!formula.includes(`sha256 "${artifact.sha256}"`)) failures.push('rendered formula SHA256 does not match CLI release artifact');
  if (!formula.includes(`releases/download/v${version}/copilot-agentops-cli-${version}.tgz`)) {
    failures.push('rendered formula release URL does not include the package versioned artifact');
  }
  return failures;
}

function checkHomebrewFormula(options = {}) {
  const failures = [];
  const packageJson = readJson(path.join(root, 'agentops-cli', 'package.json'));
  const version = packageJson.version;
  const template = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : '';

  if (!template) failures.push('homebrew/Formula/copilot-agentops-cli.rb.template is missing');
  failures.push(...validateTemplate(template).map(term => `formula template missing ${term}`));

  const outDir = options.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-homebrew-'));
  const distribution = checkReleaseDistribution({ outDir, skipDocs: options.skipDocs });
  const artifact = distribution.artifacts.find(item => item.package === 'cli' && item.ok);
  if (!distribution.ok) failures.push(...distribution.failures);
  if (!artifact) failures.push('CLI release artifact was not generated');
  if (artifact && artifact.filename !== `copilot-agentops-cli-${version}.tgz`) {
    failures.push(`CLI artifact name does not match package version: ${artifact.filename}`);
  }

  const rendered = artifact ? renderFormula(template, artifact, version) : '';
  if (artifact) failures.push(...validateRenderedFormula(rendered, artifact, version));

  const renderedPath = path.join(outDir, 'copilot-agentops-cli.rb');
  if (rendered) fs.writeFileSync(renderedPath, rendered);

  return {
    ok: failures.length === 0,
    version,
    template: path.relative(root, templatePath),
    rendered: rendered ? renderedPath : null,
    artifact: artifact ? {
      filename: artifact.filename,
      size: artifact.size,
      sha256: artifact.sha256,
      url: releaseUrl(version, artifact.filename)
    } : null,
    failures,
    next: failures.length === 0
      ? 'Homebrew formula template is ready to render with the checked CLI artifact SHA256.'
      : 'Fix the formula template or release artifact contract before publishing a Homebrew formula.'
  };
}

if (require.main === module) {
  const outArg = process.argv.find(arg => arg.startsWith('--out='));
  const result = checkHomebrewFormula({
    outDir: outArg ? path.resolve(outArg.slice('--out='.length)) : undefined,
    skipDocs: args.has('--skip-docs')
  });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`AgentOps Homebrew formula check: ${result.ok ? 'ok' : 'failed'}\n`);
    if (result.artifact) {
      process.stdout.write(`- url: ${result.artifact.url}\n`);
      process.stdout.write(`- sha256: ${result.artifact.sha256}\n`);
    }
    if (result.rendered) process.stdout.write(`- rendered: ${result.rendered}\n`);
    for (const failure of result.failures) process.stdout.write(`- failed: ${failure}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  checkHomebrewFormula,
  releaseUrl,
  renderFormula,
  validateRenderedFormula,
  validateTemplate
};
