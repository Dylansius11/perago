# Perago API and executor worker image. One image, two processes selected by
# compose. Built on the VPS from a `git archive` of one commit, so the build
# context never contains `.env`, node_modules, or local provider state.
FROM oven/bun:1.3.14-slim AS bun

FROM node:24.21.0-bookworm-slim
# NODE_EXTRA_CA_CERTS (the Supabase CA) is set by compose at runtime only:
# exported during `pnpm install`, it stalls pnpm's lockfile policy check.
ENV CI=true
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate

WORKDIR /app
COPY . .
# The web client ships on Vercel; only the SDK, API, worker, and the root
# toolchain (TypeScript for the SDK build) are installed here. Files stay
# root-owned; the runtime user can read but not modify them.
RUN pnpm install --frozen-lockfile \
      --filter perago --filter "@perago/api..." --filter "@perago/executor..." \
 && pnpm --filter @perago/sdk build

USER node
