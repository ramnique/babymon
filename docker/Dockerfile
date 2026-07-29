# Build the web app and the (fully bundled) server, ship both in one image.
FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/detection/package.json packages/detection/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm -r build

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/web
WORKDIR /app
COPY --from=build /repo/apps/server/dist/index.js server.js
COPY --from=build /repo/apps/web/dist web
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "server.js"]
