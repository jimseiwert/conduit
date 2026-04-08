import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { RelayConfig } from '../config.js'
import type { StorageAdapter } from '../storage/interface.js'
import {
  decodeSlugTokenUnsafe,
  verifySlugToken,
  issueSlugToken,
  tokenExpiresAt,
} from '../jwt.js'

interface RenewRoutesOptions {
  config: RelayConfig
  storage: StorageAdapter
}

interface RenewParams {
  slug: string
}

/**
 * POST /tunnel/:slug/renew
 *
 * Renews the slug token using the existing token as proof of ownership.
 * The old token's signature is verified and its slug claim must match the
 * URL parameter before a new token is issued.
 */
export async function renewRoutes(
  app: FastifyInstance,
  opts: RenewRoutesOptions,
): Promise<void> {
  const { config, storage } = opts

  app.post<{ Params: RenewParams }>(
    '/tunnel/:slug/renew',
    async (req: FastifyRequest<{ Params: RenewParams }>, reply: FastifyReply) => {
      const { slug } = req.params

      // Extract Bearer token from Authorization header
      const authHeader = req.headers['authorization'] ?? ''
      if (!authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authorization: Bearer <token> header required' })
      }
      const oldToken = authHeader.slice(7).trim()
      if (!oldToken) {
        return reply.code(401).send({ error: 'Empty token' })
      }

      // Decode without verification to extract slug claim
      const decoded = decodeSlugTokenUnsafe(oldToken)
      if (!decoded) {
        return reply.code(400).send({ error: 'Could not decode token' })
      }

      // Assert slug claim matches URL parameter
      if (decoded.slug !== slug) {
        return reply
          .code(400)
          .send({ error: `Token slug "${decoded.slug}" does not match requested slug "${slug}"` })
      }

      // Verify signature (may be expired — we allow renewal of expired tokens)
      const verified = verifySlugToken(oldToken, config.jwtSecret)
      if (!verified) {
        // Token signature invalid — reject
        return reply.code(401).send({ error: 'Invalid token signature' })
      }

      // Issue new token and atomically replace in storage
      const newToken = issueSlugToken(slug, config.jwtSecret)
      const newExpiresAt = tokenExpiresAt()
      const renewed = await storage.renewSlug(slug, oldToken, newToken, newExpiresAt)

      if (!renewed) {
        return reply
          .code(409)
          .send({ error: 'Token mismatch — the stored token does not match the provided token' })
      }

      return reply.code(200).send({ token: newToken })
    },
  )
}
