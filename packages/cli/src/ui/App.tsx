import React, { useState, useCallback } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { spawn } from 'child_process'
import type { IncomingRequest, RequestCompleted, RequestRecords, RequestRecord } from '@conduit/types'
import type { ConduitClient } from '../ws/client.js'
import { Header } from './Header.js'
import { RequestList, type RequestEntry } from './RequestList.js'
import { Inspector } from './Inspector.js'

type UpdateState = 'idle' | 'updating' | 'updated' | 'error'

interface AppProps {
  slug: string
  url: string
  port: number
  client: ConduitClient
  version?: string
}

export function App({ slug, url: initialUrl, port, client, version = '0.0.0-dev' }: AppProps) {
  const { exit } = useApp()

  const [connected, setConnected] = useState(false)
  const [url, setUrl] = useState(initialUrl)
  const [watcherCount, setWatcherCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [entries, setEntries] = useState<RequestEntry[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [diffBaseIndex, setDiffBaseIndex] = useState<number | null>(null)
  const [diffBaseRecord, setDiffBaseRecord] = useState<RequestRecord | null>(null)
  const [records, setRecords] = useState<Map<string, RequestRecord>>(new Map())
  const [inspectorScroll, setInspectorScroll] = useState(0)
  const fetchedIds = React.useRef(new Set<string>())
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>('idle')

  // Background version check — fires once on mount, fails silently
  React.useEffect(() => {
    if (version === '0.0.0-dev') return
    fetch('https://registry.npmjs.org/@conduit/cli/latest')
      .then((r) => r.json())
      .then((data: unknown) => {
        const v = (data as { version?: string }).version
        if (v && v !== version) setLatestVersion(v)
      })
      .catch(() => {})
  }, [])

  // Wire up client events once on mount
  React.useEffect(() => {
    const originalEvents = {
      onConnected: client['events' as keyof typeof client],
    }

    // Patch events into the client by replacing the events object
    const clientAny = client as unknown as {
      events: {
        onConnected: (slug: string, token: string, url: string) => void
        onRequest: (req: IncomingRequest) => void
        onRequestChunk: (requestId: string, chunk: Buffer) => void
        onRequestEnd: (requestId: string) => void
        onCompleted: (completed: RequestCompleted) => void
        onWatcherCount: (count: number) => void
        onRecords: (records: RequestRecords) => void
        onError: (code: string, message: string) => void
        onDisconnect: () => void
      }
    }

    clientAny.events.onConnected = (_slug, _token, _url) => {
      setConnected(true)
      setUrl(_url)
    }

    clientAny.events.onRequest = (req: IncomingRequest) => {
      setEntries((prev) => {
        const next = [...prev, { request: req }]
        setSelectedIndex(next.length - 1)
        return next
      })
    }

    clientAny.events.onRequestChunk = (_requestId: string, _chunk: Buffer) => {
      // Streaming chunks — not displayed in TUI
    }

    clientAny.events.onRequestEnd = (_requestId: string) => {
      // Streaming end — not displayed in TUI
    }

    clientAny.events.onCompleted = (completed: RequestCompleted) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.request.id === completed.requestId ? { ...e, completed } : e
        )
      )
      // Re-fetch the full record now that response data is stored on the relay
      client.sendFetch([completed.requestId])
    }

    clientAny.events.onWatcherCount = (count: number) => {
      setWatcherCount(count)
    }

    clientAny.events.onRecords = (recs: RequestRecords) => {
      setRecords((prev) => {
        const next = new Map(prev)
        for (const rec of recs.records) {
          next.set(rec.id, rec)
        }
        return next
      })
    }

    clientAny.events.onError = (code: string, message: string) => {
      setErrorMsg(`[${code}] ${message}`)
      const fatal = ['SLUG_IN_USE', 'INVALID_TOKEN', 'AUTH_REQUIRED']
      if (fatal.includes(code)) {
        client.disconnect()
        setTimeout(() => exit(), 500)
      }
    }

    clientAny.events.onDisconnect = () => {
      setConnected(false)
    }
  }, [client])

  // Auto-fetch full record for selected entry (for response headers/body in inspector)
  React.useEffect(() => {
    const entry = entries[selectedIndex]
    if (!entry) return
    const id = entry.request.id
    if (!fetchedIds.current.has(id)) {
      fetchedIds.current.add(id)
      client.sendFetch([id])
    }
    setInspectorScroll(0)
  }, [selectedIndex, entries, client])

  useInput((input, key) => {
    if (input === 'q') {
      client.disconnect()
      exit()
      return
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.min(entries.length - 1, prev + 1))
      return
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1))
      return
    }

    if (input === 'j') {
      setInspectorScroll((prev) => prev + 1)
      return
    }

    if (input === 'k') {
      setInspectorScroll((prev) => Math.max(0, prev - 1))
      return
    }

    if (input === 'r') {
      // Replay selected request
      if (entries.length > 0 && selectedIndex < entries.length) {
        const entry = entries[selectedIndex]
        if (entry) {
          client.sendReplay(entry.request.id)
        }
      }
      return
    }

    if (input === 'd') {
      if (entries.length === 0) return
      const entry = entries[selectedIndex]
      if (!entry) return

      if (diffBaseIndex === null) {
        // Mark this as diff base
        setDiffBaseIndex(selectedIndex)
        // Fetch full record for diff
        client.sendFetch([entry.request.id])
        // Try to get from local records cache first
        const rec = records.get(entry.request.id)
        if (rec) {
          setDiffBaseRecord(rec)
        }
      } else if (diffBaseIndex === selectedIndex) {
        // Deselect diff base
        setDiffBaseIndex(null)
        setDiffBaseRecord(null)
      } else {
        // Compare: fetch both if needed
        const baseEntry = entries[diffBaseIndex]
        if (baseEntry) {
          client.sendFetch([baseEntry.request.id, entry.request.id])
        }
        // DiffView will use the records once onRecords fires
      }
      return
    }

    if (key.escape) {
      setDiffBaseIndex(null)
      setDiffBaseRecord(null)
      return
    }

    if (input === 'u' && latestVersion && updateState === 'idle') {
      setUpdateState('updating')
      const proc = spawn('npm', ['install', '-g', '@conduit/cli'], { stdio: 'ignore' })
      proc.on('close', (code) => {
        setUpdateState(code === 0 ? 'updated' : 'error')
      })
      return
    }
  })

  const selectedEntry = entries[selectedIndex]
  const diffBase = diffBaseRecord ?? (diffBaseIndex !== null && entries[diffBaseIndex]
    ? records.get(entries[diffBaseIndex]!.request.id) ?? null
    : null)
  const compareRecord = selectedEntry && diffBaseIndex !== null && diffBaseIndex !== selectedIndex
    ? records.get(selectedEntry.request.id) ?? null
    : null

  return (
    <Box flexDirection="column" height={process.stdout.rows}>
      <Header url={url} connected={connected} watcherCount={watcherCount} />

      <Box flexDirection="row" flexGrow={1}>
        {/* Left pane: request list */}
        <Box flexDirection="column" width={70} borderStyle="single" borderRight={true} borderLeft={false} borderTop={false} borderBottom={false}>
          <Box paddingX={1} paddingY={0}>
            <Text bold color="gray">Requests  ({entries.length})</Text>
          </Box>
          <RequestList
            entries={entries}
            selectedIndex={selectedIndex}
            diffBaseIndex={diffBaseIndex}
          />
        </Box>

        {/* Right pane: inspector */}
        <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
          {selectedEntry ? (
            <>
              {diffBaseIndex !== null && diffBaseIndex !== selectedIndex && compareRecord && diffBase ? (
                // Show diff between two requests
                <Inspector
                  request={selectedEntry.request}
                  completed={selectedEntry.completed}
                  record={records.get(selectedEntry.request.id)}
                  diffBase={diffBase}
                  scrollOffset={inspectorScroll}
                />
              ) : (
                <Inspector
                  request={selectedEntry.request}
                  completed={selectedEntry.completed}
                  record={records.get(selectedEntry.request.id)}
                  scrollOffset={inspectorScroll}
                />
              )}
            </>
          ) : (
            <Box paddingX={1} paddingY={1}>
              <Text color="gray">Select a request to inspect</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Error banner */}
      {errorMsg && (
        <Box paddingX={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}>
          <Text color="red" bold>Error: {errorMsg}</Text>
        </Box>
      )}

      {/* Footer */}
      <Box paddingX={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} justifyContent="space-between">
        <Box>
          <Text color="gray">↑↓ navigate  j/k scroll  r replay  d diff  Esc clear diff{latestVersion && updateState === 'idle' ? '  u update' : ''}  q quit</Text>
          {diffBaseIndex !== null && (
            <Text color="yellow">  [diff mode: base #{diffBaseIndex + 1}]</Text>
          )}
        </Box>
        <Box>
          {updateState === 'updating' && (
            <Text color="yellow">updating to v{latestVersion}...  </Text>
          )}
          {updateState === 'updated' && (
            <Text color="green">updated — restart to apply  </Text>
          )}
          {updateState === 'error' && (
            <Text color="red">update failed  </Text>
          )}
          {latestVersion && updateState === 'idle' && (
            <Text>
              <Text dimColor>v{version}</Text>
              <Text color="yellow">  →  v{latestVersion} available</Text>
            </Text>
          )}
          {!latestVersion && (
            <Text dimColor>v{version}</Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}
