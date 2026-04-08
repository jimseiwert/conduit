import React from 'react'
import { Box, Text } from 'ink'
import type { RequestRecord } from '@conduit/types'
import * as jsondiffpatch from 'jsondiffpatch'

type Delta = jsondiffpatch.Delta

interface DiffViewProps {
  base: RequestRecord
  compare: RequestRecord
}

function renderDelta(delta: Delta, path = ''): React.ReactNode[] {
  if (delta === null || delta === undefined) return []

  const nodes: React.ReactNode[] = []

  // jsondiffpatch delta format:
  // Added:    [newValue]
  // Removed:  [oldValue, 0, 0]
  // Modified: [oldValue, newValue]
  // Array:    { _t: 'a', ... }
  // Object:   { key: delta }

  if (Array.isArray(delta)) {
    if (delta.length === 1) {
      // Added
      nodes.push(
        <Text key={`${path}-added`} color="green">
          + {path}: {JSON.stringify(delta[0])}
        </Text>
      )
    } else if (delta.length === 3 && delta[1] === 0 && delta[2] === 0) {
      // Removed
      nodes.push(
        <Text key={`${path}-removed`} color="red">
          - {path}: {JSON.stringify(delta[0])}
        </Text>
      )
    } else if (delta.length === 2) {
      // Modified
      nodes.push(
        <Box key={`${path}-modified`} flexDirection="column">
          <Text color="red">  - {path}: {JSON.stringify(delta[0])}</Text>
          <Text color="green">  + {path}: {JSON.stringify(delta[1])}</Text>
        </Box>
      )
    }
  } else if (typeof delta === 'object') {
    // Object or array delta
    const isArrayDelta = (delta as Record<string, unknown>)['_t'] === 'a'

    for (const [key, val] of Object.entries(delta as Record<string, Delta>)) {
      if (key === '_t') continue
      const childPath = isArrayDelta
        ? `${path}[${key.replace(/^_/, '')}]`
        : path
        ? `${path}.${key}`
        : key
      const childNodes = renderDelta(val, childPath)
      nodes.push(...childNodes)
    }
  }

  return nodes
}

export function DiffView({ base, compare }: DiffViewProps) {
  const differ = jsondiffpatch.create({
    arrays: { detectMove: true },
  })

  const delta = differ.diff(base, compare)

  if (!delta) {
    return (
      <Box paddingX={1}>
        <Text color="gray">No differences found between the two requests.</Text>
      </Box>
    )
  }

  const nodes = renderDelta(delta)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Diff: {base.id.slice(0, 8)} → {compare.id.slice(0, 8)}</Text>
      <Box marginTop={1} flexDirection="column">
        {nodes.length === 0 ? (
          <Text color="gray">No differences</Text>
        ) : (
          nodes
        )}
      </Box>
    </Box>
  )
}
