FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/vpn/package.json packages/vpn/package.json
COPY packages/remote-access/package.json packages/remote-access/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN mkdir -p apps/web/public/install \
  && cp scripts/enroll-windows.ps1 apps/web/public/install/enroll-windows.ps1 \
  && cp scripts/enroll-linux.sh apps/web/public/install/enroll-linux.sh
RUN pnpm --dir /repo build:packages && pnpm --filter @nms/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
