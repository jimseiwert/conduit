/**
 * Round-trip integration tests: relay ↔ owner WS ↔ HTTP caller.
 *
 * Each test starts a real relay server (in-process), connects an owner WS,
 * handles forwarded requests by sending back a ForwardResponse with the
 * desired status code, then verifies the HTTP caller gets the right status
 * and body. This covers the streaming race condition fix and ensures all
 * status codes pass through correctly.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { WebSocket } from 'ws'
import http from 'node:http'
import type { AddressInfo } from 'net'
import {
  encodeStreamFrame,
  STREAM_FRAME_TYPE,
} from '@conduit/types'
import type {
  IncomingRequest,
  ForwardResponse,
} from '@conduit/types'
import { createServer } from '../server.js'
import { MemoryStorageAdapter } from '../storage/memory.js'
import type { RelayConfig } from '../config.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'test-roundtrip-secret'
const SLUG = 'ws-aa11bb22cc33'

const defaultConfig: RelayConfig = {
  port: 0,
  jwtSecret: TEST_JWT_SECRET,
  registrationToken: undefined,
  ringBufferSize: 100,
  maxBodyBytes: 1_048_576,
  forwardTimeoutMs: 3_000,
  storageAdapter: 'memory',
  relayDomain: '127.0.0.1',
  relayProto: 'http',
}

interface TestCtx {
  httpBase: string
  wsBase: string
  stop: () => Promise<void>
}

async function startRelay(overrides: Partial<RelayConfig> = {}): Promise<TestCtx> {
  const config: RelayConfig = { ...defaultConfig, ...overrides }
  const storage = new MemoryStorageAdapter(config.ringBufferSize)
  const app = await createServer(config, storage)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address() as AddressInfo
  return {
    httpBase: `http://127.0.0.1:${addr.port}`,
    wsBase: `ws://127.0.0.1:${addr.port}`,
    stop: async () => { await app.close(); await storage.close() },
  }
}

/**
 * Connects an owner WS, registers the slug, and wires a handler that replies
 * to every forwarded request with the given status and body.
 * Returns a teardown function.
 */
function connectOwner(
  wsBase: string,
  slug: string,
  replyWith: (req: IncomingRequest) => { status: number; body: string; headers?: Record<string, string> },
): Promise<{ token: string; teardown: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/${slug}`)
    let resolved = false

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register', slug }))
    })

    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>

      if (msg['type'] === 'registered') {
        if (!resolved) {
          resolved = true
          resolve({
            token: msg['token'] as string,
            teardown: () => ws.close(),
          })
        }
        return
      }

      if (msg['type'] === 'error') {
        if (!resolved) {
          resolved = true
          reject(new Error(`Relay error: ${msg['message']}`))
        }
        return
      }

      if (msg['type'] === 'request') {
        const req = msg as unknown as IncomingRequest
        const { status, body, headers = {} } = replyWith(req)

        // Simulate the streaming protocol: DATA frame → END frame → JSON response
        const chunk = Buffer.from(body, 'utf8')
        ws.send(encodeStreamFrame({ requestId: req.id, frameType: STREAM_FRAME_TYPE.DATA, chunk }))
        ws.send(encodeStreamFrame({ requestId: req.id, frameType: STREAM_FRAME_TYPE.END }))

        const resp: ForwardResponse = {
          type: 'response',
          requestId: req.id,
          status,
          headers: { 'content-type': 'text/plain', ...headers },
          body: null, // streaming
          bodyEncoding: 'utf8',
          bodyTruncated: false,
          durationMs: 1,
        }
        ws.send(JSON.stringify(resp))
      }
    })

    ws.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err) }
    })

    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('Owner WS registration timed out')) }
    }, 3000)
  })
}

/**
 * Sends an HTTP GET to the relay for the given slug+path.
 * Returns { status, body }.
 */
function httpGet(base: string, slug: string, path = '/'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${base}/${slug}${path}`)
    const req = http.get({ hostname: url.hostname, port: Number(url.port), path: url.pathname }, (res) => {
      let body = ''
      res.on('data', (c: Buffer) => { body += c.toString() })
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    req.on('error', reject)
    req.setTimeout(4000, () => { req.destroy(new Error('HTTP request timed out')) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Round-trip: streaming response for all status codes', () => {
  let ctx: TestCtx

  beforeEach(async () => { ctx = await startRelay() })
  afterEach(async () => { await ctx.stop() })

  const cases: Array<{ status: number; body: string; label: string }> = [
    { status: 200, body: 'ok',                    label: '200 OK' },
    { status: 201, body: 'created',               label: '201 Created' },
    { status: 204, body: '',                       label: '204 No Content' },
    { status: 301, body: 'moved',                  label: '301 Moved Permanently' },
    { status: 400, body: 'bad request',            label: '400 Bad Request' },
    { status: 401, body: 'unauthorized',           label: '401 Unauthorized' },
    { status: 403, body: 'forbidden',              label: '403 Forbidden' },
    { status: 404, body: 'not found',              label: '404 Not Found' },
    { status: 422, body: 'unprocessable entity',   label: '422 Unprocessable Entity' },
    { status: 429, body: 'rate limited',           label: '429 Too Many Requests' },
    { status: 500, body: 'internal server error',  label: '500 Internal Server Error' },
    { status: 502, body: 'bad gateway',            label: '502 Bad Gateway' },
    { status: 503, body: 'service unavailable',    label: '503 Service Unavailable' },
  ]

  for (const { status, body, label } of cases) {
    test(label, async () => {
      const { teardown } = await connectOwner(ctx.wsBase, SLUG, () => ({ status, body }))
      try {
        const result = await httpGet(ctx.httpBase, SLUG)
        expect(result.status).toBe(status)
        if (body) expect(result.body).toBe(body)
      } finally {
        teardown()
      }
    })
  }
})

describe('Round-trip: multiple sequential requests on same connection', () => {
  let ctx: TestCtx

  beforeEach(async () => { ctx = await startRelay() })
  afterEach(async () => { await ctx.stop() })

  test('relay handles sequential requests with varying status codes', async () => {
    let callCount = 0
    const responses = [200, 404, 500, 201, 403]

    const { teardown } = await connectOwner(ctx.wsBase, SLUG, () => {
      const status = responses[callCount % responses.length]!
      callCount++
      return { status, body: `response-${status}` }
    })

    try {
      for (const expectedStatus of responses) {
        const result = await httpGet(ctx.httpBase, SLUG)
        expect(result.status).toBe(expectedStatus)
        expect(result.body).toBe(`response-${expectedStatus}`)
      }
    } finally {
      teardown()
    }
  })
})

describe('Round-trip: no owner connected', () => {
  let ctx: TestCtx

  beforeEach(async () => { ctx = await startRelay() })
  afterEach(async () => { await ctx.stop() })

  test('returns 502 when no owner is connected', async () => {
    const result = await httpGet(ctx.httpBase, 'ws-000000000000')
    expect(result.status).toBe(502)
  })
})

describe('Round-trip: large body passthrough', () => {
  let ctx: TestCtx

  beforeEach(async () => { ctx = await startRelay() })
  afterEach(async () => { await ctx.stop() })

  test('correctly reassembles a multi-chunk response body', async () => {
    // 100 KB response — enough to span multiple chunks
    const largeBody = 'x'.repeat(100_000)

    const { teardown } = await connectOwner(ctx.wsBase, SLUG, (_req) => {
      return { status: 200, body: largeBody }
    })

    try {
      const result = await httpGet(ctx.httpBase, SLUG)
      expect(result.status).toBe(200)
      expect(result.body).toBe(largeBody)
    } finally {
      teardown()
    }
  })
})
