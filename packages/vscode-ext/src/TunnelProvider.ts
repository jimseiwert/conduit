import * as vscode from 'vscode'
import type { WatcherClient, RequestItem } from './WatcherClient'

export class RequestTreeItem extends vscode.TreeItem {
  constructor(public readonly request: RequestItem) {
    super(`${request.method} ${request.path}`, vscode.TreeItemCollapsibleState.None)

    // Status + duration as description
    const statusStr = request.status !== null ? String(request.status) : '...'
    const durationStr = request.durationMs !== null ? `${request.durationMs}ms` : ''
    this.description = durationStr ? `${statusStr} · ${durationStr}` : statusStr

    // Tooltip with full request details
    const lines: string[] = [
      `Method:   ${request.method}`,
      `Path:     ${request.path}`,
      `Status:   ${request.status ?? 'pending'}`,
      `Duration: ${request.durationMs !== null ? `${request.durationMs}ms` : 'pending'}`,
      `Time:     ${new Date(request.ts).toLocaleTimeString()}`,
    ]
    this.tooltip = new vscode.MarkdownString(lines.join('\n\n'))

    // Enable the replay command in the context menu
    this.contextValue = request.status !== null ? 'completedRequest' : 'pendingRequest'

    // Icon based on HTTP status code
    this.iconPath = RequestTreeItem.iconForStatus(request.status)
  }

  private static iconForStatus(status: number | null): vscode.ThemeIcon {
    if (status === null) {
      // In-flight
      return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'))
    }
    if (status >= 200 && status < 300) {
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
    }
    if (status >= 300 && status < 400) {
      return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.blue'))
    }
    if (status >= 400 && status < 500) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'))
    }
    if (status >= 500) {
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'))
    }
    return new vscode.ThemeIcon('circle-outline')
  }
}

export class TunnelProvider implements vscode.TreeDataProvider<RequestTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RequestTreeItem | undefined>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(private client: WatcherClient) {
    client.onUpdate = () => this.refresh()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: RequestTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): RequestTreeItem[] {
    // Most recent requests first
    return [...this.client.requests]
      .sort((a, b) => b.ts - a.ts)
      .map((req) => new RequestTreeItem(req))
  }
}
