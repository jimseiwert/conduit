const RELAY_URL = process.env.RELAY_INTERNAL_URL ?? 'https://relay.conduitrelay.com'
const RELAY_ADMIN_SECRET = process.env.RELAY_ADMIN_SECRET!

export interface SlugRecord {
  slug: string
  token: string
  webhookUrl: string
  createdAt: number
  expiresAt: number
}

export interface RequestRecord {
  id: string
  slug: string
  method: string
  path: string
  status: number | null
  durationMs: number | null
  ts: number
}

export async function listSlugs(userId: string): Promise<SlugRecord[]> {
  const res = await fetch(`${RELAY_URL}/admin/slugs?userId=${encodeURIComponent(userId)}`, {
    headers: { 'x-admin-secret': RELAY_ADMIN_SECRET },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Relay error: ${res.status}`)
  return res.json() as Promise<SlugRecord[]>
}

export async function createSlug(userId: string): Promise<SlugRecord> {
  const res = await fetch(`${RELAY_URL}/admin/slugs`, {
    method: 'POST',
    headers: {
      'x-admin-secret': RELAY_ADMIN_SECRET,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) throw new Error(`Relay error: ${res.status}`)
  return res.json() as Promise<SlugRecord>
}

export async function deleteSlug(slug: string, userId: string): Promise<void> {
  const res = await fetch(`${RELAY_URL}/admin/slugs/${slug}`, {
    method: 'DELETE',
    headers: {
      'x-admin-secret': RELAY_ADMIN_SECRET,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) throw new Error(`Relay error: ${res.status}`)
}

export async function listRequests(slug: string, limit = 50): Promise<RequestRecord[]> {
  const res = await fetch(`${RELAY_URL}/admin/slugs/${slug}/requests?limit=${limit}`, {
    headers: { 'x-admin-secret': RELAY_ADMIN_SECRET },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Relay error: ${res.status}`)
  return res.json() as Promise<RequestRecord[]>
}
