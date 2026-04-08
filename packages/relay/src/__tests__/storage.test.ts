import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import type { StorageAdapter, RequestRecord } from '../storage/interface.js'
import { MemoryStorageAdapter } from '../storage/memory.js'
import { SqliteStorageAdapter } from '../storage/sqlite.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: crypto.randomUUID(),
    slug: 'test-slug',
    method: 'GET',
    path: '/hello',
    headersJson: '{"content-type":"application/json"}',
    body: null,
    bodyEncoding: 'utf8',
    bodyTruncated: false,
    status: null,
    responseHeadersJson: null,
    responseBody: null,
    responseBodyEncoding: 'utf8',
    responseBodyTruncated: false,
    durationMs: null,
    ts: Date.now(),
    ...overrides,
  }
}

const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60

function futureExpiry(): number {
  return Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
}

function pastExpiry(): number {
  return Math.floor(Date.now() / 1000) - 1
}

// ── Shared suite ──────────────────────────────────────────────────────────────

function runStorageSuite(name: string, factory: () => StorageAdapter): void {
  describe(name, () => {
    let adapter: StorageAdapter

    beforeEach(() => {
      adapter = factory()
    })

    afterEach(async () => {
      await adapter.close()
    })

    // ── insertRequest / fetchRequests ─────────────────────────────────────

    test('insertRequest then fetchRequests returns the record', async () => {
      const rec = makeRecord()
      await adapter.insertRequest(rec)
      const results = await adapter.fetchRequests(rec.slug)
      expect(results.length).toBe(1)
      expect(results[0]!.id).toBe(rec.id)
    })

    test('fetchRequests by ids filters correctly', async () => {
      const rec1 = makeRecord()
      const rec2 = makeRecord()
      await adapter.insertRequest(rec1)
      await adapter.insertRequest(rec2)

      const results = await adapter.fetchRequests(rec1.slug, [rec1.id])
      expect(results.length).toBe(1)
      expect(results[0]!.id).toBe(rec1.id)
    })

    test('fetchRequests respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await adapter.insertRequest(makeRecord({ ts: Date.now() + i }))
      }
      const results = await adapter.fetchRequests('test-slug', undefined, 5)
      expect(results.length).toBe(5)
    })

    test('fetchRequests returns records only for the given slug', async () => {
      await adapter.insertRequest(makeRecord({ slug: 'slug-a' }))
      await adapter.insertRequest(makeRecord({ slug: 'slug-b' }))
      const results = await adapter.fetchRequests('slug-a')
      expect(results.length).toBe(1)
      expect(results[0]!.slug).toBe('slug-a')
    })

    test('fetchRequests with empty ids returns recent records', async () => {
      const rec = makeRecord()
      await adapter.insertRequest(rec)
      const results = await adapter.fetchRequests(rec.slug, [])
      expect(results.length).toBe(1)
    })

    // ── Ring buffer eviction ──────────────────────────────────────────────

    test('ring buffer evicts oldest records when over capacity', async () => {
      const smallAdapter = name.includes('Memory')
        ? new MemoryStorageAdapter(3)
        : new SqliteStorageAdapter({ path: ':memory:', ringBufferSize: 3 })

      try {
        const ids: string[] = []
        for (let i = 0; i < 5; i++) {
          const rec = makeRecord({ ts: Date.now() + i })
          ids.push(rec.id)
          await smallAdapter.insertRequest(rec)
        }

        const results = await smallAdapter.fetchRequests('test-slug', undefined, 10)
        expect(results.length).toBe(3)

        // The oldest 2 should have been evicted
        const resultIds = new Set(results.map((r) => r.id))
        expect(resultIds.has(ids[0]!)).toBe(false)
        expect(resultIds.has(ids[1]!)).toBe(false)
        expect(resultIds.has(ids[4]!)).toBe(true)
      } finally {
        await smallAdapter.close()
      }
    })

    // ── registerSlug / validateSlug ───────────────────────────────────────

    test('validateSlug returns not_found for unknown slug', async () => {
      const result = await adapter.validateSlug('unknown-slug', 'any-token')
      expect(result).toBe('not_found')
    })

    test('registerSlug then validateSlug with correct token returns valid', async () => {
      await adapter.registerSlug('my-slug', 'my-token', futureExpiry())
      const result = await adapter.validateSlug('my-slug', 'my-token')
      expect(result).toBe('valid')
    })

    test('validateSlug with wrong token returns invalid', async () => {
      await adapter.registerSlug('my-slug', 'correct-token', futureExpiry())
      const result = await adapter.validateSlug('my-slug', 'wrong-token')
      expect(result).toBe('invalid')
    })

    test('validateSlug with expired token returns expired', async () => {
      await adapter.registerSlug('my-slug', 'my-token', pastExpiry())
      const result = await adapter.validateSlug('my-slug', 'my-token')
      expect(result).toBe('expired')
    })

    // ── renewSlug ─────────────────────────────────────────────────────────

    test('renewSlug with correct old token returns true and updates token', async () => {
      await adapter.registerSlug('my-slug', 'old-token', futureExpiry())
      const renewed = await adapter.renewSlug('my-slug', 'old-token', 'new-token', futureExpiry())
      expect(renewed).toBe(true)

      // Old token should now be invalid
      const oldResult = await adapter.validateSlug('my-slug', 'old-token')
      expect(oldResult).toBe('invalid')

      // New token should be valid
      const newResult = await adapter.validateSlug('my-slug', 'new-token')
      expect(newResult).toBe('valid')
    })

    test('renewSlug with wrong old token returns false', async () => {
      await adapter.registerSlug('my-slug', 'correct-token', futureExpiry())
      const renewed = await adapter.renewSlug('my-slug', 'wrong-token', 'new-token', futureExpiry())
      expect(renewed).toBe(false)

      // Original token should still be valid
      const result = await adapter.validateSlug('my-slug', 'correct-token')
      expect(result).toBe('valid')
    })

    test('renewSlug on non-existent slug returns false', async () => {
      const renewed = await adapter.renewSlug('ghost-slug', 'old', 'new', futureExpiry())
      expect(renewed).toBe(false)
    })

    // ── 90-day expiry ─────────────────────────────────────────────────────

    test('90-day token expiry: just-expired token returns expired', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) - 1 // expired 1 second ago
      await adapter.registerSlug('my-slug', 'my-token', expiresAt)
      const result = await adapter.validateSlug('my-slug', 'my-token')
      expect(result).toBe('expired')
    })

    test('90-day token expiry: future expiry returns valid', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
      await adapter.registerSlug('my-slug', 'my-token', expiresAt)
      const result = await adapter.validateSlug('my-slug', 'my-token')
      expect(result).toBe('valid')
    })

    // ── Update record (upsert) ─────────────────────────────────────────────

    test('insertRequest with same id updates the record', async () => {
      const rec = makeRecord()
      await adapter.insertRequest(rec)

      const updated: RequestRecord = {
        ...rec,
        status: 200,
        responseBody: 'hello',
        responseHeadersJson: '{"content-type":"text/plain"}',
        durationMs: 42,
      }
      await adapter.insertRequest(updated)

      const results = await adapter.fetchRequests(rec.slug, [rec.id])
      expect(results.length).toBe(1)
      expect(results[0]!.status).toBe(200)
      expect(results[0]!.responseBody).toBe('hello')
      expect(results[0]!.durationMs).toBe(42)
    })
  })
}

// ── Run suites for each adapter ───────────────────────────────────────────────

runStorageSuite('MemoryStorageAdapter', () => new MemoryStorageAdapter(1000))

// better-sqlite3 uses a native addon that Bun cannot load; skip under Bun.
// The SQLite adapter is tested via Node.js in CI.
const isBun = typeof Bun !== 'undefined'
if (!isBun) {
  runStorageSuite('SqliteStorageAdapter', () => new SqliteStorageAdapter({ path: ':memory:', ringBufferSize: 1000 }))
} else {
  describe('SqliteStorageAdapter', () => {
    test('skipped: better-sqlite3 requires Node.js (not Bun)', () => {
      // intentional no-op
    })
  })
}
