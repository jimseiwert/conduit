import React from 'react'
import { Box, Text } from 'ink'
import type { IncomingRequest, RequestCompleted, RequestRecord } from '@conduit/types'
import { DiffView } from './DiffView.js'

interface InspectorProps {
  request: IncomingRequest
  completed?: RequestCompleted
  record?: RequestRecord | null
  diffBase?: RequestRecord | null
  scrollOffset: number
}

// ── Line model ───────────────────────────────────────────────────────────────

interface Line {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
}

function sectionHeader(label: string): Line {
  return { text: `── ${label} ─`, color: 'gray', dim: true }
}

function blank(): Line {
  return { text: '' }
}

function decodeBody(body: string | null | undefined, encoding?: string): string | null {
  if (!body) return null
  if (encoding === 'base64') {
    try { return Buffer.from(body, 'base64').toString('utf8') } catch { return body }
  }
  return body
}

function prettyBody(raw: string): Line[] {
  let text = raw
  try {
    const parsed = JSON.parse(raw)
    text = JSON.stringify(parsed, null, 2)
  } catch { /* keep raw */ }

  return text.split('\n').map((line) => ({ text: `  ${line}`, color: 'yellow' }))
}

function headerLines(headers: Record<string, string>): Line[] {
  return Object.entries(headers).map(([k, v]) => ({
    text: `  ${k}: ${v}`,
    color: undefined,
  }))
}

function statusLabel(status: number): string {
  const labels: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
    422: 'Unprocessable Entity', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
  }
  return labels[status] ?? ''
}

function statusColor(status: number): string {
  if (status >= 500) return 'red'
  if (status >= 400) return 'yellow'
  if (status >= 300) return 'cyan'
  return 'green'
}

function buildLines(
  request: IncomingRequest,
  completed: RequestCompleted | undefined,
  record: RequestRecord | null | undefined,
): Line[] {
  const lines: Line[] = []

  // ── Summary ─────────────────────────────────────────────────────────────────
  const statusPart = completed
    ? `  ${completed.status} ${statusLabel(completed.status)}  ${completed.durationMs}ms`
    : ''
  lines.push({ text: `${request.method} ${request.path}${statusPart}`, bold: true })
  lines.push(blank())

  // ── Request headers ──────────────────────────────────────────────────────────
  lines.push(sectionHeader('REQUEST HEADERS'))
  const reqHeaders = Object.entries(request.headers)
  if (reqHeaders.length === 0) {
    lines.push({ text: '  (none)', dim: true })
  } else {
    lines.push(...headerLines(request.headers))
  }
  lines.push(blank())

  // ── Request body ─────────────────────────────────────────────────────────────
  lines.push(sectionHeader('REQUEST BODY'))
  const reqBody = decodeBody(request.body, request.bodyEncoding)
  if (!reqBody) {
    lines.push({ text: '  (empty)', dim: true })
  } else {
    lines.push(...prettyBody(reqBody))
    if (request.bodyTruncated) {
      lines.push({ text: '  … (truncated)', dim: true })
    }
  }

  // ── Response (only if we have full record or at least completed status) ──────
  if (completed || record) {
    lines.push(blank())
    lines.push(sectionHeader('RESPONSE HEADERS'))

    const resHeaders = record?.responseHeaders
    if (resHeaders && Object.keys(resHeaders).length > 0) {
      lines.push(...headerLines(resHeaders))
    } else if (record) {
      lines.push({ text: '  (none)', dim: true })
    } else {
      lines.push({ text: '  (not yet fetched)', dim: true })
    }

    lines.push(blank())
    lines.push(sectionHeader('RESPONSE BODY'))

    const resBody = decodeBody(record?.responseBody, record?.responseBodyEncoding)
    if (!resBody && record) {
      lines.push({ text: '  (empty)', dim: true })
    } else if (!resBody) {
      lines.push({ text: '  (loading...)', dim: true })
    } else {
      lines.push(...prettyBody(resBody))
      if (record?.responseBodyTruncated) {
        lines.push({ text: '  … (truncated)', dim: true })
      }
    }
  }

  return lines
}

// ── Component ────────────────────────────────────────────────────────────────

export function Inspector({ request, completed, record, diffBase, scrollOffset }: InspectorProps) {
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

  const availableHeight = Math.max(4, (process.stdout.rows ?? 24) - 7)
  const allLines = buildLines(request, completed, record)
  const maxScroll = Math.max(0, allLines.length - availableHeight)
  const clampedOffset = Math.min(scrollOffset, maxScroll)
  const visible = allLines.slice(clampedOffset, clampedOffset + availableHeight)
  const linesBelow = allLines.length - clampedOffset - visible.length

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((line, i) => (
        <Text
          key={i}
          color={line.color}
          bold={line.bold}
          dimColor={line.dim}
        >
          {line.text || ' '}
        </Text>
      ))}

      {/* Scroll indicator */}
      {(clampedOffset > 0 || linesBelow > 0) && (
        <Text dimColor>
          {clampedOffset > 0 ? `↑${clampedOffset} ` : ''}
          {linesBelow > 0 ? `↓${linesBelow} lines` : ''}
          {' — j/k to scroll'}
        </Text>
      )}
    </Box>
  )
}
