import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { IncomingRequest, RequestCompleted, RequestRecord } from '@snc/tunnel-types'
import { DiffView } from './DiffView.js'

interface InspectorProps {
  request: IncomingRequest
  completed?: RequestCompleted
  diffBase?: RequestRecord
}

function tryParseJson(s: string | null | undefined): unknown | null {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function formatJson(val: unknown, indent = 2): string {
  return JSON.stringify(val, null, indent)
}

function isJsonContentType(headers: Record<string, string>): boolean {
  const ct = headers['content-type'] ?? headers['Content-Type'] ?? ''
  return ct.includes('application/json')
}

function HeadersSection({ headers }: { headers: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false)

  useInput((input, key) => {
    if (key.rightArrow) setExpanded(true)
    if (key.leftArrow) setExpanded(false)
  })

  const entries = Object.entries(headers)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        Headers {expanded ? '(→ to collapse)' : '(→ to expand)'}
      </Text>
      {expanded ? (
        entries.map(([k, v]) => (
          <Box key={k} paddingLeft={2}>
            <Text color="cyan">{k}</Text>
            <Text>: {v}</Text>
          </Box>
        ))
      ) : (
        <Text color="gray">  {entries.length} header{entries.length !== 1 ? 's' : ''}</Text>
      )}
    </Box>
  )
}

function BodySection({ body, bodyEncoding, label }: {
  body: string | null | undefined
  bodyEncoding?: string
  label: string
}) {
  if (!body) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{label}</Text>
        <Text color="gray">  (empty)</Text>
      </Box>
    )
  }

  let displayBody = body
  if (bodyEncoding === 'base64') {
    try {
      displayBody = Buffer.from(body, 'base64').toString('utf8')
    } catch {
      displayBody = body
    }
  }

  const parsed = tryParseJson(displayBody)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{label}</Text>
      {parsed !== null ? (
        <Box paddingLeft={2}>
          <Text color="yellow">{formatJson(parsed)}</Text>
        </Box>
      ) : (
        <Box paddingLeft={2}>
          <Text>{displayBody.slice(0, 500)}{displayBody.length > 500 ? '...' : ''}</Text>
        </Box>
      )}
    </Box>
  )
}

export function Inspector({ request, completed, diffBase }: InspectorProps) {
  // Build a minimal RequestRecord for diffing
  const currentRecord: RequestRecord = {
    id: request.id,
    slug: '',
    method: request.method,
    path: request.path,
    headers: request.headers,
    body: request.body,
    bodyEncoding: request.bodyEncoding,
    bodyTruncated: request.bodyTruncated,
    status: completed?.status ?? null,
    durationMs: completed?.durationMs ?? null,
    ts: request.ts,
    responseBodyEncoding: 'utf8',
    responseBodyTruncated: false,
  }

  if (diffBase) {
    return <DiffView base={diffBase} compare={currentRecord} />
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Summary line */}
      <Box flexDirection="row" marginBottom={1}>
        <Text bold color="cyan">{request.method}</Text>
        <Text> </Text>
        <Text>{request.path}</Text>
        {completed && (
          <>
            <Text>  </Text>
            <Text color={completed.status >= 400 ? 'red' : 'green'}>
              {completed.status}
            </Text>
            <Text color="gray">  {completed.durationMs}ms</Text>
          </>
        )}
      </Box>

      <HeadersSection headers={request.headers} />
      <BodySection body={request.body} bodyEncoding={request.bodyEncoding} label="Request Body" />
    </Box>
  )
}
