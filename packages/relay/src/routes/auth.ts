import { randomBytes } from 'crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import type { RelayConfig } from '../config.js'

interface AuthRoutesOptions {
  config: RelayConfig
}

interface PendingAuth {
  clientType: 'cli' | 'vscode'
  expiresAt: number
  nonce: string
}

/** TTL for OIDC nonce / state entries: 5 minutes. */
const NONCE_TTL_MS = 300_000

/** User token lifetime: 15 minutes. */
const USER_TOKEN_TTL_SECONDS = 15 * 60

interface UserTokenPayload {
  userId: string
  email: string
  provider: string
}

function issueUserToken(payload: UserTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: USER_TOKEN_TTL_SECONDS })
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Auth Error</title></head>
<body>
<h1>Authentication Error</h1>
<p>${message}</p>
</body>
</html>`
}

export async function authRoutes(
  app: FastifyInstance,
  opts: AuthRoutesOptions,
): Promise<void> {
  const { config } = opts

  if (!config.authProvider) {
    // Auth not configured — skip registering routes
    return
  }

  /** Map of nonce → pending auth session. */
  const pendingAuthMap = new Map<string, PendingAuth>()

  function sweepExpiredNonces(): void {
    const now = Date.now()
    for (const [nonce, entry] of pendingAuthMap) {
      if (entry.expiresAt <= now) {
        pendingAuthMap.delete(nonce)
      }
    }
  }

  if (config.authProvider === 'oidc') {
    await setupOidcRoutes(app, config, pendingAuthMap, sweepExpiredNonces)
  } else if (config.authProvider === 'msal') {
    await setupMsalRoutes(app, config, pendingAuthMap, sweepExpiredNonces)
  }
}

async function setupOidcRoutes(
  app: FastifyInstance,
  config: RelayConfig,
  pendingAuthMap: Map<string, PendingAuth>,
  sweepExpiredNonces: () => void,
): Promise<void> {
  // Lazily import openid-client to avoid import errors when auth is not used
  const oidcClient = await import('openid-client')

  if (!config.oidcIssuer || !config.oidcClientId || !config.oidcClientSecret) {
    throw new Error('OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET are required for OIDC auth')
  }

  const serverConfig = await oidcClient.discovery(
    new URL(config.oidcIssuer),
    config.oidcClientId,
    config.oidcClientSecret,
  )

  app.get(
    '/auth/login',
    async (
      req: FastifyRequest<{ Querystring: { clientType?: string } }>,
      reply: FastifyReply,
    ) => {
      sweepExpiredNonces()

      const clientType = req.query.clientType === 'vscode' ? 'vscode' : ('cli' as const)
      const nonce = randomBytes(16).toString('hex')
      const state = `${nonce}:${clientType}`

      pendingAuthMap.set(nonce, {
        clientType,
        expiresAt: Date.now() + NONCE_TTL_MS,
        nonce,
      })

      const params: Record<string, string> = {
        redirect_uri: config.oidcRedirectUri ?? '',
        scope: 'openid email profile',
        state,
        nonce,
      }

      const authUrl = oidcClient.buildAuthorizationUrl(serverConfig, params)
      return reply.redirect(authUrl.href)
    },
  )

  app.get(
    '/auth/callback',
    async (
      req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
      reply: FastifyReply,
    ) => {
      const { state, error } = req.query

      if (error) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(errorPage(`OAuth error: ${error}`))
      }

      if (!state) {
        return reply.code(400).header('content-type', 'text/html').send(errorPage('Missing state parameter'))
      }

      const colonIdx = state.indexOf(':')
      if (colonIdx === -1) {
        return reply.code(400).header('content-type', 'text/html').send(errorPage('Invalid state parameter'))
      }
      const nonce = state.substring(0, colonIdx)
      const clientType = state.substring(colonIdx + 1) as 'cli' | 'vscode'

      const session = pendingAuthMap.get(nonce)
      if (!session || session.expiresAt <= Date.now()) {
        pendingAuthMap.delete(nonce)
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(errorPage('Auth session expired. Please try again.'))
      }
      pendingAuthMap.delete(nonce)

      // Build the full callback URL for the OIDC code exchange
      const callbackUrl = new URL(
        req.url,
        `${req.protocol}://${req.hostname}`,
      )

      let tokens
      try {
        tokens = await oidcClient.authorizationCodeGrant(serverConfig, callbackUrl, {
          pkceCodeVerifier: undefined,
          expectedState: state,
          expectedNonce: nonce,
        })
      } catch (err) {
        app.log.error({ err }, 'OIDC token exchange failed')
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(errorPage('Authentication failed. Please try again.'))
      }

      const claims = tokens.claims()
      const userId = (claims?.sub as string) ?? ''
      const email = (claims?.email as string) ?? ''

      const userToken = issueUserToken({ userId, email, provider: 'oidc' }, config.jwtSecret)

      return redirectToClient(reply, clientType, userToken, config.port)
    },
  )
}

async function setupMsalRoutes(
  app: FastifyInstance,
  config: RelayConfig,
  pendingAuthMap: Map<string, PendingAuth>,
  sweepExpiredNonces: () => void,
): Promise<void> {
  const { ConfidentialClientApplication } = await import('@azure/msal-node')

  if (!config.msalTenantId || !config.msalClientId || !config.msalClientSecret) {
    throw new Error('MSAL_TENANT_ID, MSAL_CLIENT_ID, and MSAL_CLIENT_SECRET are required for MSAL auth')
  }

  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId: config.msalClientId,
      authority: `https://login.microsoftonline.com/${config.msalTenantId}`,
      clientSecret: config.msalClientSecret,
    },
  })

  const redirectUri = config.oidcRedirectUri ?? `http://localhost:${config.port}/auth/callback`

  app.get(
    '/auth/login',
    async (
      req: FastifyRequest<{ Querystring: { clientType?: string } }>,
      reply: FastifyReply,
    ) => {
      sweepExpiredNonces()

      const clientType = req.query.clientType === 'vscode' ? 'vscode' : ('cli' as const)
      const nonce = randomBytes(16).toString('hex')
      const state = `${nonce}:${clientType}`

      pendingAuthMap.set(nonce, {
        clientType,
        expiresAt: Date.now() + NONCE_TTL_MS,
        nonce,
      })

      const authUrl = await msalApp.getAuthCodeUrl({
        redirectUri,
        scopes: ['openid', 'email', 'profile'],
        state,
      })

      return reply.redirect(authUrl)
    },
  )

  app.get(
    '/auth/callback',
    async (
      req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
      reply: FastifyReply,
    ) => {
      const { code, state, error } = req.query

      if (error) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(errorPage(`Auth error: ${error}`))
      }

      if (!state) {
        return reply.code(400).header('content-type', 'text/html').send(errorPage('Missing state parameter'))
      }

      const colonIdx = state.indexOf(':')
      if (colonIdx === -1) {
        return reply.code(400).header('content-type', 'text/html').send(errorPage('Invalid state parameter'))
      }
      const nonce = state.substring(0, colonIdx)
      const clientType = state.substring(colonIdx + 1) as 'cli' | 'vscode'

      const session = pendingAuthMap.get(nonce)
      if (!session || session.expiresAt <= Date.now()) {
        pendingAuthMap.delete(nonce)
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(errorPage('Auth session expired. Please try again.'))
      }
      pendingAuthMap.delete(nonce)

      if (!code) {
        return reply.code(400).header('content-type', 'text/html').send(errorPage('Missing authorization code'))
      }

      let result
      try {
        result = await msalApp.acquireTokenByCode({
          redirectUri,
          scopes: ['openid', 'email', 'profile'],
          code,
        })
      } catch (err) {
        app.log.error({ err }, 'MSAL token exchange failed')
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(errorPage('Authentication failed. Please try again.'))
      }

      const userId = result?.account?.localAccountId ?? ''
      const email = result?.account?.username ?? ''

      const userToken = issueUserToken({ userId, email, provider: 'msal' }, config.jwtSecret)

      return redirectToClient(reply, clientType, userToken, config.port)
    },
  )
}

function redirectToClient(
  reply: FastifyReply,
  clientType: 'cli' | 'vscode',
  token: string,
  port: number,
): FastifyReply {
  if (clientType === 'cli') {
    const callbackUrl = `http://localhost:${port}/auth/callback?token=${encodeURIComponent(token)}`
    return reply.redirect(callbackUrl)
  } else {
    const callbackUrl = `vscode://conduit.conduit/auth-callback?token=${encodeURIComponent(token)}`
    return reply.redirect(callbackUrl)
  }
}
