FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="AgentOps Copilot Benchmark Sandbox Runner"
LABEL org.opencontainers.image.description="Base image for opt-in container-network-blocked benchmark runs"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client bash \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV COPILOT_HOME=/copilot-home
ENV AGENTOPS_BENCHMARK_RUNNER=managed-container-sandbox

WORKDIR /workspace

COPY docker-entrypoint.sh /usr/local/bin/agentops-benchmark-entrypoint
RUN chmod 0755 /usr/local/bin/agentops-benchmark-entrypoint \
  && mkdir -p /workspace /copilot-home \
  && chmod 1777 /workspace /copilot-home

ENTRYPOINT ["agentops-benchmark-entrypoint"]
CMD ["copilot", "--help"]
