FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.package.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/vpn/package.json packages/vpn/package.json
COPY packages/remote-access/package.json packages/remote-access/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --dir /repo build:packages && pnpm --filter @nms/worker build

FROM node:22-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN apk add --no-cache nftables wireguard-tools
RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
CMD ["node", "apps/worker/dist/src/index.js"]
