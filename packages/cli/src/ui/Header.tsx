import React from 'react'
import { Box, Text, useStdout } from 'ink'

interface HeaderProps {
  url: string
  connected: boolean
  watcherCount: number
}

const STATUS_WIDTH = 18  // "● Connected" or "○ Reconnecting..."
const WATCHER_WIDTH = 12 // "99 watchers"
const LABEL_WIDTH = 7    // "Conduit"
const OVERHEAD = 45      // paddingX(2) + label(7) + spacers(6) + status(18) + watchers(12)

export function Header({ url, connected, watcherCount }: HeaderProps) {
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80
  const maxUrl = Math.max(cols - OVERHEAD, 8)
  const displayUrl = url.length <= maxUrl ? url : url.slice(0, maxUrl - 1) + '…'

  return (
    <Box flexDirection="row" paddingX={1} borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false}>
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
  )
}
