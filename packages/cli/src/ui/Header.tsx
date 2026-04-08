import React from 'react'
import { Box, Text } from 'ink'

interface HeaderProps {
  url: string
  connected: boolean
  watcherCount: number
}

export function Header({ url, connected, watcherCount }: HeaderProps) {
  return (
    <Box flexDirection="row" paddingX={1} borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false}>
      <Text bold color="cyan">Conduit</Text>
      <Text>  </Text>
      <Text color="blue">{url}</Text>
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
