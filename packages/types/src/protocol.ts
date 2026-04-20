import { z } from 'zod'

// ─── Shared primitives ───────────────────────────────────────────────────────

export const BodyEncodingSchema = z.enum(['utf8', 'base64'])
export type BodyEncoding = z.infer<typeof BodyEncodingSchema>

export const TunnelErrorCodeSchema = z.enum([
  'SLUG_IN_USE',
  'INVALID_TOKEN',
  'SLUG_NOT_FOUND',
  'AUTH_REQUIRED',
  'UNAUTHORIZED',
  'PARSE_ERROR',
])
export type TunnelErrorCode = z.infer<typeof TunnelErrorCodeSchema>

// ─── Client → Relay ──────────────────────────────────────────────────────────

/** First message sent by a CLI or watcher to claim/reclaim a slug. */
export const RegisterTunnelSchema = z.object({
  type: z.literal('register'),
  slug: z.string().min(1).max(128),
  /** Omit on first registration; required on reconnect. */
  token: z.string().optional(),
  /** Relay-level gate token (RELAY_REGISTRATION_TOKEN env var). */
  registrationToken: z.string().optional(),
  /** User JWT from dashboard login (conduit login). Used for account-based auth on hosted relay. */
  userToken: z.string().optional(),
  httpEnabled: z.boolean().optional().default(false),
})
export type RegisterTunnel = z.infer<typeof RegisterTunnelSchema>

/** Graceful disconnect — relay enters 30s grace period for the slug. */
export const DeregisterTunnelSchema = z.object({
  type: z.literal('deregister'),
  slug: z.string(),
  token: z.string(),
})
export type DeregisterTunnel = z.infer<typeof DeregisterTunnelSchema>

/**
 * Trigger relay-mediated replay of a stored request.
 * Relay re-issues the stored IncomingRequest to the owner client.
 * Owner forwards to localhost as if it were a new external request.
 */
export const ReplayRequestSchema = z.object({
  type: z.literal('replay'),
  requestId: z.string().uuid(),
})
export type ReplayRequest = z.infer<typeof ReplayRequestSchema>

/** Fetch ring buffer records for diff or history display. */
export const FetchRequestsSchema = z.object({
  type: z.literal('fetchRequests'),
  /** Specific IDs to fetch (e.g. 2 for diff). Empty array = fetch recent N. */
  ids: z.array(z.string().uuid()),
  /** Default 50 when ids is empty and limit is omitted. */
  limit: z.number().int().min(1).max(1000).optional(),
})
export type FetchRequests = z.infer<typeof FetchRequestsSchema>

// ─── Owner → Relay ───────────────────────────────────────────────────────────

/**
 * Response from localhost, sent by the owner CLI back to the relay.
 * For streaming responses: headers only — body follows as binary frames.
 */
export const ForwardResponseSchema = z.object({
  type: z.literal('response'),
  requestId: z.string().uuid(),
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  /** Null when body is delivered via binary streaming frames. */
  body: z.string().nullable().optional(),
  bodyEncoding: BodyEncodingSchema.optional().default('utf8'),
  bodyTruncated: z.boolean().default(false),
  durationMs: z.number().int().min(0),
})
export type ForwardResponse = z.infer<typeof ForwardResponseSchema>

// ─── Relay → Client ──────────────────────────────────────────────────────────

/** Successful registration — slug is live, token is the slug credential. */
export const TunnelRegisteredSchema = z.object({
  type: z.literal('registered'),
  slug: z.string(),
  /** JWT: { slug, iat, exp } — HS256, 90-day expiry. */
  token: z.string(),
  url: z.string().url(),
})
export type TunnelRegistered = z.infer<typeof TunnelRegisteredSchema>

/** Protocol-level error from relay. */
export const TunnelErrorSchema = z.object({
  type: z.literal('error'),
  code: TunnelErrorCodeSchema,
  message: z.string(),
})
export type TunnelError = z.infer<typeof TunnelErrorSchema>

/** Relay could not fulfill a replay request. */
export const ReplayErrorSchema = z.object({
  type: z.literal('replayError'),
  requestId: z.string().uuid(),
  reason: z.enum(['NO_OWNER_CONNECTED', 'REQUEST_NOT_FOUND']),
})
export type ReplayError = z.infer<typeof ReplayErrorSchema>

/**
 * Incoming external HTTP request — sent to the owner client for forwarding.
 * For streaming request bodies: body is null; body chunks follow as binary frames.
 */
export const IncomingRequestSchema = z.object({
  type: z.literal('request'),
  id: z.string().uuid(),
  method: z.string(),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  /** Null when body is delivered via binary streaming frames. */
  body: z.string().nullable().optional(),
  bodyEncoding: BodyEncodingSchema.default('utf8'),
  bodyTruncated: z.boolean().default(false),
  ts: z.number().int(),
})
export type IncomingRequest = z.infer<typeof IncomingRequestSchema>

/** Broadcast to all clients (owner + watchers) when a forwarded request completes. */
export const RequestCompletedSchema = z.object({
  type: z.literal('completed'),
  requestId: z.string().uuid(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  durationMs: z.number().int(),
  ts: z.number().int(),
})
export type RequestCompleted = z.infer<typeof RequestCompletedSchema>

/** Broadcast to all clients when a watcher joins or leaves. */
export const WatcherCountSchema = z.object({
  type: z.literal('watcherCount'),
  count: z.number().int().min(0),
})
export type WatcherCount = z.infer<typeof WatcherCountSchema>

/** Ring buffer records returned in response to FetchRequests. */
export const RequestRecordSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  method: z.string(),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string().nullable().optional(),
  bodyEncoding: BodyEncodingSchema.default('utf8'),
  bodyTruncated: z.boolean().default(false),
  status: z.number().int().nullable().optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  responseBody: z.string().nullable().optional(),
  responseBodyEncoding: BodyEncodingSchema.default('utf8'),
  responseBodyTruncated: z.boolean().default(false),
  durationMs: z.number().int().nullable().optional(),
  ts: z.number().int(),
})
export type RequestRecord = z.infer<typeof RequestRecordSchema>

export const RequestRecordsSchema = z.object({
  type: z.literal('requestRecords'),
  records: z.array(RequestRecordSchema),
})
export type RequestRecords = z.infer<typeof RequestRecordsSchema>

// ─── Union discriminators ────────────────────────────────────────────────────

/** All messages the relay can receive (from owner or watcher). */
export const RelayInboundSchema = z.discriminatedUnion('type', [
  RegisterTunnelSchema,
  DeregisterTunnelSchema,
  ReplayRequestSchema,
  FetchRequestsSchema,
  ForwardResponseSchema,
])
export type RelayInbound = z.infer<typeof RelayInboundSchema>

/** All messages the relay sends to clients. */
export const RelayOutboundSchema = z.discriminatedUnion('type', [
  TunnelRegisteredSchema,
  TunnelErrorSchema,
  ReplayErrorSchema,
  IncomingRequestSchema,
  RequestCompletedSchema,
  WatcherCountSchema,
  RequestRecordsSchema,
])
export type RelayOutbound = z.infer<typeof RelayOutboundSchema>

// ─── Binary streaming frame protocol ────────────────────────────────────────
//
// Used for both request body (relay → CLI) and response body (CLI → relay).
// Layout:
//   [0..35]  Request ID (36 bytes, UUID v4 ASCII)
//   [36]     Frame type: 0x00=data, 0x01=end, 0x02=error
//   [37..]   Chunk data (omitted for end frame; UTF-8 error message for error frame)
//
// JSON messages carry headers only when streaming is active (body: null).
// Non-streaming bodies (< MAX_BODY_BYTES) are inlined in the JSON frame.

export const STREAM_FRAME_TYPE = {
  DATA: 0x00,
  END: 0x01,
  ERROR: 0x02,
} as const

export type StreamFrameType = (typeof STREAM_FRAME_TYPE)[keyof typeof STREAM_FRAME_TYPE]

export interface StreamFrame {
  requestId: string
  frameType: StreamFrameType
  chunk?: Buffer
}

export function encodeStreamFrame(frame: StreamFrame): Buffer {
  const idBytes = Buffer.from(frame.requestId, 'ascii') // 36 bytes
  const chunkBytes = frame.chunk ?? Buffer.alloc(0)
  const buf = Buffer.allocUnsafe(37 + chunkBytes.length)
  idBytes.copy(buf, 0)
  buf[36] = frame.frameType
  chunkBytes.copy(buf, 37)
  return buf
}

export function decodeStreamFrame(buf: Buffer): StreamFrame {
  if (buf.length < 37) throw new Error(`Stream frame too short: ${buf.length} bytes`)
  const requestId = buf.subarray(0, 36).toString('ascii')
  const frameType = buf[36] as StreamFrameType
  const chunk = buf.length > 37 ? buf.subarray(37) : undefined
  return { requestId, frameType, chunk }
}
