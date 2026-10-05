/**
 * A small STATEFUL fake of the Google Calendar events API that models etags, `updated` stamps, If-Match and 412, the way
 * the real API does. Shared by the vitest suite and the isolated replica proof. No network.
 */
interface WireBody {
  summary: string
  location?: string | null
  start: { dateTime: string }
  end: { dateTime: string }
  extendedProperties: { private: { agenticEventId: string } }
}

export const EVENT = '22222222-2222-4222-8222-222222222222'

export interface GEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime: string }
  end: { dateTime: string }
  etag: string
  updated: string
  status: 'confirmed' | 'cancelled'
  tag: string
}

export class FakeGoogle {
  events = new Map<string, GEvent>()
  log: { method: string; id: string; ifMatch: string | null }[] = []
  private n = 0
  private created = 0
  private clock = Date.parse('2026-10-04T10:00:00.000Z')

  private tick(): { etag: string; updated: string } {
    this.n += 1
    this.clock += 60_000
    return { etag: `"etag-${String(this.n)}"`, updated: new Date(this.clock).toISOString() }
  }

  seed(id: string, over: Partial<GEvent> = {}): GEvent {
    const e: GEvent = {
      id,
      summary: 'Site walk',
      start: { dateTime: '2026-10-12T09:00:00.000Z' },
      end: { dateTime: '2026-10-12T10:00:00.000Z' },
      status: 'confirmed',
      tag: EVENT,
      ...this.tick(),
      ...over,
    }
    this.events.set(id, e)
    return { ...e }
  }

  /** Somebody edits the event in Google's own UI. */
  remoteEdit(id: string, over: { summary?: string; location?: string }): void {
    const e = this.events.get(id)
    if (e === undefined) throw new Error('no such event')
    Object.assign(e, over, this.tick())
  }

  remoteDelete(id: string): void {
    this.events.delete(id)
  }

  fetch: typeof fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const u = new URL(url)
    const id = decodeURIComponent(u.pathname.split('/events/')[1] ?? '')
    const ifMatch = headers['If-Match'] ?? null
    const json = (status: number, body: unknown): Response =>
      new Response(status === 204 ? null : JSON.stringify(body), { status })
    this.log.push({ method, id, ifMatch })
    if (method === 'GET' && id === '') {
      const want = u.searchParams.get('privateExtendedProperty') ?? ''
      const hit = [...this.events.values()].find(
        (e) => `agenticEventId=${e.tag}` === want && e.status === 'confirmed',
      )
      return json(200, { items: hit === undefined ? [] : [{ id: hit.id }] })
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as WireBody
      this.created += 1
      const made = this.seed(`g-${String(this.created)}`, {
        summary: body.summary,
        tag: body.extendedProperties.private.agenticEventId,
        start: body.start,
        end: body.end,
      })
      return json(200, made)
    }
    const e = this.events.get(id)
    if (e === undefined) return json(404, { error: { message: 'Not Found' } })
    if (method === 'GET')
      return json(200, {
        ...e,
        extendedProperties: { private: { agenticEventId: e.tag } },
      })
    if (ifMatch !== null && ifMatch !== e.etag)
      return json(412, { error: { message: 'Precondition Failed' } })
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as WireBody
      e.summary = body.summary
      if (body.location !== undefined) {
        if (body.location === null) delete e.location
        else e.location = body.location
      }
      e.start = body.start
      e.end = body.end
      Object.assign(e, this.tick())
      return json(200, e)
    }
    this.events.delete(id)
    return json(204, null)
  }) as unknown as typeof fetch
}
