# AgentOps Copilot Sandbox Runner

This is the managed base image for benchmark tasks that opt into:

```json
{
  "osSandbox": {
    "mode": "container-network-blocked",
    "image": "<private-registry>/agentops-copilot-sandbox:<tag>"
  }
}
```

The benchmark runner invokes this image with:

- `--network none`
- `/workspace` mounted to the copied fixture
- `/copilot-home` mounted to the isolated benchmark home
- `COPILOT_HOME=/copilot-home`

## Build A Private Runner

Create a private derived image that installs your approved Copilot CLI binary or package:

```dockerfile
FROM agentops-copilot-sandbox-base:latest
COPY copilot /usr/local/bin/copilot
RUN chmod 0755 /usr/local/bin/copilot
```

Then build and push it to a private registry:

```bash
docker build -t agentops-copilot-sandbox-base:latest benchmark-runners/copilot-sandbox
docker build -t <private-registry>/agentops-copilot-sandbox:<tag> .
docker push <private-registry>/agentops-copilot-sandbox:<tag>
```

Use private registries, pinned immutable tags or digests, and short-lived credentials. Do not bake prompts, source code, tokens, Copilot auth state, tool outputs, or benchmark answers into the image.
