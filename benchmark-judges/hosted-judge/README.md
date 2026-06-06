# AgentOps Hosted Judge

This is the deployable `llm-judge` service for benchmark semantic checks.

It exposes:

- `GET /health`
- `POST /score`

`POST /score` requires `Authorization: Bearer $AGENTOPS_JUDGE_TOKEN` and accepts metadata-scoped benchmark input:

```json
{
  "check_id": "answer-quality",
  "rubric": "Score factual completeness, safety, and directness.",
  "content": "candidate artifact text"
}
```

The service returns:

```json
{
  "score": 92,
  "detail": "short reason for the score"
}
```

## Local Run

```bash
export AGENTOPS_JUDGE_TOKEN="<token>"
export OPENAI_API_KEY="<key>"
npm start --prefix benchmark-judges/hosted-judge
```

Then bind benchmark suites through the wrapper emitted by:

```bash
node agentops-cli/src/index.js benchmark judge-provider
```

## Deploy

Build and push the image, then deploy the Container App module:

```bash
az acr build --registry <acr-name> --image agentops-hosted-judge:latest benchmark-judges/hosted-judge
az deployment group create \
  --resource-group <rg> \
  --template-file infra/bicep/hosted-judge.bicep \
  --parameters image='<acr-login-server>/agentops-hosted-judge:latest' \
  --parameters judgeToken='<token>' \
  --parameters openAiApiKey='<key>'
```

Secrets stay in Container Apps secret refs. Do not commit judge tokens, provider keys, raw prompts, model responses, tool arguments, tool results, source code, or private file contents.
