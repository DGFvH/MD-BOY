# ---- build the frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: server + built assets only ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
# The data folder must exist and belong to "node" before VOLUME, so a new
# volume gets that owner and SQLite can create the database in it.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
# Node handles SIGTERM itself (finishes open requests, closes the database).
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
