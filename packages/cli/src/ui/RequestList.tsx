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

// Column widths (chars)
const W_SEL  = 2   // selector
const W_MET  = 7   // method
const W_PATH = 34  // path
const W_ST   = 4   // status
const W_DUR  = 7   // duration
// age fills remainder

function statusColor(status?: number): string {
  if (!status) return 'gray'
  if (status >= 500) return 'red'
  if (status >= 400) return 'yellow'
  if (status >= 300) return 'cyan'
  return 'green'
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

function pad(s: string, len: number): string {
  if (s.length >= len) return s.slice(0, len - 1) + '…'
  return s.padEnd(len)
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
      {/* Column header — spaces match selector width */}
      <Box paddingLeft={1}>
        <Text dimColor>
          {' '.repeat(W_SEL)}
          {pad('METHOD', W_MET + 1)}
          {pad('PATH', W_PATH + 1)}
          {pad('ST', W_ST + 1)}
          {pad('TIME', W_DUR + 1)}
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
        const selector = isDiffBase ? '◆' : isSelected ? '›' : ' '

        return (
          <Box key={entry.request.id} flexDirection="row" paddingLeft={1}>
            {/* Selector */}
            <Text color={isDiffBase ? 'yellow' : isSelected ? 'cyan' : undefined} bold>
              {pad(selector, W_SEL)}
            </Text>

            {/* Method */}
            <Text color={methodColor(method)} bold={isSelected}>
              {pad(method, W_MET + 1)}
            </Text>

            {/* Path */}
            <Text dimColor={!isSelected}>
              {pad(entry.request.path, W_PATH + 1)}
            </Text>

            {/* Status */}
            <Text color={status !== undefined ? statusColor(status) : 'gray'}>
              {pad(status !== undefined ? String(status) : '···', W_ST + 1)}
            </Text>

            {/* Duration */}
            <Text dimColor>
              {pad(formatDuration(duration), W_DUR + 1)}
            </Text>

            {/* Age */}
            <Text dimColor>
              {formatAge(entry.request.ts)}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
