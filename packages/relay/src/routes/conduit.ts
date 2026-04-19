import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { IncomingRequest, RequestCompleted } from '@conduit/types'
import type { RelayConfig } from '../config.js'
import type { StorageAdapter, RequestRecord } from '../storage/interface.js'
import { ConnectionRegistry } from '../ws/registry.js'
import { PendingRequests } from '../ws/pending.js'

interface ConduitRoutesOptions {
  config: RelayConfig
  storage: StorageAdapter
  registry: ConnectionRegistry
  pending: PendingRequests
}

/**
 * Determines whether the given content-type indicates a binary payload.
 * Binary bodies are base64-encoded before being sent over the WebSocket.
 */
function isBinaryContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const ct = contentType.toLowerCase()
  // Treat text/* and common text-like types as utf8
  if (ct.startsWith('text/')) return false
  if (ct.includes('json')) return false
  if (ct.includes('xml')) return false
  if (ct.includes('javascript')) return false
  if (ct.includes('form-urlencoded')) return false
  return true
}

/**
 * Flattens Fastify's multi-value headers (string | string[]) into a flat
 * Record<string, string> suitable for JSON serialization.
 */
function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue
    out[key] = Array.isArray(val) ? val.join(', ') : val
  }
  return out
}

export async function conduitRoutes(
  app: FastifyInstance,
  opts: ConduitRoutesOptions,
): Promise<void> {
  const { config, storage, registry, pending } = opts

  // Parse all content types as raw Buffers so we can forward bytes verbatim.
  // removeAllContentTypeParsers() is scoped to this plugin (Fastify encapsulation).
  app.removeAllContentTypeParsers()
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: config.maxBodyBytes * 10 },
    (_req, body: Buffer, done) => done(null, body),
  )

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

  async function conduitHandler(
    req: FastifyRequest<{ Params: { '*': string } }>,
    reply: FastifyReply,
  ): Promise<unknown> {
    const parts = (req.params['*'] ?? '').split('/')
    const slug = parts[0] ?? ''
    if (!slug) {
      return reply.code(400).header('content-type', 'application/json').send({ error: 'Missing slug' })
    }
    const path = '/' + parts.slice(1).join('/')

    // 1. Look up owner WebSocket
    const ownerWs = registry.getOwner(slug)
    if (!ownerWs || ownerWs.readyState !== ownerWs.OPEN) {
      return reply
        .code(502)
        .header('content-type', 'application/json')
        .send({ error: 'No conduit owner connected for this slug' })
    }

    // 2. Read and optionally truncate request body
    const rawBody = req.body as Buffer | null | undefined
    const bodyBuffer = rawBody ? rawBody : Buffer.alloc(0)
    const bodyTruncated = bodyBuffer.length > config.maxBodyBytes
    const truncatedBuffer = bodyTruncated
      ? bodyBuffer.subarray(0, config.maxBodyBytes)
      : bodyBuffer

    const contentType = req.headers['content-type']
    const binary = isBinaryContentType(contentType)
    const bodyEncoding: 'utf8' | 'base64' = binary ? 'base64' : 'utf8'
    const bodyString =
      truncatedBuffer.length > 0
        ? truncatedBuffer.toString(bodyEncoding)
        : null

    // 3. Create a UUID for this request
    const requestId = randomUUID()
    const ts = Date.now()

    const flatHeaders = flattenHeaders(req.headers as Record<string, string | string[] | undefined>)

    // 4. Store initial (partial) record — response fields are null until complete
    const initialRecord: RequestRecord = {
      id: requestId,
      slug,
      method: req.method,
      path,
      headersJson: JSON.stringify(flatHeaders),
      body: bodyString,
      bodyEncoding,
      bodyTruncated,
      status: null,
      responseHeadersJson: null,
      responseBody: null,
      responseBodyEncoding: 'utf8',
      responseBodyTruncated: false,
      durationMs: null,
      ts,
    }
    await storage.insertRequest(initialRecord)

    // 5. Register the pending promise before sending to avoid race condition
    const responsePromise = pending.add(requestId, slug, config.forwardTimeoutMs)

    // 6. Send IncomingRequest JSON frame to owner
    const incomingMsg: IncomingRequest = {
      type: 'request',
      id: requestId,
      method: req.method,
      path,
      headers: flatHeaders,
      body: bodyString,
      bodyEncoding,
      bodyTruncated,
      ts,
    }

    try {
      ownerWs.send(JSON.stringify(incomingMsg))
    } catch (sendErr) {
      pending.reject(requestId, sendErr instanceof Error ? sendErr : new Error(String(sendErr)))
      return reply.code(502).send({ error: 'Failed to forward request to conduit owner' })
    }

    // 7. Wait for ForwardResponse (or timeout / owner disconnect)
    let forwardResponse
    try {
      forwardResponse = await responsePromise
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const isTimeout = errMsg.includes('timed out')
      return reply
        .code(isTimeout ? 504 : 502)
        .header('content-type', 'application/json')
        .send({ error: errMsg })
    }

    const durationMs = Date.now() - ts

    // 8. Decode response body
    let responseBodyBuffer: Buffer | null = null
    if (forwardResponse.body != null) {
      responseBodyBuffer =
        forwardResponse.bodyEncoding === 'base64'
          ? Buffer.from(forwardResponse.body, 'base64')
          : Buffer.from(forwardResponse.body, 'utf8')
    }

    // 9. Update the stored record with response data
    const updatedRecord: RequestRecord = {
      ...initialRecord,
      status: forwardResponse.status,
      responseHeadersJson: JSON.stringify(forwardResponse.headers),
      responseBody: forwardResponse.body ?? null,
      responseBodyEncoding: forwardResponse.bodyEncoding ?? 'utf8',
      responseBodyTruncated: forwardResponse.bodyTruncated ?? false,
      durationMs,
    }
    await storage.insertRequest(updatedRecord)

    // 10. Broadcast RequestCompleted to all clients
    const completed: RequestCompleted = {
      type: 'completed',
      requestId,
      method: req.method,
      path,
      status: forwardResponse.status,
      durationMs,
      ts,
    }
    registry.broadcastToAll(slug, JSON.stringify(completed))

    // 11. Send HTTP response to caller
    reply.code(forwardResponse.status)
    for (const [key, val] of Object.entries(forwardResponse.headers)) {
      // Skip hop-by-hop headers that should not be forwarded
      const lower = key.toLowerCase()
      if (
        lower === 'transfer-encoding' ||
        lower === 'connection' ||
        lower === 'keep-alive' ||
        lower === 'upgrade' ||
        lower === 'proxy-authenticate' ||
        lower === 'proxy-authorization' ||
        lower === 'te' ||
        lower === 'trailers'
      ) {
        continue
      }
      reply.header(key, val)
    }

    if (responseBodyBuffer && responseBodyBuffer.length > 0) {
      return reply.send(responseBodyBuffer)
    }
    return reply.send()
  }

  app.route<{ Params: { '*': string } }>({
    method: methods,
    url: '/conduit/*',
    handler: conduitHandler,
  })
}
