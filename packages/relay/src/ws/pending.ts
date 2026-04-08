import type { ForwardResponse } from '@snc/tunnel-types'

interface PendingEntry {
  resolve: (resp: ForwardResponse) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  /** Accumulated binary body chunks from streaming response frames. */
  chunks: Buffer[]
  /** Stored ForwardResponse when body=null; resolved once END frame arrives. */
  pendingResponse: ForwardResponse | null
  /** Called when the END stream frame (0x01) is received. */
  streamResolve?: () => void
  /** The tunnel slug this request belongs to, for rejectAll support. */
  slug: string
}

/**
 * Tracks in-flight HTTP requests that have been forwarded to an owner WebSocket
 * and are awaiting a ForwardResponse (plus optional binary body frames).
 */
export class PendingRequests {
  private readonly pending = new Map<string, PendingEntry>()
  /** Inverse index: slug → Set of requestIds, for rejectAll. */
  private readonly bySlug = new Map<string, Set<string>>()

  /**
   * Registers a pending request and returns a Promise that resolves when the
   * complete response (including any streaming body) is available.
   *
   * @param requestId UUID of the forwarded request
   * @param slug      Tunnel slug the request belongs to
   * @param timeoutMs How long to wait before rejecting with a timeout error
   */
  add(requestId: string, slug: string, timeoutMs: number): Promise<ForwardResponse> {
    return new Promise<ForwardResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cleanup(requestId)
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const entry: PendingEntry = {
        resolve,
        reject,
        timer,
        chunks: [],
        pendingResponse: null,
        slug,
      }

      this.pending.set(requestId, entry)

      let slugSet = this.bySlug.get(slug)
      if (!slugSet) {
        slugSet = new Set()
        this.bySlug.set(slug, slugSet)
      }
      slugSet.add(requestId)
    })
  }

  /**
   * Called when the ForwardResponse JSON frame arrives.
   * If body is non-null the promise resolves immediately.
   * If body is null (streaming), stores the response and waits for endStream().
   */
  resolve(requestId: string, resp: ForwardResponse): void {
    const entry = this.pending.get(requestId)
    if (!entry) return

    if (resp.body !== null && resp.body !== undefined) {
      // Inline body — resolve immediately
      clearTimeout(entry.timer)
      this.cleanup(requestId)
      entry.resolve(resp)
    } else {
      // Streaming body — hold until all binary frames arrive
      entry.pendingResponse = resp
      entry.streamResolve = () => {
        // Assemble accumulated chunks into a base64 body on the response
        const assembled = Buffer.concat(entry.chunks)
        const finalResp: ForwardResponse = {
          ...resp,
          body: assembled.toString('base64'),
          bodyEncoding: 'base64',
        }
        clearTimeout(entry.timer)
        this.cleanup(requestId)
        entry.resolve(finalResp)
      }
    }
  }

  /** Called for each binary DATA frame (0x00) received for this request. */
  addChunk(requestId: string, chunk: Buffer): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    entry.chunks.push(chunk)
  }

  /**
   * Called when the END stream frame (0x01) is received.
   * Assembles all accumulated chunks and resolves the pending promise.
   */
  endStream(requestId: string): void {
    const entry = this.pending.get(requestId)
    if (!entry?.streamResolve) return
    entry.streamResolve()
  }

  /** Rejects the pending promise with the given error. */
  reject(requestId: string, err: Error): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.cleanup(requestId)
    entry.reject(err)
  }

  /**
   * Rejects all pending requests for a given slug.
   * Called when the owner WebSocket disconnects mid-flight.
   */
  rejectAll(slug: string, err: Error): void {
    const ids = this.bySlug.get(slug)
    if (!ids) return
    for (const requestId of [...ids]) {
      this.reject(requestId, err)
    }
    this.bySlug.delete(slug)
  }

  /** Returns true if there is an entry pending for this requestId. */
  has(requestId: string): boolean {
    return this.pending.has(requestId)
  }

  private cleanup(requestId: string): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    const slugSet = this.bySlug.get(entry.slug)
    if (slugSet) {
      slugSet.delete(requestId)
      if (slugSet.size === 0) this.bySlug.delete(entry.slug)
    }
  }
}
