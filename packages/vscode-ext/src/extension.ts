import * as vscode from 'vscode'
import { ConduitProvider } from './TunnelProvider'
import { WatcherClient } from './WatcherClient'
import { OwnerClient } from './OwnerClient'
import { StatusBar } from './StatusBar'
import { RequestInspectorPanel } from './RequestInspectorPanel'
import type { IConduitClient } from './TunnelProvider'
import type { RequestItem } from './WatcherClient'

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

  // Chains both tree refresh and inspector panel update onto client.onUpdate.
  let autoConnectPromptShown = false
  function hookClient(client: IConduitClient): void {
    client.onUpdate = () => {
      provider.refresh()
      RequestInspectorPanel.notifyUpdate(client)

      // One-time offer to enable auto-connect after first manual connection
      if (
        !autoConnectPromptShown &&
        !context.workspaceState.get<boolean>('autoConnectPrompted') &&
        !vscode.workspace.getConfiguration('conduit').get<boolean>('autoConnect')
      ) {
        autoConnectPromptShown = true
        void context.workspaceState.update('autoConnectPrompted', true)
        vscode.window.showInformationMessage(
          'Conduit connected! Enable auto-connect so VS Code reconnects automatically on workspace open?',
          'Enable',
          'Not now',
        ).then((choice) => {
          if (choice === 'Enable') {
            void vscode.workspace.getConfiguration('conduit').update('autoConnect', true, vscode.ConfigurationTarget.Workspace)
          }
        })
      }
    }
  }

  function makeOwnerClient(): OwnerClient {
    const client = new OwnerClient(statusBar, context.secrets, workspaceRoot)
    client.onFallbackToWatch = () => {
      ownerClient = null
      watcherClient = new WatcherClient(statusBar, context.secrets)
      provider.setClient(watcherClient)
      hookClient(watcherClient)
      if (vscode.workspace.getConfiguration('conduit').get('autoConnect')) {
        void watcherClient.tryAutoConnect()
      }
    }
    return client
  }

  // ── Proxy mode ──────────────────────────────────────────────────────────────
  if (mode === 'proxy' && workspaceRoot) {
    ownerClient = makeOwnerClient()
  }

  // ── Watch mode ──────────────────────────────────────────────────────────────
  if (mode === 'watch' || !workspaceRoot) {
    watcherClient = new WatcherClient(statusBar, context.secrets)
  }

  const initialClient = (activeClient() ?? new WatcherClient(statusBar, context.secrets)) as IConduitClient
  const provider = new ConduitProvider(initialClient)
  hookClient(initialClient)

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
      if (mode === 'proxy' && workspaceRoot) {
        // If we fell back to watcher (SLUG_IN_USE), recreate owner client so
        // clicking Connect returns to proxy mode instead of staying as watcher.
        if (!ownerClient) {
          watcherClient?.disconnect()
          watcherClient = null
          ownerClient = makeOwnerClient()
          provider.setClient(ownerClient)
          hookClient(ownerClient)
        }
        void ownerClient.connect()
      } else {
        const c = activeClient()
        if (c) void c.connect()
      }
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

    vscode.commands.registerCommand('conduit.inspectRequest', (item: RequestItem) => {
      const client = activeClient()
      if (client) RequestInspectorPanel.show(item, client, context)
    }),

    vscode.commands.registerCommand('conduit.replay', (item: RequestItem) => {
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
