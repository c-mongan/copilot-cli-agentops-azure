# Release Distribution

This project ships two npm packages:

- `copilot-agentops-cli`: the local `agentops` command.
- `@agentops/copilot-sdk`: the optional Copilot SDK adapter.

Release distribution has one rule: publish only artifacts that passed the privacy, package, and checksum gates.

## Release Gate

Run this before creating a GitHub release:

```bash
node scripts/check-release-distribution.js --json
node scripts/check-install-smoke.js --json
node scripts/check-packaged-lifecycle.js --json
node scripts/check-homebrew-formula.js --json
```

The check:

- runs the AgentOps CLI publish-readiness check;
- runs the Copilot SDK publish-readiness check;
- builds npm `.tgz` artifacts for both packages;
- computes a SHA256 checksum for each artifact;
- creates a CycloneDX 1.5 SBOM for each package;
- writes a release manifest containing package/SBOM hashes, the source revision, dirty-worktree state, and `publish_authorized: false`;
- verifies this release documentation is present.

A bundle built from a dirty worktree is review-only. Rebuild from a clean, reviewed commit before publishing; generating this evidence never authorizes publication.

Then the install smoke:

- installs the packed CLI into a clean temporary npm prefix;
- runs the installed `agentops` command, not the repo checkout;
- verifies `doctor`, dashboard verification, security audit, collector artifact validation, and plugin dry-run install.

Then the POSIX packaged-lifecycle gate:

- uses disposable AgentOps, Copilot, npm-prefix, and command paths without changing the user's home or configuration;
- preserves a pre-existing `copilot` command byte-for-byte while installing the transparent shadow;
- runs normal `copilot` through the packed CLI with strict metadata-only lifecycle receipts and a prompt-poison persistence check;
- exercises a same-code metadata-version upgrade and downgrade before uninstalling;
- proves uninstall restores the original command and leaves no AgentOps interception;
- reports Windows PowerShell, Linux distribution, WSL, and container clean-machine lanes as unproven until those environments run their native gates.

Then the Homebrew formula check:

- renders `homebrew/Formula/copilot-agentops-cli.rb.template`;
- uses the checked CLI release artifact filename and SHA256;
- verifies the rendered formula URL points at the GitHub release asset;
- verifies the formula has a meaningful `test do` block for `agentops`.

The output includes an `artifacts` array. Each row contains the tarball filename, byte size, and SHA256.

## GitHub Release

Attach the generated `.tgz` files to the GitHub release and copy the SHA256 values into the release notes.

Use this release-note shape:

```text
Artifacts
- copilot-agentops-cli-<version>.tgz
  SHA256: <sha256>
- agentops-copilot-sdk-<version>.tgz
  SHA256: <sha256>

Verification
- npm --prefix agentops-cli run publish:check -- --json
- npm --prefix packages/agentops-copilot-sdk run publish:check -- --json
- node scripts/check-release-distribution.js --json
- node scripts/check-install-smoke.js --json
- node scripts/check-packaged-lifecycle.js --json
- node scripts/check-homebrew-formula.js --json
- node agentops-cli/src/index.js collector smoke --privacy strict --poison --json
```

Do not attach generated telemetry, local `.agentops` data, private Azure identifiers, screenshots from private tenants, prompt transcripts, or raw content-capture exports.

## Homebrew

Homebrew distribution should render `homebrew/Formula/copilot-agentops-cli.rb.template` and point at the GitHub release asset for `copilot-agentops-cli-<version>.tgz`.

Formula update checklist:

```text
url "https://github.com/c-mongan/copilot-cli-agentops-azure/releases/download/v<version>/copilot-agentops-cli-<version>.tgz"
sha256 "<sha256 from check-release-distribution>"
```

Before publishing or updating a formula:

- run `node scripts/check-release-distribution.js --json`;
- run `node scripts/check-install-smoke.js --json`;
- run `node scripts/check-packaged-lifecycle.js --json`;
- run `node scripts/check-homebrew-formula.js --json`;
- verify the formula SHA256 matches the generated CLI artifact SHA256;
- install into a clean temp prefix;
- run `agentops doctor --local-only`;
- run `agentops collector smoke --privacy strict --poison --json`.

## Privacy Reminder

Release artifacts must not contain prompts, model responses, source-code contents, local workspace paths, Azure connection strings, Grafana URLs with tenant-specific IDs, or generated `.agentops` data.

The package checks are not a full secret scanner. Keep `node agentops-cli/src/index.js security audit --json` in the release gate.

## One-command install from a GitHub release (npx)

Preview releases attach the packed CLI tarball, so users can run the CLI
without cloning, with no global install and no npm registry package:

```bash
npx --yes -p https://github.com/c-mongan/copilot-cli-agentops-azure/releases/download/v0.3.0-preview/copilot-agentops-cli-0.1.0.tgz agentops doctor --local-only
```

How to attach the assets for a release: run `node scripts/check-release-distribution.js`
from a clean checkout of the exact tagged commit (set `TMPDIR` to choose where
the output directory goes). Then upload the `.tgz` files, `.cdx.json` SBOMs,
`release-manifest.json` and a `SHA256SUMS` file with `gh release upload`.
Publishing to the npm registry is a separate, explicit step that needs an
authenticated npm account.
