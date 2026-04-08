import React from 'react'
import { render } from 'ink'
import jwt from 'jsonwebtoken'
import { loadConfig, writeTunnelConfig, writeToken, ConfigMismatchError } from '../config.js'
import { TunnelClient } from '../ws/client.js'
import { App } from '../ui/App.js'

const DEFAULT_RELAY = 'wss://debug.snc.digital'

export async function cmdStart(args: {
  port?: number
  slug?: string
  http?: boolean
  config?: string
  relay?: string
}) {
  const cwd = process.cwd()
  const relayUrl = args.relay ?? process.env['TUNNEL_RELAY_URL'] ?? DEFAULT_RELAY

  let loadedConfig: ReturnType<typeof loadConfig> | null = null

  try {
    loadedConfig = loadConfig({ configFile: args.config, cwd })
  } catch (err) {
    if (err instanceof ConfigMismatchError) {
      console.error(`Config error: ${err.message}`)
      process.exit(1)
    }

    // Config file not found — if slug provided, we can register fresh
    if (args.slug) {
      const port = args.port ?? 3000
      const slug = args.slug
      const httpEnabled = args.http ?? false

      // We'll create config after successful registration
      await startWithRegistration({ slug, port, httpEnabled, relayUrl, cwd, configFile: args.config })
      return
    }

    console.error('No .tunnel config found. Run `snc start --slug <your-slug>` to register.')
    process.exit(1)
  }

  const config = loadedConfig!
  const slug = args.slug ?? config.tunnel.slug
  const port = args.port ?? config.tunnel.port
  const httpEnabled = args.http ?? config.tunnel.httpEnabled

  // Check token expiry
  if (config.token) {
    try {
      const decoded = jwt.decode(config.token) as Record<string, unknown> | null
      if (decoded && typeof decoded['exp'] === 'number') {
        const nowSec = Date.now() / 1000
        if (decoded['exp'] < nowSec) {
          console.error('Token expired. Run `snc token refresh`')
          process.exit(1)
        }
      }
    } catch {
      // Non-fatal — let relay reject if invalid
    }
  }

  let currentUrl = `${relayUrl.replace(/^wss?:\/\//, 'https://')}/${slug}`

  const events = {
    onConnected(_slug: string, token: string, url: string) {
      currentUrl = url
    },
    onRequest() {},
    onRequestChunk() {},
    onRequestEnd() {},
    onCompleted() {},
    onWatcherCount() {},
    onRecords() {},
    onError() {},
    onDisconnect() {},
  }

  const client = new TunnelClient(
    relayUrl,
    slug,
    config.token,
    {
      registrationToken: process.env['TUNNEL_REGISTRATION_TOKEN'],
      httpEnabled,
      port,
      cwd,
    },
    events
  )

  client.connect()

  const { waitUntilExit } = render(
    React.createElement(App, {
      slug,
      url: currentUrl,
      port,
      client,
    })
  )

  await waitUntilExit()
}

async function startWithRegistration(opts: {
  slug: string
  port: number
  httpEnabled: boolean
  relayUrl: string
  cwd: string
  configFile?: string
}) {
  const { slug, port, httpEnabled, relayUrl, cwd, configFile } = opts
  const configPath = configFile ?? `${cwd}/.tunnel`

  let registeredUrl = `${relayUrl.replace(/^wss?:\/\//, 'https://')}/${slug}`

  const events = {
    onConnected(_slug: string, token: string, url: string) {
      registeredUrl = url
      // Persist config and token on first registration
      writeTunnelConfig(configPath, { slug, port, httpEnabled })
      writeToken(cwd, token)
    },
    onRequest() {},
    onRequestChunk() {},
    onRequestEnd() {},
    onCompleted() {},
    onWatcherCount() {},
    onRecords() {},
    onError(code: string, message: string) {
      console.error(`Relay error [${code}]: ${message}`)
    },
    onDisconnect() {},
  }

  const client = new TunnelClient(
    relayUrl,
    slug,
    null, // no token yet — first registration
    {
      registrationToken: process.env['TUNNEL_REGISTRATION_TOKEN'],
      httpEnabled,
      port,
      cwd,
    },
    events
  )

  client.connect()

  const { waitUntilExit } = render(
    React.createElement(App, {
      slug,
      url: registeredUrl,
      port,
      client,
    })
  )

  await waitUntilExit()
}
