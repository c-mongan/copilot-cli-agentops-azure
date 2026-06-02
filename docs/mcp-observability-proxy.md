# MCP Observability Proxy

`agentops mcp-proxy` wraps a stdio MCP server and records privacy-safe tool-call metadata. The library also includes an HTTP/streamable-HTTP observer helper for integrations that already own the HTTP forwarding path.

```json
{
  "servers": {
    "observed-playwright": {
      "type": "stdio",
      "command": "agentops",
      "args": [
        "mcp-proxy",
        "--server-name",
        "playwright",
        "--",
        "npx",
        "-y",
        "@microsoft/mcp-server-playwright"
      ]
    }
  }
}
```

The proxy passes JSON-RPC messages through stdout/stdin and writes observations to:

```text
.agentops/mcp-proxy/AgentOpsMcpCalls_CL.jsonl
```

## Microsoft Learn MCP

The repo includes an official Microsoft Learn MCP sample config:

```bash
copilot --additional-mcp-config @copilot/mcp.microsoft-learn.sample.json --allow-tool='microsoft-learn'
```

The endpoint is:

```text
https://learn.microsoft.com/api/mcp
```

It is a remote HTTP MCP server for Microsoft Learn documentation search/fetch and code sample search. The bundled plugin config also includes it as `microsoft-learn`.

Smoke-test with the bundled demo server:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"demo"}}}' \
  | agentops mcp-proxy --server-name demo -- node examples/mcp-proxy/demo-server.js
```

Captured:

- MCP server/client/transport metadata;
- tool name and risk bucket;
- success/failure;
- duration;
- result size;
- argument schema hash.

Transport status:

- stdio: supported by the `agentops mcp-proxy` command;
- HTTP/streamable HTTP: supported as `createMcpHttpProxyObserver` for embedding in a forwarding proxy.

Not captured:

- tool arguments;
- tool results;
- prompts or model responses;
- file contents;
- secrets.

This is observability, not a sandbox or security boundary. Enforcement still belongs in the MCP server, VS Code/Copilot policy, operating system permissions, and local AgentOps policy hooks.
