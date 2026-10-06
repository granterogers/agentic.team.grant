/**
 * An in-memory Vikunja for the suite: HTTP-shaped, no network.
 *
 * It mirrors only what `src/tasks/vikunja.ts` calls, in the shapes a real v2.6 answers (see `scripts/verify/vikunja.ts`,
 * which proves those shapes against the released binary): PUT /projects/:id/tasks creates, POST /tasks/:id updates,
 * DELETE /tasks/:id removes and answers 404 for a task that is gone, GET /projects/:id/tasks pages with `per_page` and
 * `page` and reports `x-pagination-total-pages`. Dates are Go `time.Time`: an unset one is the year-1 zero value. The
 * description is stored exactly as sent and handed back exactly as stored, which is what the real server does for an API
 * client (its HTML editor is only the browser's way of writing it).
 *
 * Faults are injected per call, so a suite can say "the third request answers 503" and read what the office did.
 */
export interface FakeTask {
  id: number
  title: string
  description: string
  done: boolean
  due_date: string
  priority: number
  project_id: number
  updated: string
  created: string
}

export interface Fault {
  /** Match `METHOD /path` (a substring). */
  readonly on: string
  readonly status?: number
  /** Never answers until the caller's signal aborts. */
  readonly hang?: boolean
  /** Throws as `fetch` does for a refused connection. */
  readonly network?: boolean
  /** How many matching calls it applies to (default: all). */
  readonly times?: number
}

export class FakeVikunja {
  readonly tasks = new Map<number, FakeTask>()
  readonly calls: string[] = []
  faults: Fault[] = []
  /** What the server caps `per_page` at (`service.maxitemsperpage`). */
  maxPerPage = 50
  private next = 1
  private clock = 0
  constructor(readonly projectId = 1) {}

  private stamp(): string {
    this.clock += 1
    return new Date(Date.UTC(2026, 9, 1, 12, 0, this.clock)).toISOString()
  }

  /** What a person editing in the Vikunja UI does. */
  edit(id: number, patch: Partial<FakeTask>): void {
    const t = this.tasks.get(id)
    if (t === undefined) throw new Error(`no task ${String(id)}`)
    this.tasks.set(id, { ...t, ...patch, updated: this.stamp() })
  }
  /** A task a person made in Vikunja directly. */
  seed(title: string, extra: Partial<FakeTask> = {}): FakeTask {
    const t: FakeTask = {
      id: this.next++,
      title,
      description: '',
      done: false,
      due_date: '0001-01-01T00:00:00Z',
      priority: 0,
      project_id: this.projectId,
      updated: this.stamp(),
      created: this.stamp(),
      ...extra,
    }
    this.tasks.set(t.id, t)
    return t
  }
  byTitle(title: string): FakeTask[] {
    return [...this.tasks.values()].filter((t) => t.title === title)
  }
  count(match: string): number {
    return this.calls.filter((c) => c.includes(match)).length
  }

  readonly fetch: typeof globalThis.fetch = async (url, init) => {
    const u = new URL(String(url))
    const path = u.pathname.replace(/^\/api\/v1/, '')
    const method = init?.method ?? 'GET'
    const key = `${method} ${path}${u.search}`
    this.calls.push(key)
    for (const f of this.faults) {
      if (!key.includes(f.on)) continue
      if (f.times !== undefined) {
        if (f.times <= 0) continue
        ;(f as { times: number }).times -= 1
      }
      if (f.network === true) throw new TypeError('fetch failed')
      if (f.hang === true) {
        await new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
          )
        })
      }
      if (f.status !== undefined) {
        return new Response(JSON.stringify({ code: 0, message: 'injected' }), { status: f.status })
      }
    }
    const json = (b: unknown, headers: Record<string, string> = {}, status = 200) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      })
    const body =
      init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Partial<FakeTask>)

    if (method === 'GET' && path === '/info') return json({ version: 'v2.6.0' })
    const list = /^\/projects\/(\d+)\/tasks$/.exec(path)
    if (list !== null) {
      if (Number(list[1]) !== this.projectId)
        return json({ code: 3001, message: 'no project' }, {}, 404)
      if (method === 'GET') {
        const per = Math.min(Number(u.searchParams.get('per_page') ?? 50), this.maxPerPage)
        const page = Number(u.searchParams.get('page') ?? 1)
        const all = [...this.tasks.values()].filter((t) => t.project_id === this.projectId)
        return json(all.slice((page - 1) * per, page * per), {
          'x-pagination-total-pages': String(Math.max(1, Math.ceil(all.length / per))),
          'x-pagination-result-count': String(all.length),
        })
      }
      if (method === 'PUT') {
        const made = this.seed(String(body.title ?? ''), {
          description: body.description ?? '',
          done: body.done ?? false,
          due_date: body.due_date ?? '0001-01-01T00:00:00Z',
          priority: body.priority ?? 0,
        })
        return json(made, {}, 201)
      }
    }
    const one = /^\/tasks\/([^/]+)$/.exec(path)
    if (one !== null) {
      const id = Number(one[1])
      if (!Number.isInteger(id)) return json({ code: 2000, message: 'invalid task id' }, {}, 400)
      const t = this.tasks.get(id)
      if (t === undefined) return json({ code: 4002, message: 'task does not exist' }, {}, 404)
      if (method === 'DELETE') {
        this.tasks.delete(id)
        return json({ message: 'Successfully deleted' })
      }
      if (method === 'POST') {
        this.edit(id, {
          title: body.title ?? t.title,
          description: body.description ?? '',
          done: body.done ?? false,
          due_date: body.due_date ?? '0001-01-01T00:00:00Z',
          priority: body.priority ?? 0,
        })
        return json(this.tasks.get(id))
      }
    }
    return json({ code: 0, message: 'not found' }, {}, 404)
  }
}
