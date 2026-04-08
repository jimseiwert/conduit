# Multi-stage build — compiles better-sqlite3 native addon inside container
FROM node:20-slim AS builder
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy workspace root and local packages so npm can resolve @conduit/types
COPY package.json ./
COPY packages/types/package.json ./packages/types/package.json
COPY packages/types/dist ./packages/types/dist
COPY packages/relay/package.json ./packages/relay/package.json

# Install relay deps (workspace-aware: resolves @conduit/types from local path)
RUN npm install --workspace=packages/relay --include=optional

# Dereference the workspace symlink so it copies cleanly to the final stage
RUN cp -rL node_modules/@conduit node_modules/@conduit-real && \
    rm -rf node_modules/@conduit && \
    mv node_modules/@conduit-real node_modules/@conduit

COPY packages/relay/dist ./packages/relay/dist

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/relay/dist ./dist

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
