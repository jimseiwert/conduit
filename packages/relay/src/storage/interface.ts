/**
 * Internal storage representation of a proxied HTTP request/response pair.
 * Headers are stored as JSON strings to avoid parse overhead on every insert.
 * Body is stored as a text column; binary bodies are base64-encoded first.
 */
export interface RequestRecord {
  id: string
  slug: string
  method: string
  path: string
  headersJson: string       // JSON.stringify(headers object)
  body: string | null
  bodyEncoding: 'utf8' | 'base64'
  bodyTruncated: boolean
  status: number | null
  responseHeadersJson: string | null
  responseBody: string | null
  responseBodyEncoding: 'utf8' | 'base64'
  responseBodyTruncated: boolean
  durationMs: number | null
  ts: number                // Unix milliseconds
}

export interface AdminSlugRecord {
  slug: string
  token: string
  userId: string
  webhookUrl: string
  createdAt: number
  expiresAt: number
}

export interface StorageAdapter {
  insertRequest(req: RequestRecord): Promise<void>
  fetchRequests(slug: string, ids?: string[], limit?: number): Promise<RequestRecord[]>
  registerSlug(slug: string, token: string, expiresAt: number): Promise<void>
  listAdminSlugs(userId: string): Promise<AdminSlugRecord[]>
  createAdminSlug(userId: string, slug: string, token: string, webhookUrl: string, expiresAt: number): Promise<AdminSlugRecord>
  deleteAdminSlug(slug: string, userId: string): Promise<boolean>
  /**
   * Validates that the given token matches the stored token for the slug and
   * that the token has not expired.
   *
   * Returns:
   *   'valid'     – token matches and expiry is in the future
   *   'expired'   – token matches but expiry has passed
   *   'invalid'   – slug exists but token does not match
   *   'not_found' – slug has never been registered
   */
  validateSlug(slug: string, token: string): Promise<'valid' | 'expired' | 'invalid' | 'not_found'>
  /**
   * Atomically replaces oldToken with newToken for the given slug.
   * Returns true if the update matched (oldToken was correct), false otherwise.
   */
  renewSlug(slug: string, oldToken: string, newToken: string, expiresAt: number): Promise<boolean>
  close(): Promise<void>
}
