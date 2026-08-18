function benchmarkJudgeProviderGuide() {
  return {
    purpose: 'Configure llm-judge semantic checks through a local hosted-judge wrapper command.',
    secretHandling: [
      'Keep judge endpoint and token in environment variables or your CI secret store.',
      'Do not commit judge tokens, prompts, model responses, or rubric text containing private data.',
      'The benchmark runner stores the judge score and detail, not the judge request payload.'
    ],
    wrapperScript: {
      path: 'benchmark-judges/hosted-judge.sh',
      env: ['AGENTOPS_JUDGE_ENDPOINT', 'AGENTOPS_JUDGE_TOKEN'],
      example: [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'file="${1:?file required}"',
        'check_id="${2:?check id required}"',
        'curl -fsS "$AGENTOPS_JUDGE_ENDPOINT" \\',
        '  -H "Authorization: Bearer $AGENTOPS_JUDGE_TOKEN" \\',
        '  -H "Content-Type: application/json" \\',
        '  --data @<(node -e \'const fs=require("fs"); const [file,check]=process.argv.slice(1); process.stdout.write(JSON.stringify({check_id:check,file,content:fs.readFileSync(file,"utf8")}));\' "$file" "$check_id")'
      ]
    },
    serviceArtifact: {
      path: 'benchmark-judges/hosted-judge',
      imageBuild: 'az acr build --registry <acr-name> --image agentops-hosted-judge:latest benchmark-judges/hosted-judge',
      deployTemplate: 'infra/bicep/hosted-judge.bicep',
      endpoints: ['/health', '/score']
    },
    provisioningPlan: {
      target: 'Azure Container Apps',
      requiredSecrets: ['OPENAI_API_KEY', 'AGENTOPS_JUDGE_TOKEN'],
      commands: [
        'az group create --name rg-agentops-judges --location eastus',
        'az acr build --registry <acr-name> --image agentops-hosted-judge:latest benchmark-judges/hosted-judge',
        'az deployment group create --resource-group rg-agentops-judges --name agentops-hosted-judge --template-file infra/bicep/hosted-judge.bicep --parameters image=<acr-login-server>/agentops-hosted-judge:latest judgeToken=$AGENTOPS_JUDGE_TOKEN openAiApiKey=$OPENAI_API_KEY',
        'az deployment group show --resource-group rg-agentops-judges --name agentops-hosted-judge --query properties.outputs.judgeEndpoint.value --output tsv'
      ],
      healthCheck: 'curl -fsS https://<judge-fqdn>/health -H "Authorization: Bearer $AGENTOPS_JUDGE_TOKEN"',
      bindCommand: 'export AGENTOPS_JUDGE_ENDPOINT=https://<judge-fqdn>/score'
    },
    suiteSnippet: {
      judgeProviders: {
        hosted: {
          command: 'benchmark-judges/hosted-judge.sh {file} {checkId}'
        }
      }
    },
    semanticCheckSnippet: {
      id: 'answer-quality',
      adapter: 'llm-judge',
      provider: 'hosted',
      file: 'notes/hello.txt',
      minScore: 80
    },
    expectedJudgeOutput: {
      score: 92,
      detail: 'short reason for the score'
    },
    validation: [
      'Provision the hosted judge only after reviewing the plan and storing secrets outside the repo.',
      'Run the wrapper directly against a local fixture file and confirm it prints JSON with score.',
      'Run `agentops benchmark run <suite> --variant candidate --repeat 1 --dry-run` before executing.',
      'Run `agentops benchmark report <run-id>` and inspect semanticChecks.averageScore.'
    ]
  };
}

function renderBenchmarkJudgeProviderGuide(guide = benchmarkJudgeProviderGuide()) {
  const lines = [
    'Benchmark hosted judge provider guide',
    '',
    guide.purpose,
    '',
    'Secret handling'
  ];
  for (const item of guide.secretHandling) lines.push(`- ${item}`);
  lines.push(
    '',
    `Wrapper: ${guide.wrapperScript.path}`,
    `Required env: ${guide.wrapperScript.env.join(', ')}`,
    '',
    'Wrapper example',
    '```bash',
    ...guide.wrapperScript.example,
    '```',
    '',
    `Deployable service: ${guide.serviceArtifact.path}`,
    `Image build: ${guide.serviceArtifact.imageBuild}`,
    `Bicep template: ${guide.serviceArtifact.deployTemplate}`,
    `Endpoints: ${guide.serviceArtifact.endpoints.join(', ')}`,
    '',
    `Provisioning target: ${guide.provisioningPlan.target}`,
    `Required secrets: ${guide.provisioningPlan.requiredSecrets.join(', ')}`,
    '',
    'Provisioning commands',
    '```bash',
    ...guide.provisioningPlan.commands,
    guide.provisioningPlan.healthCheck,
    guide.provisioningPlan.bindCommand,
    '```',
    '',
    'suite.json snippet',
    '```json',
    JSON.stringify(guide.suiteSnippet, null, 2),
    '```',
    '',
    'semanticChecks snippet',
    '```json',
    JSON.stringify(guide.semanticCheckSnippet, null, 2),
    '```',
    '',
    'Expected judge output',
    '```json',
    JSON.stringify(guide.expectedJudgeOutput, null, 2),
    '```',
    '',
    'Validation'
  );
  for (const item of guide.validation) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  benchmarkJudgeProviderGuide,
  renderBenchmarkJudgeProviderGuide
};
