import React from 'react'
import { render } from 'ink'
import jwt from 'jsonwebtoken'
import { loadConfig, writeConduitConfig, writeToken, ConfigMismatchError } from '../config.js'
import { ConduitClient } from '../ws/client.js'
import { App } from '../ui/App.js'

const DEFAULT_RELAY = 'wss://relay.conduitrelay.com'

export async function cmdStart(args: {
  port?: number
  slug?: string
  http?: boolean
  config?: string
  relay?: string
}) {
  const cwd = process.cwd()
  const relayUrl = args.relay ?? process.env['CONDUIT_RELAY_URL'] ?? DEFAULT_RELAY

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

    console.error('No .conduit config found. Run `conduit start --slug <your-slug>` to register.')
    process.exit(1)
  }

  const config = loadedConfig!
  const slug = args.slug ?? config.conduit.slug
  const port = args.port ?? config.conduit.port
  const httpEnabled = args.http ?? config.conduit.httpEnabled

  // Check token expiry
  if (config.token) {
    try {
      const decoded = jwt.decode(config.token) as Record<string, unknown> | null
      if (decoded && typeof decoded['exp'] === 'number') {
        const nowSec = Date.now() / 1000
        if (decoded['exp'] < nowSec) {
          console.error('Token expired. Run `conduit token refresh`')
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
    onError(code: string, message: string) {
      console.error(`Relay error [${code}]: ${message}`)
    },
    onDisconnect() {},
  }

  const client = new ConduitClient(
    relayUrl,
    slug,
    config.token,
    {
      registrationToken: process.env['CONDUIT_REGISTRATION_TOKEN'],
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
  const configPath = configFile ?? `${cwd}/.conduit`

  let registeredUrl = `${relayUrl.replace(/^wss?:\/\//, 'https://')}/${slug}`

  const events = {
    onConnected(_slug: string, token: string, url: string) {
      registeredUrl = url
      // Persist config and token on first registration
      writeConduitConfig(configPath, { slug, port, httpEnabled })
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

  const client = new ConduitClient(
    relayUrl,
    slug,
    null, // no token yet — first registration
    {
      registrationToken: process.env['CONDUIT_REGISTRATION_TOKEN'],
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
