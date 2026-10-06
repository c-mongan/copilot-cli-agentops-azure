# Execution configuration identity

AgentOps records execution configuration separately from `architectureVersion`.
New Copilot launch records contain identical `configurationVersion` and
`executionConfigurationHash` values plus an
`executionConfiguration` receipt in `run-context.json`. Older records and direct
collection without launch settings remain `unknown`.

The observed-launch identity is a deterministic SHA-256 projection, shortened to
16 hexadecimal characters. It includes only bounded, non-secret command metadata
for explicit model, tool-policy, MCP-selection, and agent/plugin settings. Repeated
identifiers are sorted. Prompt text, session identity, secret environment-variable
names, filesystem paths, MCP configuration contents, plugin contents, and ambient
defaults are excluded. File-backed MCP/plugin settings contribute only counts, so
the receipt is always labelled `partial`; matching observed hashes do not prove
that two effective configurations are fully compatible.

Each persisted identifier is at most 160 characters and each identifier list is
limited to 64 entries. The receipt records omitted-value counts instead of
persisting extra or unsafe values.

An integration that already owns a complete, secret-free configuration snapshot
may supply a 16–64 character lowercase hexadecimal identity. It must label
completeness and per-surface scope explicitly. A supplied hash without that label
defaults to `unknown`, is labelled `caller_asserted`, and AgentOps never persists
the supplied configuration blob. Caller assertion is provenance, not independent
verification.
