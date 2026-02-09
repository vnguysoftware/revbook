# ─── Stage 1: Install dependencies ────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ─── Stage 2: Build TypeScript ────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ─── Stage 3: Production image ───────────────────────────────────────
FROM node:20-alpine AS production

LABEL org.opencontainers.image.title="RevBack"
LABEL org.opencontainers.image.description="Entitlement correctness engine — detect payment and subscription issues across billing systems"
LABEL org.opencontainers.image.version="0.1.0"

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Copy migrations for runtime migration support
COPY migrations/ ./migrations/

# Non-root user for security
RUN addgroup -g 1001 -S revback && \
    adduser -S revback -u 1001 -G revback
USER revback

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
