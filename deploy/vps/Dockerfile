# Perago API and executor worker image. One image, two processes selected by
# compose. Built on the VPS from a `git archive` of one commit, so the build
# context never contains `.env`, node_modules, or local provider state.
FROM oven/bun:1.3.14-slim AS bun

FROM node:24.21.0-bookworm-slim
ENV CI=true \
    NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/app/deploy/vps/supabase-root-2021-ca.crt
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate

WORKDIR /app
COPY . .
# The web client ships on Vercel; only the SDK, API, worker, and the root
# toolchain (TypeScript for the SDK build) are installed here.
RUN pnpm install --frozen-lockfile \
      --filter perago --filter "@perago/api..." --filter "@perago/executor..." \
 && pnpm --filter @perago/sdk build \
 && chown -R node:node /app

USER node
