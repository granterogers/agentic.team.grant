/**
 * A server-sent-events reader for Hermes's run stream (INTERFACE-CONTRACTS section 5.2).
 *
 * Pure: bytes in, events out. Hermes writes one JSON object per event on a `data:` line, an `id:` line (its sequence number), and
 * comment lines (`: keep-alive`) between them. The parser tolerates CRLF, a `data:` field split over several lines, a partial chunk
 * and an event with no data, and it never throws on a malformed line: a line it cannot read is dropped, because a stream the bridge
 * cannot parse must not be able to stop the bridge from reading the rest.
 */

export interface SseEvent {
  /** Hermes's sequence number for this event, or null when the stream gave none. */
  readonly id: number | null
  /** The decoded JSON object, or null when the data was not a JSON object. */
  readonly data: Record<string, unknown> | null
  readonly raw: string
}

export class SseParser {
  private buffer = ''
  private id: number | null = null
  private data: string[] = []

  /** Feed one decoded chunk; returns the events it completed. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n')
    const out: SseEvent[] = []
    let cut = this.buffer.indexOf('\n')
    while (cut !== -1) {
      const line = this.buffer.slice(0, cut)
      this.buffer = this.buffer.slice(cut + 1)
      const done = this.line(line)
      if (done !== null) out.push(done)
      cut = this.buffer.indexOf('\n')
    }
    return out
  }

  private line(line: string): SseEvent | null {
    if (line === '') return this.flush()
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') {
      const n = Number(value)
      this.id = Number.isInteger(n) && n >= 0 ? n : null
    } else if (field === 'data') {
      this.data.push(value)
    }
    return null
  }

  private flush(): SseEvent | null {
    if (this.data.length === 0) {
      return null
    }
    const raw = this.data.join('\n')
    const id = this.id
    this.data = []
    let data: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
        data = parsed as Record<string, unknown>
    } catch {
      /* not JSON: kept as raw, never thrown */
    }
    return { id, data, raw }
  }
}
