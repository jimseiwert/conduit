import * as vscode from 'vscode'
import type { RequestItem } from './WatcherClient'
import type { IConduitClient } from './TunnelProvider'

export class RequestInspectorPanel {
  private static instance: RequestInspectorPanel | undefined

  private panel: vscode.WebviewPanel
  private currentId: string | null = null
  private client: IConduitClient | null = null

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      'conduit.inspector',
      'Conduit: Request Inspector',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    this.panel.onDidDispose(() => {
      RequestInspectorPanel.instance = undefined
    })
    this.panel.webview.onDidReceiveMessage((msg: { command: string }) => {
      if (msg.command === 'replay' && this.currentId && this.client) {
        const item = this.client.requests.find((r) => r.id === this.currentId)
        if (item) this.client.replay?.(item)
      }
    })
  }

  static show(item: RequestItem, client: IConduitClient, extensionContext: vscode.ExtensionContext): void {
    if (!RequestInspectorPanel.instance) {
      RequestInspectorPanel.instance = new RequestInspectorPanel(extensionContext)
    }
    RequestInspectorPanel.instance.open(item, client)
  }

  static notifyUpdate(client: IConduitClient): void {
    const inst = RequestInspectorPanel.instance
    if (!inst || !inst.currentId || inst.client !== client) return
    const item = client.requests.find((r) => r.id === inst.currentId)
    if (item) inst.render(item)
  }

  private open(item: RequestItem, client: IConduitClient): void {
    this.client = client
    this.currentId = item.id
    this.panel.reveal(vscode.ViewColumn.Beside, true)
    this.render(item)

    if (!item.headers) {
      client.sendFetch([item.id])
    }
  }

  private render(item: RequestItem): void {
    this.panel.title = `${item.method} ${item.path}`
    this.panel.webview.html = this.buildHtml(item)
  }

  private buildHtml(item: RequestItem): string {
    const statusClass = item.status === null ? 'pending'
      : item.status >= 500 ? 'error'
      : item.status >= 400 ? 'warn'
      : item.status >= 300 ? 'redirect'
      : 'success'

    const statusLabel = item.status !== null ? String(item.status) : '...'
    const durationLabel = item.durationMs !== null ? `${item.durationMs}ms` : ''
    const timeLabel = new Date(item.ts).toLocaleTimeString()

    const reqHeadersHtml = item.headers
      ? headersTable(item.headers)
      : item.headers === undefined ? '<p class="loading">Loading…</p>' : '<p class="muted">No headers</p>'

    const reqBodyHtml = formatBody(item.body ?? null, item.bodyEncoding, item.bodyTruncated)

    const resHeadersHtml = item.responseHeaders
      ? headersTable(item.responseHeaders)
      : item.headers !== undefined ? '<p class="muted">No response headers</p>' : '<p class="loading">Loading…</p>'

    const resBodyHtml = formatBody(item.responseBody ?? null, item.responseBodyEncoding, item.responseBodyTruncated)

    const canReplay = item.status !== null

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border);
    --muted: var(--vscode-descriptionForeground);
    --code-bg: var(--vscode-textCodeBlock-background);
    --success: var(--vscode-charts-green);
    --warn: var(--vscode-charts-orange);
    --error: var(--vscode-charts-red);
    --redirect: var(--vscode-charts-blue);
    --pending: var(--vscode-charts-yellow);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--fg); background: var(--bg); padding: 0; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .method { font-weight: 700; font-size: 12px; letter-spacing: .04em; }
  .path { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; flex: 1; word-break: break-all; }
  .badge { font-size: 12px; font-weight: 600; padding: 2px 7px; border-radius: 4px; }
  .badge.success { color: var(--success); border: 1px solid var(--success); }
  .badge.warn { color: var(--warn); border: 1px solid var(--warn); }
  .badge.error { color: var(--error); border: 1px solid var(--error); }
  .badge.redirect { color: var(--redirect); border: 1px solid var(--redirect); }
  .badge.pending { color: var(--pending); border: 1px solid var(--pending); }
  .meta { font-size: 11px; color: var(--muted); }
  .replay-btn { margin-left: auto; padding: 4px 12px; font-size: 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; }
  .replay-btn:disabled { opacity: .5; cursor: not-allowed; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--muted); border-bottom: 2px solid transparent; }
  .tab.active { color: var(--fg); border-bottom-color: var(--btn-bg); }
  section { display: none; padding: 12px 16px; }
  section.active { display: block; }
  h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); }
  td { padding: 3px 8px 3px 0; vertical-align: top; }
  td:first-child { color: var(--muted); white-space: nowrap; padding-right: 16px; font-weight: 600; }
  pre { background: var(--code-bg); padding: 10px; border-radius: 4px; font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; max-height: 400px; overflow-y: auto; }
  .divider { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
  .muted { color: var(--muted); font-size: 12px; }
  .loading { color: var(--muted); font-style: italic; font-size: 12px; }
  .truncated { font-size: 11px; color: var(--warn); margin-top: 4px; }
</style>
</head>
<body>
<header>
  <span class="method">${esc(item.method)}</span>
  <span class="path">${esc(item.path)}</span>
  <span class="badge ${statusClass}">${esc(statusLabel)}</span>
  ${durationLabel ? `<span class="meta">${esc(durationLabel)}</span>` : ''}
  <span class="meta">${esc(timeLabel)}</span>
  <button class="replay-btn" onclick="replay()" ${canReplay ? '' : 'disabled'}>&#9654; Replay</button>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab(this,'req')">Request</div>
  <div class="tab" onclick="switchTab(this,'res')">Response</div>
</div>

<section id="req" class="active">
  <h3>Headers</h3>
  ${reqHeadersHtml}
  <hr class="divider">
  <h3>Body</h3>
  ${reqBodyHtml}
</section>

<section id="res">
  <h3>Headers</h3>
  ${resHeadersHtml}
  <hr class="divider">
  <h3>Body</h3>
  ${resBodyHtml}
</section>

<script>
  const vscode = acquireVsCodeApi();
  function switchTab(el, id) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
    document.getElementById(id).classList.add('active');
  }
  function replay() { vscode.postMessage({ command: 'replay' }); }
</script>
</body>
</html>`
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function headersTable(headers: Record<string, string>): string {
  const rows = Object.entries(headers)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('')
  return rows ? `<table>${rows}</table>` : '<p class="muted">Empty</p>'
}

function formatBody(
  body: string | null,
  encoding: 'utf8' | 'base64' | undefined,
  truncated: boolean | undefined,
): string {
  if (body === null || body === undefined) {
    return '<p class="muted">No body</p>'
  }
  if (encoding === 'base64') {
    return '<p class="muted">(binary data — not displayed)</p>'
  }
  let displayed = body
  try {
    displayed = JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    // not JSON, display as-is
  }
  const truncNote = truncated ? '<p class="truncated">⚠ Body truncated — showing first 10 MB</p>' : ''
  return `<pre>${esc(displayed)}</pre>${truncNote}`
}
