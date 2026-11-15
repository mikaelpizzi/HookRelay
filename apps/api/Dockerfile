# ==============================================================================
# Stage 1: Dependencies installation
# ==============================================================================
FROM node:20-alpine AS dependencies

WORKDIR /app

# Install OpenSSL for Prisma engine compatibility on Alpine Linux
RUN apk add --no-cache openssl libc6-compat

# Copy dependency manifests
COPY package.json package-lock.json ./

# Clean installation of all dependencies including devDependencies for build
RUN npm ci

# ==============================================================================
# Stage 2: Application Build & Dependency Pruning
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

# Copy manifests and installed dependencies
COPY package.json package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules

# Copy TypeScript and NestJS build configurations
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

# Copy Prisma schema and application source code
COPY prisma ./prisma
COPY src ./src

# Generate Prisma Client code and engine binaries
RUN npx prisma generate

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# Remove development dependencies to minimize container footprint
RUN npm prune --omit=dev

# ==============================================================================
# Stage 3: Production Runtime
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=3000

# Execute container under non-root built-in node user (security standard)
USER node

# Copy package metadata, pruned node_modules, compiled dist, and prisma schemas
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
