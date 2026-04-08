import * as vscode from 'vscode'
import { ConduitProvider } from './TunnelProvider'
import { WatcherClient } from './WatcherClient'
import { StatusBar } from './StatusBar'

export async function activate(context: vscode.ExtensionContext) {
  const statusBar = new StatusBar()
  const watcherClient = new WatcherClient(statusBar)
  const provider = new ConduitProvider(watcherClient)

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('conduit.requests', provider),
    vscode.commands.registerCommand('conduit.connect', () => watcherClient.connect()),
    vscode.commands.registerCommand('conduit.disconnect', () => watcherClient.disconnect()),
    vscode.commands.registerCommand('conduit.login', () => watcherClient.login()),
    vscode.commands.registerCommand('conduit.replay', (item) => watcherClient.replay(item)),
    vscode.commands.registerCommand('conduit.refresh', () => provider.refresh()),
    statusBar,
  )

  // Auto-connect if configured and .conduit config file is found
  const config = vscode.workspace.getConfiguration('conduit')
  if (config.get('autoConnect')) {
    await watcherClient.tryAutoConnect()
  }
}

export function deactivate() {}
