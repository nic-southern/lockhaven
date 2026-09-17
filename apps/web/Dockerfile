FROM golang:1.22-alpine AS agent
WORKDIR /src
COPY apps/lockhaven-agent ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/lockhaven-agent-linux-amd64 ./cmd/lockhaven-agent
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o /out/lockhaven-agent-linux-arm64 ./cmd/lockhaven-agent
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/lockhaven-agent-windows-amd64.exe ./cmd/lockhaven-agent
RUN CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o /out/lockhaven-agent-windows-arm64.exe ./cmd/lockhaven-agent

FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/lockhaven-agent/package.json apps/lockhaven-agent/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/vpn/package.json packages/vpn/package.json
COPY packages/remote-access/package.json packages/remote-access/package.json
COPY packages/notifications/package.json packages/notifications/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN mkdir -p apps/web/public/install \
  && cp scripts/enroll-windows.ps1 apps/web/public/install/enroll-windows.ps1 \
  && cp scripts/enroll-linux.sh apps/web/public/install/enroll-linux.sh \
  && cp scripts/enroll-android.sh apps/web/public/install/enroll-android.sh \
  && cp scripts/uninstall-windows.ps1 apps/web/public/install/uninstall-windows.ps1 \
  && cp scripts/uninstall-linux.sh apps/web/public/install/uninstall-linux.sh \
  && cp scripts/install-lockhaven-agent.sh apps/web/public/install/install-lockhaven-agent.sh \
  && cp scripts/install-lockhaven-agent.ps1 apps/web/public/install/install-lockhaven-agent.ps1
COPY --from=agent /out/lockhaven-agent-linux-amd64 apps/web/public/install/lockhaven-agent-linux-amd64
COPY --from=agent /out/lockhaven-agent-linux-arm64 apps/web/public/install/lockhaven-agent-linux-arm64
COPY --from=agent /out/lockhaven-agent-windows-amd64.exe apps/web/public/install/lockhaven-agent-windows-amd64.exe
COPY --from=agent /out/lockhaven-agent-windows-arm64.exe apps/web/public/install/lockhaven-agent-windows-arm64.exe
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
