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
```

The check:

- runs the AgentOps CLI publish-readiness check;
- runs the Copilot SDK publish-readiness check;
- builds npm `.tgz` artifacts for both packages;
- computes a SHA256 checksum for each artifact;
- verifies this release documentation is present.

Then the install smoke:

- installs the packed CLI into a clean temporary npm prefix;
- runs the installed `agentops` command, not the repo checkout;
- verifies `doctor`, dashboard verification, security audit, collector artifact validation, and plugin dry-run install.

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
- node agentops-cli/src/index.js collector smoke --privacy strict --poison --json
```

Do not attach generated telemetry, local `.agentops` data, private Azure identifiers, screenshots from private tenants, prompt transcripts, or raw content-capture exports.

## Homebrew

Homebrew distribution should point at the GitHub release asset for `copilot-agentops-cli-<version>.tgz`.

Formula update checklist:

```text
url "https://github.com/c-mongan/copilot-cli-agentops-azure/releases/download/v<version>/copilot-agentops-cli-<version>.tgz"
sha256 "<sha256 from check-release-distribution>"
```

Before publishing or updating a formula:

- run `node scripts/check-release-distribution.js --json`;
- run `node scripts/check-install-smoke.js --json`;
- verify the formula SHA256 matches the generated CLI artifact SHA256;
- install into a clean temp prefix;
- run `agentops doctor --local-only`;
- run `agentops collector smoke --privacy strict --poison --json`.

## Privacy Reminder

Release artifacts must not contain prompts, model responses, source-code contents, local workspace paths, Azure connection strings, Grafana URLs with tenant-specific IDs, or generated `.agentops` data.

The package checks are not a full secret scanner. Keep `node agentops-cli/src/index.js security audit --json` in the release gate.
