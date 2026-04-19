import * as vscode from 'vscode'
import { ConduitProvider } from './TunnelProvider'
import { WatcherClient } from './WatcherClient'
import { StatusBar } from './StatusBar'

export async function activate(context: vscode.ExtensionContext) {
  const statusBar = new StatusBar()
  const watcherClient = new WatcherClient(statusBar, context.secrets)
  const provider = new ConduitProvider(watcherClient)

  // Handle vscode://jimseiwert.conduit-relay/auth-callback?token=... after browser login
  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri) {
      if (uri.path === '/auth-callback') {
        const params = new URLSearchParams(uri.query)
        const token = params.get('token')
        if (token) {
          void watcherClient.handleAuthCallback(token)
        }
      }
    },
  })

  context.subscriptions.push(
    uriHandler,
    vscode.window.registerTreeDataProvider('conduit.requests', provider),
    vscode.commands.registerCommand('conduit.connect', () => watcherClient.connect()),
    vscode.commands.registerCommand('conduit.disconnect', () => watcherClient.disconnect()),
    vscode.commands.registerCommand('conduit.logout', () => watcherClient.clearStoredToken()),
    vscode.commands.registerCommand('conduit.replay', (item) => watcherClient.replay(item)),
    vscode.commands.registerCommand('conduit.refresh', () => provider.refresh()),
    statusBar,
  )

  const config = vscode.workspace.getConfiguration('conduit')
  if (config.get('autoConnect')) {
    await watcherClient.tryAutoConnect()
  }
}

export function deactivate() {}
