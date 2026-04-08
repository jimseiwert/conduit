# Multi-stage build — compiles better-sqlite3 native addon inside container
FROM node:20-slim AS builder
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY packages/relay/package.json ./
RUN npm install --include=optional

COPY packages/relay/dist ./dist

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
