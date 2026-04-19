import * as vscode from 'vscode'
import { ConduitProvider } from './TunnelProvider'
import { WatcherClient } from './WatcherClient'
import { OwnerClient } from './OwnerClient'
import { StatusBar } from './StatusBar'

export async function activate(context: vscode.ExtensionContext) {
  const statusBar = new StatusBar()
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
  const vsConfig = vscode.workspace.getConfiguration('conduit')
  const mode: 'proxy' | 'watch' = vsConfig.get('mode') ?? 'proxy'

  // Active client — starts as owner (proxy) or watcher based on settings
  let ownerClient: OwnerClient | null = null
  let watcherClient: WatcherClient | null = null

  function activeClient(): OwnerClient | WatcherClient | null {
    return ownerClient ?? watcherClient
  }

  // ── Proxy mode ──────────────────────────────────────────────────────────────
  if (mode === 'proxy' && workspaceRoot) {
    ownerClient = new OwnerClient(statusBar, context.secrets, workspaceRoot)

    // If CLI is already running as owner, fall back to watcher transparently
    ownerClient.onFallbackToWatch = () => {
      ownerClient = null
      watcherClient = new WatcherClient(statusBar, context.secrets)
      provider.setClient(watcherClient)
      void watcherClient.tryAutoConnect()
    }
  }

  // ── Watch mode ──────────────────────────────────────────────────────────────
  if (mode === 'watch' || !workspaceRoot) {
    watcherClient = new WatcherClient(statusBar, context.secrets)
  }

  const provider = new ConduitProvider(
    (activeClient() ?? new WatcherClient(statusBar, context.secrets)) as Parameters<typeof ConduitProvider.prototype.setClient>[0]
  )

  // Handle vscode://jimseiwert.conduit-relay/auth-callback?token=...
  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri) {
      if (uri.path === '/auth-callback') {
        const params = new URLSearchParams(uri.query)
        const token = params.get('token')
        if (token && watcherClient) {
          void watcherClient.handleAuthCallback(token)
        }
      }
    },
  })

  context.subscriptions.push(
    uriHandler,
    vscode.window.registerTreeDataProvider('conduit.requests', provider),

    vscode.commands.registerCommand('conduit.connect', () => {
      const c = activeClient()
      if (c) void c.connect()
    }),

    vscode.commands.registerCommand('conduit.disconnect', () => {
      activeClient()?.disconnect()
    }),

    vscode.commands.registerCommand('conduit.logout', async () => {
      if (watcherClient) await watcherClient.clearStoredToken()
      vscode.window.showInformationMessage('Conduit: Stored token cleared.')
    }),

    vscode.commands.registerCommand('conduit.copyWebhookUrl', () => {
      const url = ownerClient?.webhookUrl
      if (url) {
        void vscode.env.clipboard.writeText(url)
        vscode.window.showInformationMessage(`Copied: ${url}`)
      } else {
        vscode.window.showWarningMessage('Conduit: Not connected as owner — no webhook URL available.')
      }
    }),

    vscode.commands.registerCommand('conduit.replay', (item) => {
      activeClient()?.replay(item)
    }),

    vscode.commands.registerCommand('conduit.refresh', () => provider.refresh()),

    statusBar,
  )

  // Auto-connect on activation
  if (vsConfig.get('autoConnect')) {
    if (ownerClient) {
      await ownerClient.connect()
    } else if (watcherClient) {
      await watcherClient.tryAutoConnect()
    }
  }
}

export function deactivate() {}
