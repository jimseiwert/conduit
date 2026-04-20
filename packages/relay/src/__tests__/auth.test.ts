/**
 * Auth enforcement tests for the relay owner WebSocket.
 * Verifies that authRequired=true blocks unauthenticated connections
 * and accepts valid userToken (JWT) and registrationToken paths.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'net'
import jwt from 'jsonwebtoken'
import { createServer } from '../server.js'
import { MemoryStorageAdapter } from '../storage/memory.js'
import type { RelayConfig } from '../config.js'

const JWT_SECRET = 'test-auth-secret'
const SLUG = 'ws-aabbccddeeff'

const baseConfig: RelayConfig = {
  port: 0,
  jwtSecret: JWT_SECRET,
  registrationToken: undefined,
  ringBufferSize: 50,
  maxBodyBytes: 1_048_576,
  forwardTimeoutMs: 3_000,
  storageAdapter: 'memory',
  relayDomain: '127.0.0.1',
  relayProto: 'http',
}

async function startRelay(overrides: Partial<RelayConfig> = {}) {
  const config: RelayConfig = { ...baseConfig, ...overrides }
  const storage = new MemoryStorageAdapter(config.ringBufferSize)
  const app = await createServer(config, storage)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address() as AddressInfo
  return {
    wsBase: `ws://127.0.0.1:${addr.port}`,
    stop: async () => { await app.close(); await storage.close() },
  }
}

function connectOwner(wsBase: string, msg: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/${SLUG}`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('Timeout waiting for relay response'))
    }, 3_000)

    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw) => {
      clearTimeout(timer)
      ws.close()
      resolve(JSON.parse(raw.toString()))
    })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

describe('relay auth — authRequired=true', () => {
  let relay: { wsBase: string; stop: () => Promise<void> }

  beforeEach(async () => {
    relay = await startRelay({ authRequired: true })
  })
  afterEach(async () => { await relay.stop() })

  test('rejects connection with no token (AUTH_REQUIRED)', async () => {
    const msg = await connectOwner(relay.wsBase, { type: 'register', slug: SLUG })
    expect((msg as any).type).toBe('error')
    expect((msg as any).code).toBe('AUTH_REQUIRED')
  })

  test('rejects connection with invalid userToken', async () => {
    const badToken = jwt.sign({ userId: 'u1', type: 'cli' }, 'wrong-secret', { expiresIn: '1h' })
    const msg = await connectOwner(relay.wsBase, { type: 'register', slug: SLUG, userToken: badToken })
    expect((msg as any).type).toBe('error')
    expect((msg as any).code).toBe('AUTH_REQUIRED')
  })

  test('accepts connection with valid userToken', async () => {
    const token = jwt.sign({ userId: 'u1', type: 'cli' }, JWT_SECRET, { expiresIn: '1h' })
    const msg = await connectOwner(relay.wsBase, { type: 'register', slug: SLUG, userToken: token })
    expect((msg as any).type).toBe('registered')
    expect((msg as any).slug).toBe(SLUG)
  })

  test('accepts connection with valid registrationToken', async () => {
    const registrationToken = 'my-shared-secret'
    relay.stop()
    relay = await startRelay({ authRequired: true, registrationToken })

    const msg = await connectOwner(relay.wsBase, { type: 'register', slug: SLUG, registrationToken })
    expect((msg as any).type).toBe('registered')
  })

  test('rejects wrong registrationToken', async () => {
    const registrationToken = 'my-shared-secret'
    relay.stop()
    relay = await startRelay({ authRequired: true, registrationToken })

    const msg = await connectOwner(relay.wsBase, { type: 'register', slug: SLUG, registrationToken: 'wrong' })
    expect((msg as any).type).toBe('error')
    expect((msg as any).code).toBe('AUTH_REQUIRED')
  })
})

describe('relay auth — authRequired=false (open relay)', () => {
  let relay: { wsBase: string; stop: () => Promise<void> }

  beforeEach(async () => {
    relay = await startRelay({ authRequired: false })
  })
  afterEach(async () => { await relay.stop() })

  test('accepts connection with no token', async () => {
    const msg = await connectOwner(relay.wsBase, { type: 'register', slug: SLUG })
    expect((msg as any).type).toBe('registered')
    expect((msg as any).slug).toBe(SLUG)
  })
})
