import * as vscode from 'vscode'
import { TunnelProvider } from './TunnelProvider'
import { WatcherClient } from './WatcherClient'
import { StatusBar } from './StatusBar'

export async function activate(context: vscode.ExtensionContext) {
  const statusBar = new StatusBar()
  const watcherClient = new WatcherClient(statusBar)
  const provider = new TunnelProvider(watcherClient)

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('snc-tunnel.requests', provider),
    vscode.commands.registerCommand('snc-tunnel.connect', () => watcherClient.connect()),
    vscode.commands.registerCommand('snc-tunnel.disconnect', () => watcherClient.disconnect()),
    vscode.commands.registerCommand('snc-tunnel.login', () => watcherClient.login()),
    vscode.commands.registerCommand('snc-tunnel.replay', (item) => watcherClient.replay(item)),
    vscode.commands.registerCommand('snc-tunnel.refresh', () => provider.refresh()),
    statusBar,
  )

  // Auto-connect if configured and .tunnel config file is found
  const config = vscode.workspace.getConfiguration('snctunnel')
  if (config.get('autoConnect')) {
    await watcherClient.tryAutoConnect()
  }
}

export function deactivate() {}
