import { describe, it, expect } from 'bun:test'
import React from 'react'
import { render } from 'ink-testing-library'
import type { IncomingRequest, RequestCompleted } from '@conduit/types'
import { RequestList, type RequestEntry } from '../ui/RequestList.js'
import { Header } from '../ui/Header.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    type: 'request',
    id: '550e8400-e29b-41d4-a716-446655440000',
    method: 'GET',
    path: '/api/users',
    headers: { 'content-type': 'application/json' },
    body: null,
    bodyEncoding: 'utf8',
    bodyTruncated: false,
    ts: Date.now(),
    ...overrides,
  }
}

function makeCompleted(overrides: Partial<RequestCompleted> = {}): RequestCompleted {
  return {
    type: 'completed',
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    method: 'GET',
    path: '/api/users',
    status: 200,
    durationMs: 42,
    ts: Date.now(),
    ...overrides,
  }
}

// ─── RequestList tests ───────────────────────────────────────────────────────

describe('RequestList', () => {
  it('renders method and path', () => {
    const entries: RequestEntry[] = [
      { request: makeRequest({ method: 'POST', path: '/api/create' }) },
    ]

    const { lastFrame } = render(
      React.createElement(RequestList, {
        entries,
        selectedIndex: 0,
        diffBaseIndex: null,
      })
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('POST')
    expect(frame).toContain('/api/create')
  })

  it('renders status and duration when completed', () => {
    const req = makeRequest()
    const completed = makeCompleted({ status: 404, durationMs: 123 })
    const entries: RequestEntry[] = [{ request: req, completed }]

    const { lastFrame } = render(
      React.createElement(RequestList, {
        entries,
        selectedIndex: 0,
        diffBaseIndex: null,
      })
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('404')
    expect(frame).toContain('123ms')
  })

  it('shows waiting message when no entries', () => {
    const { lastFrame } = render(
      React.createElement(RequestList, {
        entries: [],
        selectedIndex: 0,
        diffBaseIndex: null,
      })
    )

    expect(lastFrame()).toContain('waiting')
  })

  it('renders multiple requests', () => {
    const entries: RequestEntry[] = [
      { request: makeRequest({ method: 'GET', path: '/foo', id: '550e8400-e29b-41d4-a716-446655440001' }) },
      { request: makeRequest({ method: 'POST', path: '/bar', id: '550e8400-e29b-41d4-a716-446655440002' }) },
      { request: makeRequest({ method: 'DELETE', path: '/baz', id: '550e8400-e29b-41d4-a716-446655440003' }) },
    ]

    const { lastFrame } = render(
      React.createElement(RequestList, {
        entries,
        selectedIndex: 0,
        diffBaseIndex: null,
      })
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('GET')
    expect(frame).toContain('POST')
    expect(frame).toContain('DELETE')
    expect(frame).toContain('/foo')
    expect(frame).toContain('/bar')
    expect(frame).toContain('/baz')
  })

  it('shows selection indicator on selected row', () => {
    const entries: RequestEntry[] = [{ request: makeRequest() }]

    const { lastFrame } = render(
      React.createElement(RequestList, {
        entries,
        selectedIndex: 0,
        diffBaseIndex: null,
      })
    )

    expect(lastFrame()).toContain('›')
  })
})

// ─── Header tests ────────────────────────────────────────────────────────────

describe('Header', () => {
  it('renders URL and connected state', () => {
    const { lastFrame } = render(
      React.createElement(Header, {
        url: 'https://relay.conduitrelay.com/conduit/myapp/',
        connected: true,
        watcherCount: 0,
      })
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('Conduit')
    expect(frame).toContain('relay.conduitrelay.com')
    expect(frame).toContain('Connected')
  })

  it('shows reconnecting state when not connected', () => {
    const { lastFrame } = render(
      React.createElement(Header, {
        url: 'https://relay.conduitrelay.com/conduit/myapp/',
        connected: false,
        watcherCount: 0,
      })
    )

    expect(lastFrame()).toContain('Reconnecting')
  })

  it('shows watcher count', () => {
    const { lastFrame } = render(
      React.createElement(Header, {
        url: 'https://relay.conduitrelay.com/conduit/myapp/',
        connected: true,
        watcherCount: 3,
      })
    )

    expect(lastFrame()).toContain('3 watcher')
  })

  it('uses singular watcher when count is 1', () => {
    const { lastFrame } = render(
      React.createElement(Header, {
        url: 'https://relay.conduitrelay.com/conduit/myapp/',
        connected: true,
        watcherCount: 1,
      })
    )

    const frame = lastFrame() ?? ''
    // Should contain "1 watcher" not "1 watchers"
    expect(frame).toContain('1 watcher')
  })

  it('updates when watcher count changes', () => {
    const { lastFrame, rerender } = render(
      React.createElement(Header, {
        url: 'https://relay.conduitrelay.com/conduit/myapp/',
        connected: true,
        watcherCount: 0,
      })
    )

    expect(lastFrame()).toContain('0 watcher')

    rerender(
      React.createElement(Header, {
        url: 'https://relay.conduitrelay.com/conduit/myapp/',
        connected: true,
        watcherCount: 5,
      })
    )

    expect(lastFrame()).toContain('5 watcher')
  })
})

// ─── App integration / keyboard interaction ──────────────────────────────────
// Note: full App keyboard tests require a mock TunnelClient

describe('RequestList keyboard hints', () => {
  it('diff base index highlighted differently', () => {
    const req1 = makeRequest({
      id: '550e8400-e29b-41d4-a716-446655440001',
      method: 'GET',
      path: '/first',
    })
    const req2 = makeRequest({
      id: '550e8400-e29b-41d4-a716-446655440002',
      method: 'POST',
      path: '/second',
    })

    const entries: RequestEntry[] = [
      { request: req1 },
      { request: req2 },
    ]

    // With diffBaseIndex = 0, the first row is the diff base
    const { lastFrame } = render(
      React.createElement(RequestList, {
        entries,
        selectedIndex: 1,
        diffBaseIndex: 0,
      })
    )

    // Both rows should be rendered
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/first')
    expect(frame).toContain('/second')
  })
})
