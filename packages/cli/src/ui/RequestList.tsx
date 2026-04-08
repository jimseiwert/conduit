import React from 'react'
import { Box, Text } from 'ink'
import type { IncomingRequest, RequestCompleted } from '@conduit/types'

export interface RequestEntry {
  request: IncomingRequest
  completed?: RequestCompleted
}

interface RequestListProps {
  entries: RequestEntry[]
  selectedIndex: number
  diffBaseIndex: number | null
}

const MAX_ROWS = 20

function statusColor(status?: number): string {
  if (!status) return 'gray'
  if (status >= 500) return 'red'
  if (status >= 400) return 'yellow'
  if (status >= 300) return 'blue'
  if (status >= 200) return 'green'
  return 'white'
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'green'
    case 'POST': return 'yellow'
    case 'PUT': return 'blue'
    case 'PATCH': return 'cyan'
    case 'DELETE': return 'red'
    default: return 'white'
  }
}

function formatAge(ts: number): string {
  const ageMs = Date.now() - ts
  const ageSec = Math.floor(ageMs / 1000)
  if (ageSec < 60) return `${ageSec}s`
  const ageMin = Math.floor(ageSec / 60)
  if (ageMin < 60) return `${ageMin}m`
  return `${Math.floor(ageMin / 60)}h`
}

function truncatePath(p: string, maxLen = 40): string {
  if (p.length <= maxLen) return p
  return p.slice(0, maxLen - 1) + '…'
}

export function RequestList({ entries, selectedIndex, diffBaseIndex }: RequestListProps) {
  // Show the last MAX_ROWS entries, keeping selectedIndex in view
  const start = Math.max(0, Math.min(selectedIndex - MAX_ROWS + 1, entries.length - MAX_ROWS))
  const visible = entries.slice(start, start + MAX_ROWS)

  if (entries.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color="gray">No requests yet. Waiting...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Column headers */}
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          {'METHOD'.padEnd(8)}
          {'PATH'.padEnd(42)}
          {'STATUS'.padEnd(8)}
          {'DURATION'.padEnd(10)}
          {'AGE'.padEnd(6)}
        </Text>
      </Box>
      {visible.map((entry, visIdx) => {
        const absIdx = start + visIdx
        const isSelected = absIdx === selectedIndex
        const isDiffBase = diffBaseIndex !== null && absIdx === diffBaseIndex
        const status = entry.completed?.status
        const duration = entry.completed?.durationMs

        return (
          <Box key={entry.request.id} paddingX={1} flexDirection="row">
            <Text
              inverse={isSelected}
              backgroundColor={isDiffBase ? 'yellow' : undefined}
              color={isDiffBase ? 'black' : undefined}
            >
              <Text color={methodColor(entry.request.method)}>
                {entry.request.method.padEnd(8)}
              </Text>
              <Text>
                {truncatePath(entry.request.path).padEnd(42)}
              </Text>
              <Text color={statusColor(status)}>
                {status !== undefined ? String(status).padEnd(8) : '---     '}
              </Text>
              <Text>
                {duration !== undefined ? `${duration}ms`.padEnd(10) : '---       '}
              </Text>
              <Text color="gray">
                {formatAge(entry.request.ts).padEnd(6)}
              </Text>
              <Text color="gray"> [r]</Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
