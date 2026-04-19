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
  if (status >= 300) return 'cyan'
  if (status >= 200) return 'green'
  return 'white'
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':    return 'green'
    case 'POST':   return 'yellow'
    case 'PUT':    return 'blue'
    case 'PATCH':  return 'cyan'
    case 'DELETE': return 'red'
    default:       return 'white'
  }
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '…'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

function truncatePath(p: string, maxLen = 36): string {
  if (p.length <= maxLen) return p
  return p.slice(0, maxLen - 1) + '…'
}

export function RequestList({ entries, selectedIndex, diffBaseIndex }: RequestListProps) {
  const start = Math.max(0, Math.min(selectedIndex - MAX_ROWS + 1, entries.length - MAX_ROWS))
  const visible = entries.slice(start, start + MAX_ROWS)

  if (entries.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color="gray">No requests yet — waiting...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Column headers */}
      <Box paddingLeft={3} paddingRight={1}>
        <Text dimColor>
          {'METHOD'.padEnd(8)}
          {'PATH'.padEnd(38)}
          {'ST'.padEnd(5)}
          {'TIME'.padEnd(8)}
          {'AGE'}
        </Text>
      </Box>

      {visible.map((entry, visIdx) => {
        const absIdx = start + visIdx
        const isSelected = absIdx === selectedIndex
        const isDiffBase = diffBaseIndex !== null && absIdx === diffBaseIndex
        const status = entry.completed?.status
        const duration = entry.completed?.durationMs
        const method = entry.request.method.toUpperCase()

        return (
          <Box key={entry.request.id} flexDirection="row" paddingRight={1}>
            {/* Selector */}
            <Box width={2} paddingLeft={1}>
              {isDiffBase ? (
                <Text color="yellow" bold>◆</Text>
              ) : isSelected ? (
                <Text color="cyan" bold>›</Text>
              ) : (
                <Text> </Text>
              )}
            </Box>

            {/* Method */}
            <Box width={8}>
              <Text color={methodColor(method)} bold={isSelected}>{method}</Text>
            </Box>

            {/* Path */}
            <Box width={38}>
              <Text bold={isSelected} dimColor={!isSelected}>
                {truncatePath(entry.request.path, 37)}
              </Text>
            </Box>

            {/* Status */}
            <Box width={5}>
              {status !== undefined ? (
                <Text color={statusColor(status)} bold={isSelected}>{status}</Text>
              ) : (
                <Text dimColor>···</Text>
              )}
            </Box>

            {/* Duration */}
            <Box width={8}>
              <Text dimColor={!isSelected}>{formatDuration(duration)}</Text>
            </Box>

            {/* Age */}
            <Box>
              <Text dimColor>{formatAge(entry.request.ts)}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
