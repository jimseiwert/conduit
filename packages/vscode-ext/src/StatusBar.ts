import * as vscode from 'vscode'

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.command = 'conduit.connect'
    this.setDisconnected()
    this.item.show()
  }

  setConnected(url: string, watcherCount: number): void {
    this.item.text = `$(plug) Conduit: ${url} (${watcherCount} watcher${watcherCount !== 1 ? 's' : ''})`
    this.item.tooltip = `Connected to ${url}\nWatchers: ${watcherCount}\nClick to reconnect`
    this.item.command = 'conduit.disconnect'
    this.item.backgroundColor = undefined
    this.item.color = new vscode.ThemeColor('statusBarItem.prominentForeground')
  }

  setReconnecting(): void {
    this.item.text = `$(sync~spin) Conduit: Reconnecting...`
    this.item.tooltip = 'Reconnecting to relay...'
    this.item.command = 'conduit.disconnect'
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    this.item.color = undefined
  }

  setDisconnected(): void {
    this.item.text = `$(debug-disconnect) Conduit: Disconnected`
    this.item.tooltip = 'Click to connect conduit'
    this.item.command = 'conduit.connect'
    this.item.backgroundColor = undefined
    this.item.color = undefined
  }

  dispose(): void {
    this.item.dispose()
  }
}
