FROM node:22-bookworm-slim

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/canvascii/package.json ./apps/canvascii/package.json
COPY apps/canvascii-collab/package.json ./apps/canvascii-collab/package.json
COPY packages/canvascii-agent-client/package.json ./packages/canvascii-agent-client/package.json
COPY packages/canvascii-core/package.json ./packages/canvascii-core/package.json

RUN pnpm install --frozen-lockfile

COPY apps/canvascii ./apps/canvascii
COPY apps/canvascii-collab ./apps/canvascii-collab
COPY packages/canvascii-agent-client ./packages/canvascii-agent-client
COPY packages/canvascii-core ./packages/canvascii-core

RUN pnpm --filter @canvascii/app build

EXPOSE 5001

CMD ["pnpm", "--filter", "@canvascii/app", "start"]
