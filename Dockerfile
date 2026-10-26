FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node docker/bootstrap-admin.mjs ./docker/bootstrap-admin.mjs
RUN mkdir -p /app/uploads/contenidos /app/uploads/contenidos-pending && chown -R node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
