import * as vscode from 'vscode'
import type { RequestItem } from './WatcherClient'

export interface IConduitClient {
  requests: RequestItem[]
  onUpdate: (() => void) | null
  sendFetch(ids: string[]): void
  replay(item: RequestItem): void
}

export class RequestTreeItem extends vscode.TreeItem {
  constructor(public readonly request: RequestItem) {
    super(`${request.method} ${request.path}`, vscode.TreeItemCollapsibleState.None)

    const statusStr = request.status !== null ? String(request.status) : '...'
    const durationStr = request.durationMs !== null ? `${request.durationMs}ms` : ''
    this.description = durationStr ? `${statusStr} · ${durationStr}` : statusStr

    const lines: string[] = [
      `Method:   ${request.method}`,
      `Path:     ${request.path}`,
      `Status:   ${request.status ?? 'pending'}`,
      `Duration: ${request.durationMs !== null ? `${request.durationMs}ms` : 'pending'}`,
      `Time:     ${new Date(request.ts).toLocaleTimeString()}`,
    ]
    this.tooltip = new vscode.MarkdownString(lines.join('\n\n'))
    this.contextValue = request.status !== null ? 'completedRequest' : 'pendingRequest'
    this.iconPath = RequestTreeItem.iconForStatus(request.status)
    this.command = {
      command: 'conduit.inspectRequest',
      title: 'Inspect Request',
      arguments: [request],
    }
  }

  private static iconForStatus(status: number | null): vscode.ThemeIcon {
    if (status === null) return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'))
    if (status >= 200 && status < 300) return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
    if (status >= 300 && status < 400) return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.blue'))
    if (status >= 400 && status < 500) return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'))
    if (status >= 500) return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'))
    return new vscode.ThemeIcon('circle-outline')
  }
}

export class ConduitProvider implements vscode.TreeDataProvider<RequestTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RequestTreeItem | undefined>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  constructor(private client: IConduitClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }

  /** Swap out the underlying client (e.g. owner → watcher fallback). */
  setClient(client: IConduitClient): void {
    this.client = client
    this.refresh()
  }

  getTreeItem(element: RequestTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): RequestTreeItem[] {
    return [...this.client.requests]
      .sort((a, b) => b.ts - a.ts)
      .map((req) => new RequestTreeItem(req))
  }
}
