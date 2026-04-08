import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import type {
  TunnelRegistered,
  TunnelError,
  RegisterTunnel,
} from '@conduit/types'
import { createServer } from '../server.js'
import { MemoryStorageAdapter } from '../storage/memory.js'
import type { RelayConfig } from '../config.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'test-jwt-secret-for-ws-tests'

const defaultConfig: RelayConfig = {
  port: 0,
  jwtSecret: TEST_JWT_SECRET,
  registrationToken: undefined,
  ringBufferSize: 100,
  maxBodyBytes: 1_048_576,
  forwardTimeoutMs: 5_000,
  storageAdapter: 'memory',
}

interface TestContext {
  url: string
  stop: () => Promise<void>
  storage: MemoryStorageAdapter
}

async function startTestServer(configOverrides: Partial<RelayConfig> = {}): Promise<TestContext> {
  const config: RelayConfig = { ...defaultConfig, ...configOverrides }
  const storage = new MemoryStorageAdapter(config.ringBufferSize)
  const app = await createServer(config, storage)

  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address() as AddressInfo
  const url = `ws://127.0.0.1:${address.port}`

  return {
    url,
    storage,
    stop: async () => {
      await app.close()
      await storage.close()
    },
  }
}

/**
 * Opens a WebSocket connection and waits for the first JSON message.
 */
function connectAndReceive(
  wsUrl: string,
  sendMsg?: object,
  headers?: Record<string, string>,
): Promise<{ ws: WebSocket; firstMsg: unknown }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers })
    let resolved = false

    ws.on('open', () => {
      if (sendMsg) {
        ws.send(JSON.stringify(sendMsg))
      }
    })

    ws.on('message', (data) => {
      if (resolved) return
      resolved = true
      const msg = JSON.parse(data.toString()) as unknown
      resolve({ ws, firstMsg: msg })
    })

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true
        reject(err)
      }
    })

    setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('WebSocket timed out waiting for first message'))
      }
    }, 3000)
  })
}


function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) {
      resolve()
      return
    }
    ws.on('close', () => resolve())
    ws.close()
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Owner WebSocket — registration', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await startTestServer()
  })

  afterEach(async () => {
    await ctx.stop()
  })

  test('first registration returns TunnelRegistered with a token', async () => {
    const registerMsg: RegisterTunnel = {
      type: 'register',
      slug: 'my-slug',
      httpEnabled: false,
    }
    const { ws, firstMsg } = await connectAndReceive(`${ctx.url}/conduit/my-slug`, registerMsg)
    await closeWs(ws)

    expect((firstMsg as TunnelRegistered).type).toBe('registered')
    expect((firstMsg as TunnelRegistered).slug).toBe('my-slug')
    expect(typeof (firstMsg as TunnelRegistered).token).toBe('string')
    expect((firstMsg as TunnelRegistered).token.length).toBeGreaterThan(10)
  })

  test('reconnect with valid token returns TunnelRegistered', async () => {
    // First connect to get a token
    const registerMsg: RegisterTunnel = { type: 'register', slug: 'reconnect-slug', httpEnabled: false }
    const { ws: ws1, firstMsg } = await connectAndReceive(
      `${ctx.url}/conduit/reconnect-slug`,
      registerMsg,
    )
    const token = (firstMsg as TunnelRegistered).token
    await closeWs(ws1)

    // Allow grace period to avoid SLUG_IN_USE (ws1 is closed → clearOwner called)
    await new Promise((r) => setTimeout(r, 50))

    // Reconnect with the token
    const reconnectMsg: RegisterTunnel = { type: 'register', slug: 'reconnect-slug', token, httpEnabled: false }
    const { ws: ws2, firstMsg: secondMsg } = await connectAndReceive(
      `${ctx.url}/conduit/reconnect-slug`,
      reconnectMsg,
    )
    await closeWs(ws2)

    expect((secondMsg as TunnelRegistered).type).toBe('registered')
    expect((secondMsg as TunnelRegistered).slug).toBe('reconnect-slug')
  })

  test('SLUG_IN_USE: second owner connection is rejected', async () => {
    const registerMsg: RegisterTunnel = { type: 'register', slug: 'busy-slug', httpEnabled: false }

    // First connection — should succeed
    const { ws: ws1 } = await connectAndReceive(`${ctx.url}/conduit/busy-slug`, registerMsg)

    // Second connection — should get SLUG_IN_USE error
    const { ws: ws2, firstMsg } = await connectAndReceive(
      `${ctx.url}/conduit/busy-slug`,
      registerMsg,
    )
    await closeWs(ws1)
    await closeWs(ws2)

    expect((firstMsg as TunnelError).type).toBe('error')
    expect((firstMsg as TunnelError).code).toBe('SLUG_IN_USE')
  })

  test('INVALID_TOKEN: wrong token returns TunnelError', async () => {
    // Register first to create the slug in storage
    const registerMsg: RegisterTunnel = { type: 'register', slug: 'token-slug', httpEnabled: false }
    const { ws: ws1 } = await connectAndReceive(`${ctx.url}/conduit/token-slug`, registerMsg)
    await closeWs(ws1)

    await new Promise((r) => setTimeout(r, 50))

    // Try to reconnect with a wrong token
    const badTokenMsg: RegisterTunnel = {
      type: 'register',
      slug: 'token-slug',
      token: 'this-is-not-the-right-token',
      httpEnabled: false,
    }
    const { ws: ws2, firstMsg } = await connectAndReceive(
      `${ctx.url}/conduit/token-slug`,
      badTokenMsg,
    )
    await closeWs(ws2)

    expect((firstMsg as TunnelError).type).toBe('error')
    expect((firstMsg as TunnelError).code).toBe('INVALID_TOKEN')
  })

  test('PARSE_ERROR: malformed JSON does not close the connection', async () => {
    const slug = 'parse-error-slug'
    const ws = new WebSocket(`${ctx.url}/conduit/${slug}`)

    // Wait for open
    await new Promise<void>((resolve) => ws.on('open', resolve))

    // Send valid registration first — server sends `registered` then `watcherCount`
    const firstMsgPromise = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as unknown))
    })
    ws.send(JSON.stringify({ type: 'register', slug, httpEnabled: false }))
    const registered = await firstMsgPromise
    expect((registered as TunnelRegistered).type).toBe('registered')

    // Drain the `watcherCount` broadcast that always follows registration
    await new Promise<void>((resolve) => ws.once('message', () => resolve()))

    // Send malformed JSON — relay should send PARSE_ERROR but NOT close the connection
    const parseErrPromise = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as unknown))
    })
    ws.send('{{not valid json}}')
    const parseErrMsg = await parseErrPromise

    expect((parseErrMsg as TunnelError).type).toBe('error')
    expect((parseErrMsg as TunnelError).code).toBe('PARSE_ERROR')

    // Connection should still be open after a parse error
    expect(ws.readyState).toBe(WebSocket.OPEN)

    await closeWs(ws)
  })

  test('registration token gate rejects missing token', async () => {
    const ctx2 = await startTestServer({ registrationToken: 'secret-gate' })
    try {
      const registerMsg: RegisterTunnel = { type: 'register', slug: 'gated-slug', httpEnabled: false }
      const { ws, firstMsg } = await connectAndReceive(`${ctx2.url}/conduit/gated-slug`, registerMsg)
      await closeWs(ws)

      expect((firstMsg as TunnelError).type).toBe('error')
      expect((firstMsg as TunnelError).code).toBe('AUTH_REQUIRED')
    } finally {
      await ctx2.stop()
    }
  })

  test('registration token gate accepts correct token', async () => {
    const ctx2 = await startTestServer({ registrationToken: 'secret-gate' })
    try {
      const registerMsg: RegisterTunnel = {
        type: 'register',
        slug: 'gated-slug',
        registrationToken: 'secret-gate',
        httpEnabled: false,
      }
      const { ws, firstMsg } = await connectAndReceive(`${ctx2.url}/conduit/gated-slug`, registerMsg)
      await closeWs(ws)

      expect((firstMsg as TunnelRegistered).type).toBe('registered')
    } finally {
      await ctx2.stop()
    }
  })
})

describe('Owner WebSocket — grace period', () => {
  test('reconnect within 30s grace period succeeds', async () => {
    const ctx = await startTestServer()
    try {
      const slug = 'grace-slug'

      // First connect, get token, then close
      const registerMsg: RegisterTunnel = { type: 'register', slug, httpEnabled: false }
      const { ws: ws1, firstMsg } = await connectAndReceive(`${ctx.url}/conduit/${slug}`, registerMsg)
      const token = (firstMsg as TunnelRegistered).token
      await closeWs(ws1)

      // Reconnect immediately (within grace period)
      await new Promise((r) => setTimeout(r, 20))

      const reconnectMsg: RegisterTunnel = { type: 'register', slug, token, httpEnabled: false }
      const { ws: ws2, firstMsg: secondMsg } = await connectAndReceive(
        `${ctx.url}/conduit/${slug}`,
        reconnectMsg,
      )
      await closeWs(ws2)

      expect((secondMsg as TunnelRegistered).type).toBe('registered')
      expect((secondMsg as TunnelRegistered).slug).toBe(slug)
    } finally {
      await ctx.stop()
    }
  })
})

describe('Watcher WebSocket', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await startTestServer()
  })

  afterEach(async () => {
    await ctx.stop()
  })

  test('watcher with valid token joins successfully', async () => {
    const slug = 'watch-slug'

    // Register owner first
    const registerMsg: RegisterTunnel = { type: 'register', slug, httpEnabled: false }
    const { ws: ownerWs, firstMsg } = await connectAndReceive(
      `${ctx.url}/conduit/${slug}`,
      registerMsg,
    )
    const token = (firstMsg as TunnelRegistered).token

    // Connect watcher with token in Authorization header
    const { ws: watcherWs, firstMsg: watcherMsg } = await connectAndReceive(
      `${ctx.url}/conduit/${slug}/watch`,
      undefined,
      { authorization: `Bearer ${token}` },
    )

    // Watcher should receive WatcherCount broadcast
    expect((watcherMsg as { type: string }).type).toBe('watcherCount')
    expect((watcherMsg as { type: string; count: number }).count).toBe(1)

    await closeWs(ownerWs)
    await closeWs(watcherWs)
  })

  test('watcher without token is rejected with AUTH_REQUIRED', async () => {
    const slug = 'watch-auth-slug'

    // Register owner
    const registerMsg: RegisterTunnel = { type: 'register', slug, httpEnabled: false }
    const { ws: ownerWs } = await connectAndReceive(`${ctx.url}/conduit/${slug}`, registerMsg)

    // Connect watcher without token
    const { ws: watcherWs, firstMsg } = await connectAndReceive(
      `${ctx.url}/conduit/${slug}/watch`,
    )

    await closeWs(ownerWs)
    await closeWs(watcherWs)

    expect((firstMsg as TunnelError).type).toBe('error')
    expect((firstMsg as TunnelError).code).toBe('AUTH_REQUIRED')
  })

  test('watcher with wrong token is rejected', async () => {
    const slug = 'watch-wrong-token-slug'

    // Register owner
    const registerMsg: RegisterTunnel = { type: 'register', slug, httpEnabled: false }
    const { ws: ownerWs } = await connectAndReceive(`${ctx.url}/conduit/${slug}`, registerMsg)

    // Connect watcher with wrong token
    const { ws: watcherWs, firstMsg } = await connectAndReceive(
      `${ctx.url}/conduit/${slug}/watch`,
      undefined,
      { authorization: 'Bearer wrong-token' },
    )

    await closeWs(ownerWs)
    await closeWs(watcherWs)

    expect((firstMsg as TunnelError).type).toBe('error')
    expect(
      (firstMsg as TunnelError).code === 'AUTH_REQUIRED' ||
        (firstMsg as TunnelError).code === 'INVALID_TOKEN',
    ).toBe(true)
  })
})

describe('HTTP health check', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await startTestServer()
  })

  afterEach(async () => {
    await ctx.stop()
  })

  test('GET /health returns 200', async () => {
    const address = ctx.url.replace('ws://', 'http://')
    const response = await fetch(`${address}/health`)
    expect(response.status).toBe(200)
    const body = await response.json() as { status: string }
    expect(body.status).toBe('ok')
  })
})
