import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import {
  ReplayRequestSchema,
  FetchRequestsSchema,
} from '@conduit/types'
import type {
  TunnelError,
  RequestRecords,
  ReplayError,
  IncomingRequest,
  WatcherCount,
} from '@conduit/types'
import type { RelayConfig } from '../config.js'
import type { StorageAdapter } from '../storage/interface.js'
import { ConnectionRegistry } from './registry.js'

interface WatcherWsOptions {
  config: RelayConfig
  storage: StorageAdapter
  registry: ConnectionRegistry
}

function send<T>(ws: WebSocket, msg: T): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendError(ws: WebSocket, code: TunnelError['code'], message: string): void {
  const err: TunnelError = { type: 'error', code, message }
  send(ws, err)
}

export async function watcherWsPlugin(
  app: FastifyInstance,
  opts: WatcherWsOptions,
): Promise<void> {
  const { storage, registry } = opts

  app.get<{ Params: { slug: string } }>(
    '/conduit/:slug/watch',
    { websocket: true },
    async (socket: WebSocket, req: FastifyRequest<{ Params: { slug: string } }>) => {
      const { slug } = req.params

      // Authenticate via Authorization: Bearer <token> header
      const authHeader = req.headers['authorization'] ?? ''
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : ''

      if (!token) {
        sendError(socket, 'AUTH_REQUIRED', 'Authorization header with Bearer token required')
        socket.close()
        return
      }

      const validity = await storage.validateSlug(slug, token)
      if (validity !== 'valid') {
        // Also accept user tokens issued by browser login (have userId claim)
        let allowedAsUser = false
        try {
          const payload = jwt.verify(token, config.jwtSecret) as Record<string, unknown>
          if (typeof payload['userId'] === 'string') {
            allowedAsUser = true
          }
        } catch {
          // Invalid user token — fall through to error
        }

        if (!allowedAsUser) {
          const code: TunnelError['code'] =
            validity === 'expired' ? 'INVALID_TOKEN' : 'AUTH_REQUIRED'
          const message =
            validity === 'expired'
              ? 'Token expired — run conduit token refresh'
              : validity === 'invalid'
                ? 'Invalid token for this slug'
                : 'Slug not found'
          sendError(socket, code, message)
          socket.close()
          return
        }
      }

      // Register as watcher
      registry.addWatcher(slug, socket)

      // Broadcast updated count to all clients
      broadcastWatcherCount(slug)

      socket.on('message', async (data: Buffer | string) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'))
        } catch {
          sendError(socket, 'PARSE_ERROR', 'Invalid JSON')
          return
        }

        try {
          const msgObj = parsed as { type?: string }

          switch (msgObj.type) {
            case 'replay': {
              const result = ReplayRequestSchema.safeParse(parsed)
              if (!result.success) {
                sendError(socket, 'PARSE_ERROR', 'Invalid replay message')
                return
              }

              // Relay the replay request to the owner
              const owner = registry.getOwner(slug)
              if (!owner || owner.readyState !== owner.OPEN) {
                const replayErr: ReplayError = {
                  type: 'replayError',
                  requestId: result.data.requestId,
                  reason: 'NO_OWNER_CONNECTED',
                }
                send(socket, replayErr)
                return
              }

              // Fetch the record and re-issue to owner
              const records = await storage.fetchRequests(slug, [result.data.requestId])
              if (records.length === 0) {
                const replayErr: ReplayError = {
                  type: 'replayError',
                  requestId: result.data.requestId,
                  reason: 'REQUEST_NOT_FOUND',
                }
                send(socket, replayErr)
                return
              }

              const record = records[0]!
              const replayMsg: IncomingRequest = {
                type: 'request',
                id: result.data.requestId,
                method: record.method,
                path: record.path,
                headers: JSON.parse(record.headersJson) as Record<string, string>,
                body: record.body,
                bodyEncoding: record.bodyEncoding,
                bodyTruncated: record.bodyTruncated,
                ts: Date.now(),
              }
              if (owner.readyState === owner.OPEN) {
                owner.send(JSON.stringify(replayMsg))
              }
              break
            }

            case 'fetchRequests': {
              const result = FetchRequestsSchema.safeParse(parsed)
              if (!result.success) {
                sendError(socket, 'PARSE_ERROR', 'Invalid fetchRequests message')
                return
              }
              const records = await storage.fetchRequests(
                slug,
                result.data.ids.length > 0 ? result.data.ids : undefined,
                result.data.limit,
              )
              const response: RequestRecords = {
                type: 'requestRecords',
                records: records.map((r) => ({
                  id: r.id,
                  slug: r.slug,
                  method: r.method,
                  path: r.path,
                  headers: JSON.parse(r.headersJson) as Record<string, string>,
                  body: r.body,
                  bodyEncoding: r.bodyEncoding,
                  bodyTruncated: r.bodyTruncated,
                  status: r.status,
                  responseHeaders: r.responseHeadersJson
                    ? (JSON.parse(r.responseHeadersJson) as Record<string, string>)
                    : undefined,
                  responseBody: r.responseBody,
                  responseBodyEncoding: r.responseBodyEncoding,
                  responseBodyTruncated: r.responseBodyTruncated,
                  durationMs: r.durationMs,
                  ts: r.ts,
                })),
              }
              send(socket, response)
              break
            }

            default:
              sendError(socket, 'PARSE_ERROR', `Unknown message type: ${String(msgObj.type)}`)
          }
        } catch {
          sendError(socket, 'PARSE_ERROR', 'Failed to process message')
        }
      })

      socket.on('close', () => {
        registry.removeWatcher(slug, socket)
        broadcastWatcherCount(slug)
      })

      socket.on('error', (err: Error) => {
        app.log.error({ err }, 'Watcher WebSocket error')
        registry.removeWatcher(slug, socket)
        broadcastWatcherCount(slug)
      })

      function broadcastWatcherCount(targetSlug: string): void {
        const count = registry.getWatchers(targetSlug).size
        const msg: WatcherCount = { type: 'watcherCount', count }
        registry.broadcastToAll(targetSlug, JSON.stringify(msg))
      }
    },
  )
}
