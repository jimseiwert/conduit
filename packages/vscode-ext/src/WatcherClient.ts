import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as WebSocket from 'ws'
import type { RelayOutbound, IncomingRequest, RequestCompleted, RequestRecords } from '@snc/tunnel-types'
import type { StatusBar } from './StatusBar'

export interface RequestItem {
  id: string
  method: string
  path: string
  status: number | null
  durationMs: number | null
  ts: number
}

/** Maximum requests to keep in memory (ring-buffer style). */
const MAX_REQUESTS = 500

/** Reconnect delay cap in milliseconds. */
const MAX_RECONNECT_DELAY_MS = 30_000

export class WatcherClient {
  private ws: WebSocket.WebSocket | null = null
  private slug: string | null = null
  private token: string | null = null
  /** Whether a deliberate disconnect was requested — suppresses auto-reconnect. */
  private intentionalDisconnect = false
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watcherCount = 0
  private connectedUrl: string | null = null

  public requests: RequestItem[] = []
  public onUpdate: (() => void) | null = null

  constructor(private statusBar: StatusBar) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Attempt auto-connect on extension activation.
   * Reads .tunnel slug and TUNNEL_TOKEN; silently aborts if either is missing.
   */
  async tryAutoConnect(): Promise<void> {
    const cfg = this.readTunnelConfig()
    if (!cfg) {
      // No .tunnel file or token found — stay disconnected silently
      return
    }
    this.slug = cfg.slug
    this.token = cfg.token
    await this.connect()
  }

  /**
   * Connect to the relay as a watcher.
   * Reads config + prompts user for any missing values.
   * Opens WebSocket to {relayUrl}/tunnel/{slug}/watch.
   */
  async connect(): Promise<void> {
    this.intentionalDisconnect = false

    // Resolve relay URL from settings
    const vsConfig = vscode.workspace.getConfiguration('snctunnel')
    let relayUrl: string = vsConfig.get('relayUrl') ?? 'wss://debug.snc.digital'

    // Resolve slug
    if (!this.slug) {
      const cfg = this.readTunnelConfig()
      if (cfg) {
        this.slug = cfg.slug
        this.token = cfg.token
      } else {
        const entered = await vscode.window.showInputBox({
          prompt: 'Enter tunnel slug (from .tunnel file)',
          placeHolder: 'my-project',
        })
        if (!entered) {
          return
        }
        this.slug = entered
      }
    }

    // Resolve token
    if (!this.token) {
      const entered = await vscode.window.showInputBox({
        prompt: 'Enter tunnel token (TUNNEL_TOKEN)',
        password: true,
      })
      if (!entered) {
        return
      }
      this.token = entered
    }

    const watchUrl = `${relayUrl}/tunnel/${this.slug}/watch`
    this.connectedUrl = watchUrl
    this.statusBar.setReconnecting()
    this._openSocket(watchUrl, this.token)
  }

  /** Close the WebSocket and suppress reconnection. */
  disconnect(): void {
    this.intentionalDisconnect = true
    this._clearReconnectTimer()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.statusBar.setDisconnected()
    this.onUpdate?.()
  }

  /**
   * Open the relay login page in the system browser.
   * Relay auth flow issues a JWT that the user stores as TUNNEL_TOKEN.
   */
  async login(): Promise<void> {
    const vsConfig = vscode.workspace.getConfiguration('snctunnel')
    const relayUrl: string = vsConfig.get('relayUrl') ?? 'wss://debug.snc.digital'

    // Convert wss:// → https:// for the browser URL
    const httpBase = relayUrl.replace(/^wss?:\/\//, (m) => (m.startsWith('wss') ? 'https://' : 'http://'))
    const loginUrl = `${httpBase}/auth/login?clientType=vscode`
    await vscode.env.openExternal(vscode.Uri.parse(loginUrl))
  }

  /**
   * Send a replay request for the given tree item.
   * The relay re-issues the stored IncomingRequest to the tunnel owner.
   */
  replay(item: RequestItem): void {
    if (!this.ws || this.ws.readyState !== WebSocket.WebSocket.OPEN) {
      vscode.window.showWarningMessage('SNC Tunnel: Not connected — cannot replay request.')
      return
    }
    const msg = JSON.stringify({ type: 'replay', requestId: item.id })
    this.ws.send(msg)
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Open (or reopen) the WebSocket connection to the relay watcher endpoint.
   * Automatically reconnects with exponential backoff on unexpected close.
   */
  private _openSocket(url: string, token: string): void {
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }

    const ws = new WebSocket.WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    this.ws = ws

    ws.on('open', () => {
      this.reconnectDelay = 1000 // reset backoff on successful connect
      this.statusBar.setConnected(this.slug ?? url, this.watcherCount)
      this.onUpdate?.()
    })

    ws.on('message', (data: WebSocket.RawData) => {
      this._handleMessage(data)
    })

    ws.on('close', (_code: number, _reason: Buffer) => {
      this.ws = null
      if (this.intentionalDisconnect) {
        return
      }
      // Unexpected close — schedule reconnect with exponential backoff
      this.statusBar.setReconnecting()
      this._scheduleReconnect(url, token)
    })

    ws.on('error', (err: Error) => {
      // Log silently; close event will fire after error and trigger reconnect
      console.error('[SNC Tunnel] WebSocket error:', err.message)
    })
  }

  private _handleMessage(data: WebSocket.RawData): void {
    // Ignore binary frames (stream body chunks — watchers don't process them)
    if (data instanceof Buffer || data instanceof ArrayBuffer) {
      return
    }

    let parsed: RelayOutbound
    try {
      parsed = JSON.parse(data.toString()) as RelayOutbound
    } catch {
      return
    }

    switch (parsed.type) {
      case 'request': {
        // Incoming request — add to list as in-flight (status null)
        const req = parsed as IncomingRequest
        this.requests.unshift({
          id: req.id,
          method: req.method,
          path: req.path,
          status: null,
          durationMs: null,
          ts: req.ts,
        })
        // Trim to ring-buffer size
        if (this.requests.length > MAX_REQUESTS) {
          this.requests = this.requests.slice(0, MAX_REQUESTS)
        }
        this.onUpdate?.()
        break
      }

      case 'completed': {
        // Request finished — update matching entry with status + duration
        const comp = parsed as RequestCompleted
        const idx = this.requests.findIndex((r) => r.id === comp.requestId)
        if (idx !== -1) {
          this.requests[idx] = {
            ...this.requests[idx],
            status: comp.status,
            durationMs: comp.durationMs,
          }
        } else {
          // Completed event arrived before request event (rare) — insert directly
          this.requests.unshift({
            id: comp.requestId,
            method: comp.method,
            path: comp.path,
            status: comp.status,
            durationMs: comp.durationMs,
            ts: comp.ts,
          })
        }
        this.onUpdate?.()
        break
      }

      case 'watcherCount': {
        this.watcherCount = parsed.count
        if (this.connectedUrl) {
          this.statusBar.setConnected(this.slug ?? this.connectedUrl, this.watcherCount)
        }
        break
      }

      case 'requestRecords': {
        // Backfill from relay ring buffer — merge without duplicating
        const records = (parsed as RequestRecords).records
        for (const rec of records) {
          if (!this.requests.find((r) => r.id === rec.id)) {
            this.requests.push({
              id: rec.id,
              method: rec.method,
              path: rec.path,
              status: rec.status ?? null,
              durationMs: rec.durationMs ?? null,
              ts: rec.ts,
            })
          }
        }
        // Re-sort descending by timestamp
        this.requests.sort((a, b) => b.ts - a.ts)
        if (this.requests.length > MAX_REQUESTS) {
          this.requests = this.requests.slice(0, MAX_REQUESTS)
        }
        this.onUpdate?.()
        break
      }

      case 'error': {
        vscode.window.showErrorMessage(`SNC Tunnel relay error [${parsed.code}]: ${parsed.message}`)
        break
      }

      case 'replayError': {
        vscode.window.showWarningMessage(
          `SNC Tunnel: Replay failed for request ${parsed.requestId} — ${parsed.reason}`
        )
        break
      }

      // 'registered' is an owner-only message; watchers ignore it
      default:
        break
    }
  }

  private _scheduleReconnect(url: string, token: string): void {
    this._clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.intentionalDisconnect) {
        this._openSocket(url, token)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      }
    }, this.reconnectDelay)
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * Read the .tunnel slug from the workspace config file and the TUNNEL_TOKEN
   * from the process environment or workspace .env file.
   *
   * .tunnel file format (tried in order):
   *   1. JSON: { "slug": "my-project" }
   *   2. Plain text first line: "my-project"
   *
   * Token sources (tried in order):
   *   1. process.env.TUNNEL_TOKEN
   *   2. KEY=VALUE pairs in workspace .env file
   */
  private readTunnelConfig(): { slug: string; token: string } | null {
    const root = vscode.workspace.rootPath
    if (!root) {
      return null
    }

    const vsConfig = vscode.workspace.getConfiguration('snctunnel')
    const configFile: string = vsConfig.get('configFile') ?? '.tunnel'
    const tunnelFilePath = path.join(root, configFile)

    if (!fs.existsSync(tunnelFilePath)) {
      return null
    }

    // Parse slug from .tunnel file
    let slug: string | null = null
    try {
      const content = fs.readFileSync(tunnelFilePath, 'utf8').trim()
      try {
        const json = JSON.parse(content) as { slug?: string }
        if (json.slug && typeof json.slug === 'string') {
          slug = json.slug
        }
      } catch {
        // Not JSON — treat first non-empty line as the slug
        const firstLine = content.split(/\r?\n/).find((l) => l.trim().length > 0)
        if (firstLine) {
          slug = firstLine.trim()
        }
      }
    } catch {
      return null
    }

    if (!slug) {
      return null
    }

    // Resolve token: process.env first, then workspace .env file
    let token: string | null = process.env['TUNNEL_TOKEN'] ?? null

    if (!token) {
      const envPath = path.join(root, '.env')
      if (fs.existsSync(envPath)) {
        try {
          const envContent = fs.readFileSync(envPath, 'utf8')
          for (const line of envContent.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (trimmed.startsWith('#') || !trimmed.includes('=')) {
              continue
            }
            const eqIdx = trimmed.indexOf('=')
            const key = trimmed.slice(0, eqIdx).trim()
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
            if (key === 'TUNNEL_TOKEN') {
              token = val
              break
            }
          }
        } catch {
          // .env read failure is non-fatal
        }
      }
    }

    if (!token) {
      return null
    }

    return { slug, token }
  }
}
