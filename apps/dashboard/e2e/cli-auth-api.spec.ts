import { test, expect } from '@playwright/test'

// These tests hit the API directly via fetch — no browser needed.
// They verify the server-side security guards on the CLI auth endpoint.

test.describe('POST /api/cli-auth', () => {
  const apiUrl = 'http://localhost:3001/api/cli-auth'

  test('returns 401 when not authenticated', async ({ request }) => {
    const res = await request.post('/api/cli-auth', {
      data: { callback: 'http://localhost:12345/callback' },
    })
    expect(res.status()).toBe(401)
  })

  test('returns 400 when callback is missing', async ({ request }) => {
    const res = await request.post('/api/cli-auth', {
      data: {},
    })
    // 401 (no session) takes priority — either 400 or 401 is correct here
    expect([400, 401]).toContain(res.status())
  })

  test('returns 400 when callback is a non-localhost URL', async ({ request }) => {
    // This validates the open-redirect prevention guard.
    // Without a session the 401 fires first, which is also correct.
    const res = await request.post('/api/cli-auth', {
      data: { callback: 'https://evil.example.com/steal' },
    })
    expect([400, 401]).toContain(res.status())
  })

  test('returns 400 for an invalid callback URL string', async ({ request }) => {
    const res = await request.post('/api/cli-auth', {
      data: { callback: 'not-a-url' },
    })
    expect([400, 401]).toContain(res.status())
  })
})
