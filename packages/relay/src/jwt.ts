import jwt from 'jsonwebtoken'

/** 90 days in seconds */
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * Issues a new slug token signed with the relay's JWT secret.
 * The payload includes the slug claim for validation during renewal.
 */
export function issueSlugToken(slug: string, secret: string): string {
  return jwt.sign({ slug }, secret, { expiresIn: TOKEN_TTL_SECONDS })
}

/**
 * Verifies the token signature and expiry, returning the payload if valid.
 * Returns null if the token is invalid, expired, or malformed.
 */
export function verifySlugToken(token: string, secret: string): { slug: string } | null {
  try {
    const payload = jwt.verify(token, secret) as { slug: string }
    return payload
  } catch {
    return null
  }
}

/**
 * Decodes the token payload WITHOUT verifying the signature or expiry.
 * Used during the renewal flow to extract the slug claim before calling
 * the full verify step.
 */
export function decodeSlugTokenUnsafe(token: string): { slug: string; exp: number } | null {
  try {
    const decoded = jwt.decode(token)
    if (!decoded || typeof decoded !== 'object') return null
    return decoded as { slug: string; exp: number }
  } catch {
    return null
  }
}

/**
 * Returns the expiry timestamp (Unix seconds) for a new token issued now.
 * Used when registering a slug to store the expiry in the storage adapter.
 */
export function tokenExpiresAt(): number {
  return Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
}
