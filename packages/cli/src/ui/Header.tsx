import React from 'react'
import { Box, Text } from 'ink'

interface HeaderProps {
  url: string
  connected: boolean
  watcherCount: number
}

const STATUS_WIDTH = 18  // "● Connected" or "○ Reconnecting..."
const WATCHER_WIDTH = 12 // "99 watchers"
const LABEL_WIDTH = 7    // "Conduit"
const PADDING = 10       // spaces between elements

function truncateUrl(url: string): string {
  const cols = process.stdout.columns ?? 80
  const maxUrl = cols - LABEL_WIDTH - STATUS_WIDTH - WATCHER_WIDTH - PADDING
  if (url.length <= maxUrl) return url
  return url.slice(0, maxUrl - 1) + '…'
}

export function Header({ url, connected, watcherCount }: HeaderProps) {
  return (
    <Box flexDirection="row" paddingX={1} borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false}>
      <Text bold color="cyan">Conduit</Text>
      <Text>  </Text>
      <Text color="blue">{truncateUrl(url)}</Text>
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
