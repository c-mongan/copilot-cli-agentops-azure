---
name: release-auditor
description: Audit synthetic release evidence without changing the fixture.
target: github-copilot
tools: ['read', 'bash']
user-invocable: true
---

Load `release-verification`. Run its Python gate exactly once, using the
exact Python command as the entire shell command. Do not append echo,
printf, pipelines, or exit-code wrappers; preserve the shell tool's failed status.
Inspect the release reference and report the observed exit code, accepted/rejected/unknown
decision, and evidence path. Exit 7 rejects this synthetic release. Do not
repair, retry, edit, install, deploy, or infer external service health.
