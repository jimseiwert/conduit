import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as WebSocket from 'ws'
import type { RelayOutbound, IncomingRequest, RequestCompleted, RequestRecords } from '@conduit/types'
import type { StatusBar } from './StatusBar'

export interface RequestItem {
  id: string
  method: string
  path: string
  status: number | null
  durationMs: number | null
  ts: number
  // Full data — populated on demand via fetchRequests
  headers?: Record<string, string>
  body?: string | null
  bodyEncoding?: 'utf8' | 'base64'
  bodyTruncated?: boolean
  responseHeaders?: Record<string, string>
  responseBody?: string | null
  responseBodyEncoding?: 'utf8' | 'base64'
  responseBodyTruncated?: boolean
}

/** Maximum requests to keep in memory (ring-buffer style). */
const MAX_REQUESTS = 500

/** Reconnect delay cap in milliseconds. */
const MAX_RECONNECT_DELAY_MS = 30_000

export class WatcherClient {
  private ws: WebSocket.WebSocket | null = null
  private slug: string | null = null
  private token: string | null = null
  private relayUrl: string | null = null
  /** Whether a deliberate disconnect was requested — suppresses auto-reconnect. */
  private intentionalDisconnect = false
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watcherCount = 0
  private connectedUrl: string | null = null

  public requests: RequestItem[] = []
  public onUpdate: (() => void) | null = null

  constructor(
    private statusBar: StatusBar,
    private secrets: vscode.SecretStorage,
  ) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Attempt auto-connect on extension activation.
   * Reads .conduit slug, then tries .env → SecretStorage for token.
   * Silently aborts if slug or token cannot be resolved.
   */
  async tryAutoConnect(): Promise<void> {
    const cfg = this.readHomeConfig()
    if (!cfg) return

    this.slug = cfg.slug
    if (cfg.relayUrl) this.relayUrl = cfg.relayUrl

    const token = cfg.token ?? await this.secrets.get(`conduit.token.${cfg.slug}`)
    if (!token) return

    this.token = token
    await this.connect()
  }

  /**
   * Connect to the relay as a watcher.
   * Token resolution order: .env → SecretStorage → browser login → manual entry.
   * Opens WebSocket to {relayUrl}/conduit/{slug}/watch.
   */
  async connect(): Promise<void> {
    this.intentionalDisconnect = false

    const vsConfig = vscode.workspace.getConfiguration('conduit')
    let relayUrl: string = this.relayUrl
      ?? vsConfig.get<string>('relayUrl')
      ?? 'wss://relay.conduitrelay.com'

    // Resolve slug
    if (!this.slug) {
      const cfg = this.readHomeConfig()
      if (cfg) {
        this.slug = cfg.slug
        if (cfg.token) this.token = cfg.token
        if (cfg.relayUrl) { this.relayUrl = cfg.relayUrl; relayUrl = cfg.relayUrl }
      } else {
        const entered = await vscode.window.showInputBox({
          prompt: 'Enter conduit slug (e.g. ws-a3f9c2b1d4e6)',
          placeHolder: 'ws-a3f9c2b1d4e6',
        })
        if (!entered) return
        this.slug = entered
      }
    }

    // Resolve token: home config → SecretStorage → ask
    if (!this.token) {
      const cfg = this.readHomeConfig()
      if (cfg?.token) {
        this.token = cfg.token
      } else {
        const stored = await this.secrets.get(`conduit.token.${this.slug}`)
        if (stored) {
          this.token = stored
        } else {
          const choice = await vscode.window.showInformationMessage(
            `Conduit: No token found for "${this.slug}". How would you like to authenticate?`,
            'Login with Browser',
            'Enter Token',
          )
          if (choice === 'Login with Browser') {
            await this._openBrowserLogin(relayUrl)
            // URI handler will call handleAuthCallback → connect
            return
          } else if (choice === 'Enter Token') {
            const entered = await vscode.window.showInputBox({
              prompt: 'Paste your CONDUIT_TOKEN (from the .env file where conduit start was run)',
              password: true,
            })
            if (!entered) return
            this.token = entered
            await this.secrets.store(`conduit.token.${this.slug}`, entered)
          } else {
            return
          }
        }
      }
    }

    const watchUrl = `${relayUrl}/${this.slug}/watch`
    this.connectedUrl = watchUrl
    this.statusBar.setReconnecting()
    this._openSocket(watchUrl, this.token!)
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

  /** Called by the VS Code URI handler after browser auth completes. */
  async handleAuthCallback(token: string): Promise<void> {
    this.token = token
    if (this.slug) {
      await this.secrets.store(`conduit.token.${this.slug}`, token)
    }
    if (!this.intentionalDisconnect) {
      await this.connect()
    }
  }

  /**
   * Clear the stored token for the current slug (logout).
   * Forces the user to re-authenticate on next connect.
   */
  async clearStoredToken(): Promise<void> {
    if (this.slug) {
      await this.secrets.delete(`conduit.token.${this.slug}`)
    }
    this.token = null
  }

  sendFetch(ids: string[]): void {
    if (this.ws?.readyState === WebSocket.WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'fetchRequests', ids }))
    }
  }

  /**
   * Send a replay request for the given tree item.
   * The relay re-issues the stored IncomingRequest to the conduit owner.
   */
  replay(item: RequestItem): void {
    if (!this.ws || this.ws.readyState !== WebSocket.WebSocket.OPEN) {
      vscode.window.showWarningMessage('Conduit: Not connected — cannot replay request.')
      return
    }
    const msg = JSON.stringify({ type: 'replay', requestId: item.id })
    this.ws.send(msg)
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async _openBrowserLogin(relayUrl: string): Promise<void> {
    const httpBase = relayUrl.replace(/^wss?:\/\//, (m) => (m.startsWith('wss') ? 'https://' : 'http://'))
    const loginUrl = `${httpBase}/auth/login?clientType=vscode`
    await vscode.env.openExternal(vscode.Uri.parse(loginUrl))
    vscode.window.showInformationMessage('Conduit: Complete login in your browser — you will be connected automatically.')
  }

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
      this.reconnectDelay = 1000
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
      this.statusBar.setReconnecting()
      this._scheduleReconnect(url, token)
    })

    ws.on('error', (err: Error) => {
      console.error('[Conduit] WebSocket error:', err.message)
    })
  }

  private _handleMessage(data: WebSocket.RawData): void {
    const text = Buffer.isBuffer(data)
      ? data.toString('utf8')
      : data instanceof ArrayBuffer
      ? Buffer.from(data).toString('utf8')
      : Array.isArray(data)
      ? Buffer.concat(data as Buffer[]).toString('utf8')
      : String(data)

    let parsed: RelayOutbound
    try {
      parsed = JSON.parse(text) as RelayOutbound
    } catch {
      return
    }

    switch (parsed.type) {
      case 'request': {
        const req = parsed as IncomingRequest
        this.requests.unshift({
          id: req.id,
          method: req.method,
          path: req.path,
          status: null,
          durationMs: null,
          ts: req.ts,
        })
        if (this.requests.length > MAX_REQUESTS) {
          this.requests = this.requests.slice(0, MAX_REQUESTS)
        }
        this.onUpdate?.()
        break
      }

      case 'completed': {
        const comp = parsed as RequestCompleted
        const idx = this.requests.findIndex((r) => r.id === comp.requestId)
        if (idx !== -1) {
          this.requests[idx] = {
            ...this.requests[idx],
            status: comp.status,
            durationMs: comp.durationMs,
          }
        } else {
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
        const records = (parsed as RequestRecords).records
        for (const rec of records) {
          const fullData = {
            headers: rec.headers,
            body: rec.body,
            bodyEncoding: rec.bodyEncoding as 'utf8' | 'base64' | undefined,
            bodyTruncated: rec.bodyTruncated,
            responseHeaders: rec.responseHeaders,
            responseBody: rec.responseBody,
            responseBodyEncoding: rec.responseBodyEncoding as 'utf8' | 'base64' | undefined,
            responseBodyTruncated: rec.responseBodyTruncated,
          }
          const existing = this.requests.find((r) => r.id === rec.id)
          if (existing) {
            Object.assign(existing, fullData)
          } else {
            this.requests.push({
              id: rec.id,
              method: rec.method,
              path: rec.path,
              status: rec.status ?? null,
              durationMs: rec.durationMs ?? null,
              ts: rec.ts,
              ...fullData,
            })
          }
        }
        this.requests.sort((a, b) => b.ts - a.ts)
        if (this.requests.length > MAX_REQUESTS) {
          this.requests = this.requests.slice(0, MAX_REQUESTS)
        }
        this.onUpdate?.()
        break
      }

      case 'error': {
        vscode.window.showErrorMessage(`Conduit relay error [${parsed.code}]: ${parsed.message}`)
        break
      }

      case 'replayError': {
        vscode.window.showWarningMessage(
          `Conduit: Replay failed for request ${parsed.requestId} — ${parsed.reason}`
        )
        break
      }

      default:
        break
    }
  }

  private _scheduleReconnect(url: string, _staleToken: string): void {
    this._clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.intentionalDisconnect) {
        const fresh = this.readHomeConfig()
        const token = fresh?.token ?? _staleToken
        if (fresh?.relayUrl) this.relayUrl = fresh.relayUrl
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
   * Read the project entry from ~/.conduit/projects.json, keyed by the current
   * workspace root. Returns null if no entry exists.
   */
  private readHomeConfig(): { slug: string; token: string | null; relayUrl?: string } | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!root) return null

    const homeConfigDir = process.env['CONDUIT_HOME']
      ?? path.join(os.homedir(), '.conduit')
    const homeConfigPath = path.join(homeConfigDir, 'projects.json')

    if (!fs.existsSync(homeConfigPath)) return null

    try {
      const raw = fs.readFileSync(homeConfigPath, 'utf8')
      const parsed = JSON.parse(raw) as {
        version?: number
        projects?: Record<string, { slug: string; token?: string | null; relayUrl?: string }>
      }
      const entry = parsed.projects?.[root]
      if (!entry?.slug) return null
      return { slug: entry.slug, token: entry.token ?? null, relayUrl: entry.relayUrl }
    } catch {
      return null
    }
  }
}
