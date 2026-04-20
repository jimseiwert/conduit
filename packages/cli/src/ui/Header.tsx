import React from 'react'
import { Box, Text, useStdout } from 'ink'

interface HeaderProps {
  url: string
  connected: boolean
  watcherCount: number
  userDisplay?: string
}

const STATUS_WIDTH = 18  // "● Connected" or "○ Reconnecting..."
const WATCHER_WIDTH = 12 // "99 watchers"
const LABEL_WIDTH = 7    // "Conduit"
const BASE_OVERHEAD = 45 // paddingX(2) + label(7) + spacers(6) + status(18) + watchers(12)

export function Header({ url, connected, watcherCount, userDisplay }: HeaderProps) {
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80
  const userWidth = userDisplay ? userDisplay.length + 2 : 0 // +2 for spacer
  const maxUrl = Math.max(cols - BASE_OVERHEAD - userWidth, 8)
  const displayUrl = url.length <= maxUrl ? url : url.slice(0, maxUrl - 1) + '…'

  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" paddingX={1} borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false}>
      <Box flexDirection="row">
        <Text bold color="cyan">Conduit</Text>
        <Text>  </Text>
        <Text color="blue">{displayUrl}</Text>
        <Text>  </Text>
        {connected ? (
          <Text color="green">● Connected</Text>
        ) : (
          <Text color="yellow">○ Reconnecting...</Text>
        )}
        <Text>  </Text>
        <Text color="gray">{watcherCount} watcher{watcherCount !== 1 ? 's' : ''}</Text>
      </Box>
      {userDisplay && (
        <Text dimColor>{userDisplay}</Text>
      )}
    </Box>
  )
}
