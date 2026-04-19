import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import type { RelayConfig } from './config.js'
import type { StorageAdapter } from './storage/interface.js'
import { ConnectionRegistry } from './ws/registry.js'
import { PendingRequests } from './ws/pending.js'
import { ownerWsPlugin } from './ws/owner.js'
import { watcherWsPlugin } from './ws/watcher.js'
import { conduitRoutes } from './routes/conduit.js'
import { renewRoutes } from './routes/renew.js'
import { authRoutes } from './routes/auth.js'

export { ConnectionRegistry } from './ws/registry.js'
export { PendingRequests } from './ws/pending.js'

export async function createServer(
  config: RelayConfig,
  storage: StorageAdapter,
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true, forceCloseConnections: true })

  await app.register(fastifyWebsocket)

  const registry = new ConnectionRegistry()
  const pending = new PendingRequests()

  // Redirect /conduit/<slug> (no trailing slash, not a WS upgrade) → /conduit/<slug>/
  // Needed because the WS parametric route /conduit/:slug wins over the HTTP wildcard /conduit/*
  // for bare-slug requests without a trailing slash.
  app.addHook('onRequest', async (_req, reply) => {
    const match = _req.url.match(/^\/conduit\/([^/?]+)$/)
    if (match && !_req.headers.upgrade) {
      const qs = _req.url.includes('?') ? _req.url.slice(_req.url.indexOf('?')) : ''
      await reply.redirect(`/conduit/${match[1]}/${qs}`, 301)
    }
  })

  // Health check
  app.get('/healthz', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok', ts: Date.now() })
  })

  // Legacy alias
  app.get('/health', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok', ts: Date.now() })
  })

  // WebSocket routes (must be registered after fastifyWebsocket)
  await app.register(ownerWsPlugin, { config, storage, registry, pending })
  await app.register(watcherWsPlugin, { config, storage, registry })

  // HTTP routes
  await app.register(conduitRoutes, { config, storage, registry, pending })
  await app.register(renewRoutes, { config, storage })
  await app.register(authRoutes, { config })

  return app
}
