import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as WebSocket from 'ws'
import type {
  RelayOutbound,
  IncomingRequest,
  RequestCompleted,
  RequestRecords,
  ForwardResponse,
} from '@conduit/types'
import type { StatusBar } from './StatusBar'
import type { RequestItem } from './WatcherClient'
import { readUserCredentials } from './credentials'

const MAX_REQUESTS = 500
const MAX_RECONNECT_DELAY_MS = 30_000
const MAX_BODY_BYTES = 10 * 1024 * 1024

// ── Home config ───────────────────────────────────────────────────────────────

interface HomeProjectEntry {
  slug: string
  token: string | null
  port: number
  httpEnabled: boolean
  relayUrl?: string
}

function homeConfigDir(): string {
  return process.env['CONDUIT_HOME'] ?? path.join(os.homedir(), '.conduit')
}

function readHomeConfig(workspaceRoot: string): HomeProjectEntry | null {
  const configPath = path.join(homeConfigDir(), 'projects.json')
  if (!fs.existsSync(configPath)) return null
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as {
      projects?: Record<string, HomeProjectEntry>
    }
    return parsed.projects?.[workspaceRoot] ?? null
  } catch {
    return null
  }
}

function writeHomeConfig(workspaceRoot: string, entry: HomeProjectEntry): void {
  const dir = homeConfigDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const configPath = path.join(dir, 'projects.json')

  let existing: { version: number; projects: Record<string, HomeProjectEntry> } = {
    version: 1,
    projects: {},
  }
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8')) as typeof existing
    } catch {
      // Start fresh if corrupt
    }
  }

  existing.projects[workspaceRoot] = entry
  const tmp = configPath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(existing, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, configPath)
}

function generateSlug(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto')
  return `ws-${randomBytes(6).toString('hex')}`
}

// ── Request forwarder ─────────────────────────────────────────────────────────

async function forwardToLocalhost(
  req: IncomingRequest,
  port: number,
): Promise<ForwardResponse> {
  const start = Date.now()

  let body: string | Buffer | null = null
  if (req.body != null) {
    body = req.bodyEncoding === 'base64' ? Buffer.from(req.body, 'base64') : req.body
  }

  const skipHeaders = new Set([
    'host', 'connection', 'keep-alive', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
  ])
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!skipHeaders.has(k.toLowerCase())) headers[k] = v
  }

  const url = `http://localhost:${port}${req.path}`
  const bodylessMethods = new Set(['GET', 'HEAD', 'OPTIONS', 'DELETE'])

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)

    let response: Response
    try {
      response = await fetch(url, {
        method: req.method,
        headers,
        body: bodylessMethods.has(req.method.toUpperCase()) ? undefined : body as string | Buffer | null,
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      const durationMs = Date.now() - start
      const code = (err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException })?.cause?.code
      return errorResponse(req.id, code === 'ECONNREFUSED' ? 502 : 504, durationMs)
    }
    clearTimeout(timeout)

    const resHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => { resHeaders[k] = v })

    // Collect body (non-streaming for extension simplicity)
    let resBody: string | null = null
    let bodyTruncated = false
    let bodyEncoding: 'utf8' | 'base64' = 'utf8'

    const rawBytes = await response.arrayBuffer()
    if (rawBytes.byteLength > 0) {
      const buf = Buffer.from(rawBytes)
      const contentType = response.headers.get('content-type') ?? ''
      const isBinary = !contentType.startsWith('text/') &&
        !contentType.includes('json') &&
        !contentType.includes('xml') &&
        !contentType.includes('javascript') &&
        !contentType.includes('form-urlencoded')

      const truncated = buf.length > MAX_BODY_BYTES
      const slice = truncated ? buf.subarray(0, MAX_BODY_BYTES) : buf
      bodyTruncated = truncated
      bodyEncoding = isBinary ? 'base64' : 'utf8'
      resBody = slice.toString(bodyEncoding)
    }

    return {
      type: 'response',
      requestId: req.id,
      status: response.status,
      headers: resHeaders,
      body: resBody,
      bodyEncoding,
      bodyTruncated,
      durationMs: Date.now() - start,
    }
  } catch {
    return errorResponse(req.id, 502, Date.now() - start)
  }
}

function errorResponse(requestId: string, status: number, durationMs: number): ForwardResponse {
  return {
    type: 'response',
    requestId,
    status,
    headers: {},
    body: null,
    bodyEncoding: 'utf8',
    bodyTruncated: false,
    durationMs,
  }
}

// ── OwnerClient ───────────────────────────────────────────────────────────────

/**
 * Connects to the relay as an owner (proxy mode).
 * Registers the workspace slug, forwards incoming requests to localhost:{port},
 * and maintains the request log for the VS Code panel.
 *
 * If the relay rejects with SLUG_IN_USE (CLI already running), emits
 * onFallbackToWatch so the extension can switch to watcher mode instead.
 */
export class OwnerClient {
  private ws: WebSocket.WebSocket | null = null
  private slug: string | null = null
  private token: string | null = null
  private userToken: string | null = null
  private relayUrl: string | null = null
  private intentionalDisconnect = false
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watcherCount = 0
  private port = 3000

  public requests: RequestItem[] = []
  public webhookUrl: string | null = null
  public onUpdate: (() => void) | null = null
  /** Called when the relay rejects as SLUG_IN_USE — CLI is already the owner. */
  public onFallbackToWatch: (() => void) | null = null

  constructor(
    private statusBar: StatusBar,
    private secrets: vscode.SecretStorage,
    private workspaceRoot: string,
  ) {}

  async connect(): Promise<void> {
    this.intentionalDisconnect = false

    const vsConfig = vscode.workspace.getConfiguration('conduit')
    const relayUrl: string = this.relayUrl
      ?? vsConfig.get<string>('relayUrl')
      ?? 'wss://relay.conduitrelay.com'
    this.port = vsConfig.get<number>('localPort') ?? 3000

    // Load or create slug from home config
    let homeEntry = readHomeConfig(this.workspaceRoot)
    if (!homeEntry) {
      const slug = generateSlug()
      homeEntry = { slug, token: null, port: this.port, httpEnabled: false }
      writeHomeConfig(this.workspaceRoot, homeEntry)
    }

    this.slug = homeEntry.slug
    if (homeEntry.relayUrl) this.relayUrl = homeEntry.relayUrl

    // Token: home config → SecretStorage
    this.token = homeEntry.token
      ?? await this.secrets.get(`conduit.token.${homeEntry.slug}`)
      ?? null

    // User credentials from `conduit login` (stored in ~/.conduit/credentials.json)
    this.userToken = readUserCredentials()?.token ?? null

    this._openSocket(relayUrl)
  }

  disconnect(): void {
    this.intentionalDisconnect = true
    this._clearTimer()
    this.ws?.close()
    this.ws = null
    this.statusBar.setDisconnected()
    this.onUpdate?.()
  }

  replay(item: RequestItem): void {
    if (!this.ws || this.ws.readyState !== WebSocket.WebSocket.OPEN) {
      vscode.window.showWarningMessage('Conduit: Not connected — cannot replay.')
      return
    }
    this.ws.send(JSON.stringify({ type: 'replay', requestId: item.id }))
  }

  sendFetch(ids: string[]): void {
    if (this.ws?.readyState === WebSocket.WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'fetchRequests', ids }))
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _openSocket(relayUrl: string): void {
    this.ws?.removeAllListeners()
    this.ws?.close()
    this.ws = null

    const wsUrl = `${relayUrl.replace(/\/+$/, '')}/${this.slug}`
    const ws = new WebSocket.WebSocket(wsUrl)
    this.ws = ws

    ws.on('open', () => {
      this.reconnectDelay = 1000
      const registerMsg: Record<string, unknown> = {
        type: 'register',
        slug: this.slug,
        httpEnabled: false,
      }
      if (this.token) registerMsg['token'] = this.token
      if (this.userToken) registerMsg['userToken'] = this.userToken
      const registrationToken = vscode.workspace.getConfiguration('conduit').get<string>('registrationToken') || process.env['CONDUIT_REGISTRATION_TOKEN']
      if (registrationToken) registerMsg['registrationToken'] = registrationToken
      ws.send(JSON.stringify(registerMsg))
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const text = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf8')
        : Array.isArray(data)
        ? Buffer.concat(data as Buffer[]).toString('utf8')
        : String(data)
      let msg: RelayOutbound
      try { msg = JSON.parse(text) as RelayOutbound }
      catch { return }
      this._handleMessage(msg, relayUrl)
    })

    ws.on('close', () => {
      this.ws = null
      if (!this.intentionalDisconnect) {
        this.statusBar.setReconnecting()
        this._scheduleReconnect(relayUrl)
      }
    })

    ws.on('error', (err: Error) => {
      console.error('[Conduit] Owner WebSocket error:', err.message)
    })
  }

  private _handleMessage(msg: RelayOutbound, relayUrl: string): void {
    switch (msg.type) {
      case 'registered': {
        const token = msg.token
        this.token = token
        this.webhookUrl = msg.url

        // Persist token
        const entry = readHomeConfig(this.workspaceRoot)
        if (entry) writeHomeConfig(this.workspaceRoot, { ...entry, token })
        void this.secrets.store(`conduit.token.${this.slug!}`, token)

        this.statusBar.setConnected(this.slug ?? '', this.watcherCount)
        vscode.window.showInformationMessage(
          `Conduit: Proxying to localhost:${this.port}  |  Webhook: ${msg.url}`,
          'Copy URL',
        ).then((choice) => {
          if (choice === 'Copy URL') vscode.env.clipboard.writeText(msg.url)
        })
        this.onUpdate?.()
        break
      }

      case 'error': {
        if (msg.code === 'SLUG_IN_USE') {
          // Another owner is active (CLI or prior session) — fall back to watcher
          vscode.window.showInformationMessage(
            'Conduit: Another owner is active for this slug — watching instead. Click Connect to retry as owner.'
          )
          this.intentionalDisconnect = true
          this.ws?.close()
          this.ws = null
          this.onFallbackToWatch?.()
        } else if (msg.code === 'AUTH_REQUIRED') {
          // Not logged in — stop reconnecting and prompt user to run conduit login
          this.intentionalDisconnect = true
          vscode.window.showErrorMessage(
            'Conduit: Not logged in. Run `conduit login` in your terminal, then click Connect.',
            'Connect',
          ).then((choice) => {
            if (choice === 'Connect') {
              this.intentionalDisconnect = false
              void this.connect()
            }
          })
        } else if (msg.code === 'INVALID_TOKEN') {
          // Relay storage was wiped — clear saved token so next reconnect re-registers fresh
          this.token = null
          const entry = readHomeConfig(this.workspaceRoot)
          if (entry) writeHomeConfig(this.workspaceRoot, { ...entry, token: null })
          void this.secrets.delete(`conduit.token.${this.slug!}`)
        } else {
          vscode.window.showErrorMessage(`Conduit relay error [${msg.code}]: ${msg.message}`)
        }
        break
      }

      case 'request': {
        const req = msg as IncomingRequest
        // Add to request log
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

        // Forward to localhost and send response back to relay
        const port = this.port
        forwardToLocalhost(req, port).then((resp) => {
          // Update local status immediately — the relay may time out before sending
          // a `completed` message back if the local server was slow to respond.
          const idx = this.requests.findIndex((r) => r.id === req.id)
          if (idx !== -1 && this.requests[idx]!.status === null) {
            this.requests[idx] = { ...this.requests[idx]!, status: resp.status, durationMs: resp.durationMs }
            this.onUpdate?.()
          }
          if (this.ws?.readyState === WebSocket.WebSocket.OPEN) {
            this.ws.send(JSON.stringify(resp))
          }
        }).catch(() => {
          const idx = this.requests.findIndex((r) => r.id === req.id)
          if (idx !== -1 && this.requests[idx]!.status === null) {
            this.requests[idx] = { ...this.requests[idx]!, status: 502, durationMs: Date.now() - req.ts }
            this.onUpdate?.()
          }
          if (this.ws?.readyState === WebSocket.WebSocket.OPEN) {
            this.ws.send(JSON.stringify(errorResponse(req.id, 502, 0)))
          }
        })
        break
      }

      case 'completed': {
        const comp = msg as RequestCompleted
        const idx = this.requests.findIndex((r) => r.id === comp.requestId)
        if (idx !== -1) {
          this.requests[idx] = { ...this.requests[idx]!, status: comp.status, durationMs: comp.durationMs }
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
        this.watcherCount = msg.count
        if (this.slug) this.statusBar.setConnected(this.slug, this.watcherCount)
        break
      }

      case 'requestRecords': {
        const records = (msg as RequestRecords).records
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
        if (this.requests.length > MAX_REQUESTS) this.requests = this.requests.slice(0, MAX_REQUESTS)
        this.onUpdate?.()
        break
      }

      default:
        break
    }
  }

  private _scheduleReconnect(relayUrl: string): void {
    this._clearTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.intentionalDisconnect) {
        this._openSocket(relayUrl)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      }
    }, this.reconnectDelay)
  }

  private _clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
