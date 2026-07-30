# MedChain — single-image build.
#
# Builds the React app, then serves it and the API from one Node process. One
# image, one port, one origin: no CORS, and the httpOnly refresh cookie works
# without special cases.
#
#   docker build -t medchain .
#   docker run -p 8080:8080 --env-file backend/.env medchain

# --- Stage 1: build the frontend -------------------------------------------
FROM node:20-alpine AS web

WORKDIR /build/frontend

# Copy manifests first so the dependency layer is cached across source changes.
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Relative API base — the same server hosts both, so no host is baked in.
ENV VITE_API_URL=/api/v1
RUN npm run build

# --- Stage 2: runtime ------------------------------------------------------
FROM node:20-alpine AS runtime

# bcrypt ships prebuilt binaries; these cover the fallback source build.
RUN apk add --no-cache python3 make g++ tini

WORKDIR /app

COPY backend/package*.json ./backend/
RUN npm --prefix backend ci --omit=dev && npm cache clean --force

COPY backend/ ./backend/
COPY --from=web /build/frontend/dist ./frontend/dist

# Never run as root in a container.
RUN addgroup -S medchain && adduser -S medchain -G medchain \
    && mkdir -p /app/backend/logs /app/backend/.local/ipfs \
    && chown -R medchain:medchain /app
USER medchain

ENV NODE_ENV=production \
    SERVE_FRONTEND=true \
    PORT=8080

EXPOSE 8080

# tini reaps zombies and forwards SIGTERM, so graceful shutdown actually runs.
ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "backend/src/server.js"]
