import { describe, expect, it } from 'vitest'
import {
  type CacheRow,
  capText,
  driveFailure,
  driveProvider,
  type ExtractText,
  type Failure,
  LIMITS,
  type PreviewPlan,
  type PreviewProvider,
  previewDocument,
  sniff,
  sourceChanged,
  streamDocument,
} from '../../src/documents/preview.ts'

/*
  A realistic fake Drive: the three calls the provider makes (metadata, export, media) answered the way Drive answers them,
  and a hard rule that any other host is a failure of the test, so "nothing is written to storage" is not a claim but the
  fact that the only network the code can reach is Drive's.
*/
interface FakeFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  md5Checksum?: string
  size?: string
  trashed?: boolean
  body?: Uint8Array | string
  exported?: string
}

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function drive(
  files: FakeFile[],
  opts: { fail?: Record<string, { status: number; body?: string } | 'throw'> } = {},
) {
  const calls: { kind: 'meta' | 'export' | 'media'; id: string; url: string }[] = []
  const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    const u = new URL(url)
    if (u.host !== 'www.googleapis.com')
      throw new Error(`the test reached ${u.host}, which is not Drive`)
    const m = /\/drive\/v3\/files\/([^/?]+)(\/export)?/.exec(u.pathname)
    if (m === null) throw new Error(`unexpected path ${u.pathname}`)
    const id = decodeURIComponent(m[1] ?? '')
    const kind =
      m[2] !== undefined ? 'export' : u.searchParams.get('alt') === 'media' ? 'media' : 'meta'
    calls.push({ kind, id, url })
    const planned = opts.fail?.[`${kind}:${id}`] ?? opts.fail?.[id]
    if (planned === 'throw') throw new TypeError('fetch failed')
    if (planned !== undefined) return new Response(planned.body ?? '', { status: planned.status })
    const f = files.find((x) => x.id === id)
    if (f === undefined)
      return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), {
        status: 404,
      })
    if (kind === 'meta') {
      const { body: _b, exported: _e, ...meta } = f
      return new Response(JSON.stringify(meta), { status: 200 })
    }
    if (kind === 'export') return new Response(f.exported ?? '', { status: 200 })
    return new Response(f.body ?? '', { status: 200 })
  }) as typeof fetch
  return { calls, fetchImpl, provider: driveProvider('test-token', fetchImpl) }
}

const noExtract: ExtractText = async () => ({ text: null, why: 'nothing to read' })
const pdfExtract: ExtractText = async (_b, mime) =>
  mime === 'application/pdf' ? { text: 'Quarterly plan. Revenue up.' } : { text: null }

function recorder() {
  const writes: {
    kind: string
    text: string | null
    truncated: boolean
    modified: string | null
  }[] = []
  return {
    writes,
    record: async (a: {
      meta: { modifiedTime: string | null }
      kind: 'text' | 'pdf' | 'image'
      text: string | null
      truncated: boolean
    }) => {
      writes.push({
        kind: a.kind,
        text: a.text,
        truncated: a.truncated,
        modified: a.meta.modifiedTime,
      })
      return true
    },
  }
}

const NOW = Date.parse('2026-10-05T10:00:00.000Z')
const T1 = '2026-10-01T09:00:00.000Z'
const T2 = '2026-10-04T09:00:00.000Z'

const plan = (
  over: Partial<PreviewPlan> = {},
  ref = 'f1',
  cache: CacheRow | null = null,
  text: string | null = null,
): PreviewPlan => ({
  ok: true,
  mode: 'external',
  connected: true,
  imported: false,
  document: {
    id: 'doc-1',
    title: 'Pricing',
    connector: 'drive',
    origin: 'source',
    state: 'approved',
    external_ref: ref,
    mime_type: null,
    has_file: false,
    project_slug: 'alpha',
  },
  cache,
  text,
  ...over,
})
const cacheRow = (over: Partial<CacheRow> = {}): CacheRow => ({
  kind: 'text',
  source_mime: 'application/vnd.google-apps.document',
  source_modified_time: T1,
  source_version: null,
  fetched_at: '2026-10-01T09:05:00.000Z',
  last_checked_at: '2026-10-01T09:05:00.000Z',
  derived_chars: 11,
  truncated: false,
  ...over,
})
const asProvider = (p: PreviewProvider) => async () => p
const never = async (): Promise<Failure> => {
  throw new Error('the provider was asked for, and should not have been')
}

describe('the preview contract: ready', () => {
  it('a Google Doc is exported to text on demand, indexed, and nothing else is fetched or kept', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Pricing',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: T1,
        exported: 'Plans start at 40 pounds.',
      },
    ])
    const r = recorder()
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: r.record,
      now: NOW,
    })
    expect(out.state).toBe('ready')
    expect(out.kind).toBe('text')
    expect(out.mode).toBe('on_demand')
    expect(out.payload).toMatchObject({
      type: 'text',
      text: 'Plans start at 40 pounds.',
      format: 'plain',
      truncated: false,
    })
    expect(out.cache).toMatchObject({ refetched: true, was_stale: false })
    // Derived text recorded, once, with the source's own modified time; no bytes anywhere.
    expect(r.writes).toEqual([
      { kind: 'text', text: 'Plans start at 40 pounds.', truncated: false, modified: T1 },
    ])
    expect(d.calls.map((c) => c.kind)).toEqual(['meta', 'export'])
    expect(new URL(d.calls[1]?.url ?? '').searchParams.get('mimeType')).toBe('text/plain')
    expect(out.alternatives).toEqual(['open_source', 'import'])
  })

  it('a Google Sheet is exported as CSV and says it is the first sheet only', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Budget',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        modifiedTime: T1,
        exported: 'a,b\n1,2\n',
      },
    ])
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out.payload).toMatchObject({
      type: 'text',
      format: 'csv',
      note: 'First sheet only. Open the source for the others.',
    })
  })

  it('Slides are read as text, not exported as a PDF to be kept', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Deck',
        mimeType: 'application/vnd.google-apps.presentation',
        modifiedTime: T1,
        exported: 'Slide one\nSlide two',
      },
    ])
    await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(new URL(d.calls[1]?.url ?? '').searchParams.get('mimeType')).toBe('text/plain')
  })

  it('a markdown file is downloaded and shown as text', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'notes.md',
        mimeType: 'text/markdown',
        modifiedTime: T1,
        size: '12',
        body: '# Notes\nhello',
      },
    ])
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out.payload).toMatchObject({ type: 'text', text: '# Notes\nhello' })
    expect(d.calls.map((c) => c.kind)).toEqual(['meta', 'media'])
  })

  it('a Word file is downloaded once, its text taken out in passing, and only the text is recorded', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'brief.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        modifiedTime: T1,
        size: '2000',
        body: new Uint8Array([80, 75, 3, 4, 9]),
      },
    ])
    const r = recorder()
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      record: r.record,
      now: NOW,
      extractText: async (b, _m, n) =>
        b.byteLength > 0 && n === 'brief.docx' ? { text: 'Brief text' } : { text: null },
    })
    expect(out.payload).toMatchObject({ text: 'Brief text' })
    expect(d.calls.filter((c) => c.kind === 'media')).toHaveLength(1)
    expect(r.writes[0]?.text).toBe('Brief text')
  })

  it('a PDF is not fetched by the preview itself: it answers with a stream payload', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Report.pdf',
        mimeType: 'application/pdf',
        modifiedTime: T1,
        md5Checksum: 'aa',
        size: String(PDF.byteLength),
        body: PDF,
      },
    ])
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: pdfExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({
      state: 'ready',
      kind: 'pdf',
      payload: { type: 'stream', mime: 'application/pdf' },
    })
    expect(d.calls.map((c) => c.kind)).toEqual(['meta'])
  })

  it('an image answers with a stream payload; an SVG is not served', async () => {
    const d = drive([
      {
        id: 'i1',
        name: 'logo.png',
        mimeType: 'image/png',
        modifiedTime: T1,
        size: '11',
        body: PNG,
      },
      {
        id: 'i2',
        name: 'logo.svg',
        mimeType: 'image/svg+xml',
        modifiedTime: T1,
        size: '11',
        body: '<svg onload=alert(1)/>',
      },
    ])
    const ok = await previewDocument({
      plan: plan({}, 'i1'),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(ok).toMatchObject({ state: 'ready', kind: 'image' })
    const svg = await previewDocument({
      plan: plan({}, 'i2'),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(svg.state).toBe('unsupported')
    expect(svg.reason).toMatch(/SVG image/)
  })

  it('derived text is cut at the index limit and says so', async () => {
    const big = `${'word '.repeat(LIMITS.derivedChars / 4)}`
    const d = drive([
      {
        id: 'f1',
        name: 'Long',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: T1,
        exported: big,
      },
    ])
    const r = recorder()
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: r.record,
      now: NOW,
    })
    expect(out.payload).toMatchObject({ truncated: true })
    expect(r.writes[0]?.truncated).toBe(true)
    expect((r.writes[0]?.text ?? '').length).toBeLessThanOrEqual(LIMITS.derivedChars)
  })
})

describe('the preview contract: unsupported', () => {
  it.each([
    ['application/zip', /show an archive here/],
    ['video/mp4', /show a video here/],
    ['application/vnd.google-apps.form', /Google Form/],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', /Excel/],
  ])(
    '%s is unsupported, with the honest alternatives, and nothing is downloaded',
    async (mimeType, words) => {
      const d = drive([{ id: 'f1', name: 'thing', mimeType, modifiedTime: T1, size: '99' }])
      const out = await previewDocument({
        plan: plan(),
        provider: asProvider(d.provider),
        extractText: noExtract,
        record: recorder().record,
        now: NOW,
      })
      expect(out.state).toBe('unsupported')
      expect(out.reason).toMatch(words)
      expect(out.alternatives).toEqual(['open_source', 'import'])
      expect(d.calls.map((c) => c.kind)).toEqual(['meta'])
    },
  )

  it('a Word file with no readable text is unsupported, not an empty preview', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'scan.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        modifiedTime: T1,
        size: '9',
        body: new Uint8Array([1]),
      },
    ])
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'unsupported', reason_code: 'no_text' })
  })

  it('a "text" file that holds binary data is unsupported', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'x.txt',
        mimeType: 'text/plain',
        modifiedTime: T1,
        size: '4',
        body: new Uint8Array([65, 0, 66, 0]),
      },
    ])
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out.state).toBe('failed')
    expect(out.reason_code).toBe('bad_content')
  })

  it('a source with no on-demand reader says so, and shows indexed text only if the source already indexed it', async () => {
    const n = { ...plan().document, connector: 'notion' } as NonNullable<PreviewPlan['document']>
    const none = await previewDocument({
      plan: plan({ document: n }),
      provider: never,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(none).toMatchObject({
      state: 'unsupported',
      reason_code: 'no_on_demand_reader',
      alternatives: ['open_source', 'import'],
    })
    const some = await previewDocument({
      plan: plan({ document: n, text: 'Indexed from Notion.' }),
      provider: never,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(some).toMatchObject({
      state: 'ready',
      mode: 'indexed',
      payload: { text: 'Indexed from Notion.' },
    })
    expect(some.notice).toMatch(/not read live/)
  })
})

describe('the preview contract: failed', () => {
  const run = async (status: number, body = '') => {
    const d = drive(
      [{ id: 'f1', name: 'x', mimeType: 'text/plain', modifiedTime: T1, size: '1', body: 'x' }],
      { fail: { 'meta:f1': { status, body } } },
    )
    return await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
  }
  it('404: gone or not shared, not retryable', async () => {
    const out = await run(404)
    expect(out).toMatchObject({ state: 'failed', reason_code: 'not_found', retryable: false })
    expect(out.alternatives).not.toContain('retry')
  })
  it('403: not allowed, not retryable', async () => {
    expect(
      await run(403, JSON.stringify({ error: { errors: [{ reason: 'forbidden' }] } })),
    ).toMatchObject({ state: 'failed', reason_code: 'forbidden', retryable: false })
  })
  it('403 rateLimitExceeded and 429: retryable, and Retry is offered', async () => {
    const a = await run(
      403,
      JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }),
    )
    const b = await run(429)
    for (const out of [a, b]) {
      expect(out).toMatchObject({ state: 'failed', reason_code: 'rate_limited', retryable: true })
      expect(out.alternatives[0]).toBe('retry')
    }
  })
  it('5xx: retryable', async () => {
    expect(await run(503)).toMatchObject({
      state: 'failed',
      reason_code: 'unavailable',
      retryable: true,
    })
    expect(await run(500)).toMatchObject({ retryable: true })
  })
  it('a network error is unreachable and retryable', async () => {
    const d = drive([], { fail: { f1: 'throw' } })
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'failed', reason_code: 'unreachable', retryable: true })
  })
  it('a file over the size limit is refused before it is downloaded', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'big.txt',
        mimeType: 'text/plain',
        modifiedTime: T1,
        size: String(LIMITS.binaryBytes + 1),
        body: 'x',
      },
    ])
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'failed', reason_code: 'too_large', retryable: false })
    expect(d.calls.map((c) => c.kind)).toEqual(['meta'])
  })
  it('a file in the Drive bin is not shown', async () => {
    const d = drive([
      { id: 'f1', name: 'x', mimeType: 'text/plain', modifiedTime: T1, trashed: true, body: 'x' },
    ])
    const out = await previewDocument({
      plan: plan(),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'failed', reason_code: 'not_found' })
  })
  it('an unknown document id fails once, the same way for every kind of miss', async () => {
    const out = await previewDocument({
      plan: { ok: false, error: 'There is no document with that id in this project.' },
      provider: never,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'failed', reason_code: 'not_found', retryable: false })
  })
  it('driveFailure never repeats the body of the response', () => {
    const f = driveFailure(500, 'secret-token-abc')
    expect(JSON.stringify(f)).not.toContain('secret-token')
  })
  it('no operator or no Google connection: failed and not retryable, with no Drive call made', async () => {
    const f: Failure = {
      code: 'operator_required',
      retryable: false,
      message: 'Only the operator can read from Drive.',
    }
    const out = await previewDocument({
      plan: plan(),
      provider: async () => f,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({
      state: 'failed',
      reason_code: 'operator_required',
      retryable: false,
    })
  })
})

describe('the stale rule', () => {
  it('compares modified time and checksum, not wall-clock strings', () => {
    const meta = {
      name: 'x',
      mime: 'm',
      modifiedTime: '2026-10-01T09:00:00Z',
      version: null,
      size: null,
      webViewLink: null,
      trashed: false,
    }
    expect(
      sourceChanged(cacheRow({ source_modified_time: '2026-10-01T09:00:00.000+00:00' }), meta),
    ).toBe(false)
    expect(sourceChanged(cacheRow({ source_modified_time: T2 }), meta)).toBe(true)
    expect(sourceChanged(null, meta)).toBe(true)
    expect(sourceChanged(cacheRow({ source_version: 'aa' }), { ...meta, version: 'bb' })).toBe(true)
    expect(sourceChanged(cacheRow({ source_version: 'aa' }), { ...meta, version: 'aa' })).toBe(
      false,
    )
  })

  it('a changed source is read again, and the page is told why', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Pricing',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: T2,
        exported: 'New words.',
      },
    ])
    const r = recorder()
    const out = await previewDocument({
      plan: plan({}, 'f1', cacheRow({ last_checked_at: '2026-10-02T00:00:00.000Z' }), 'Old words.'),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: r.record,
      now: NOW,
    })
    expect(out.state).toBe('ready')
    expect(out.payload).toMatchObject({ text: 'New words.' })
    expect(out.cache).toMatchObject({ refetched: true, was_stale: true })
    expect(out.notice).toMatch(/changed this file/)
    expect(d.calls.map((c) => c.kind)).toEqual(['meta', 'export'])
  })

  it('an unchanged source is NOT read again: only the check is remembered', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Pricing',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: T1,
        exported: 'Should never be fetched',
      },
    ])
    const r = recorder()
    const out = await previewDocument({
      plan: plan({}, 'f1', cacheRow({ last_checked_at: '2026-10-02T00:00:00.000Z' }), 'Old words.'),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: r.record,
      now: NOW,
    })
    expect(out.payload).toMatchObject({ text: 'Old words.' })
    expect(out.cache).toMatchObject({ refetched: false, was_stale: false })
    expect(d.calls.map((c) => c.kind)).toEqual(['meta'])
    expect(r.writes).toEqual([{ kind: 'text', text: null, truncated: false, modified: T1 }])
  })

  it('inside the freshness window Drive is not asked at all, and no token is minted', async () => {
    const c = cacheRow({ last_checked_at: new Date(NOW - 20_000).toISOString() })
    const out = await previewDocument({
      plan: plan({}, 'f1', c, 'Held words.'),
      provider: never,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'ready', payload: { text: 'Held words.' } })
  })

  it('just outside the window it asks again', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Pricing',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: T1,
      },
    ])
    const c = cacheRow({
      last_checked_at: new Date(NOW - (LIMITS.freshSeconds + 1) * 1000).toISOString(),
    })
    await previewDocument({
      plan: plan({}, 'f1', c, 'Held words.'),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(d.calls.length).toBeGreaterThan(0)
  })

  it('a PDF whose source moved on says it is showing the current one', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'R.pdf',
        mimeType: 'application/pdf',
        modifiedTime: T2,
        md5Checksum: 'bb',
        size: '40',
        body: PDF,
      },
    ])
    const c = cacheRow({
      kind: 'pdf',
      source_mime: 'application/pdf',
      source_version: 'aa',
      last_checked_at: '2026-10-02T00:00:00.000Z',
    })
    const out = await previewDocument({
      plan: plan({}, 'f1', c),
      provider: asProvider(d.provider),
      extractText: pdfExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out.cache).toMatchObject({ was_stale: true })
    expect(out.notice).toMatch(/newer version/)
  })

  it('when Drive cannot be asked, the cache is shown as STALE with the reason, never silently', async () => {
    const d = drive([], { fail: { f1: { status: 503 } } })
    const c = cacheRow({ last_checked_at: '2026-10-02T00:00:00.000Z' })
    const out = await previewDocument({
      plan: plan({}, 'f1', c, 'Old words.'),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out.state).toBe('stale')
    expect(out.payload).toMatchObject({ text: 'Old words.' })
    expect(out.reason).toMatch(/Showing what Team HQ read last time/)
    expect(out.retryable).toBe(true)
    expect(out.alternatives).toContain('retry')
  })

  it('a file that is gone is NOT served from the cache as if it were not', async () => {
    const d = drive([])
    const c = cacheRow({ last_checked_at: '2026-10-02T00:00:00.000Z' })
    const out = await previewDocument({
      plan: plan({}, 'f1', c, 'Old words.'),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out.state).toBe('failed')
    expect(out.payload).toBeUndefined()
  })

  it('without a usable token the cache is shown as stale and the reason is the token, not Drive', async () => {
    const f: Failure = {
      code: 'operator_required',
      retryable: false,
      message: 'Only the operator can read from Drive.',
    }
    const c = cacheRow({ last_checked_at: '2026-10-02T00:00:00.000Z' })
    const out = await previewDocument({
      plan: plan({}, 'f1', c, 'Old words.'),
      provider: async () => f,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({
      state: 'stale',
      reason_code: 'operator_required',
      retryable: false,
    })
    expect(out.alternatives).not.toContain('retry')
  })
})

describe("a disconnected source (0896) and Team HQ's own documents", () => {
  it('is neither fetched nor shown from the cache', async () => {
    const c = cacheRow()
    const out = await previewDocument({
      plan: plan({ connected: false }, 'f1', c, 'Cached words'),
      provider: never,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'unsupported', reason_code: 'source_disconnected' })
    expect(out.payload).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('Cached words')
    expect(out.alternatives).toEqual(['open_source', 'reconnect'])
  })
  it('an archived external document is not read', async () => {
    const p = plan()
    const out = await previewDocument({
      plan: plan({
        document: { ...(p.document as NonNullable<PreviewPlan['document']>), state: 'archived' },
      }),
      provider: never,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'unsupported', reason_code: 'archived' })
  })
  it('a held document (uploaded, made, an imported copy) contacts nothing', async () => {
    const out = await previewDocument({
      plan: plan({ mode: 'held', imported: false }),
      provider: never,
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out).toMatchObject({ state: 'ready', kind: 'held', mode: 'held' })
  })
  it('the original of an imported document says a copy exists', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'Pricing',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: T1,
        exported: 'x',
      },
    ])
    const out = await previewDocument({
      plan: plan({ imported: true }),
      provider: asProvider(d.provider),
      extractText: noExtract,
      record: recorder().record,
      now: NOW,
    })
    expect(out.imported).toBe(true)
  })
})

describe('streaming bytes, and keeping none of them', () => {
  const pdfDrive = () =>
    drive([
      {
        id: 'f1',
        name: 'Report.pdf',
        mimeType: 'application/pdf',
        modifiedTime: T1,
        md5Checksum: 'aa',
        size: String(PDF.byteLength),
        body: PDF,
      },
    ])

  it('a PDF streams the exact bytes, derives its text in passing, and records text and markers only', async () => {
    const d = pdfDrive()
    const r = recorder()
    const out = await streamDocument({
      plan: plan(),
      provider: d.provider,
      extractText: pdfExtract,
      record: r.record,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.mime).toBe('application/pdf')
    expect([...out.bytes]).toEqual([...PDF])
    expect(r.writes).toEqual([
      { kind: 'pdf', text: 'Quarterly plan. Revenue up.', truncated: false, modified: T1 },
    ])
    // The only network the code can reach is Drive's: no storage host exists to write to (the fake throws on any other).
    expect(d.calls.every((c) => c.kind === 'meta' || c.kind === 'media')).toBe(true)
    // The recorder is handed text and markers, never bytes.
    for (const w of r.writes)
      expect((Object.values(w) as unknown[]).some((v) => v instanceof Uint8Array)).toBe(false)
  })

  it('an unchanged PDF is streamed without re-reading its text', async () => {
    const d = pdfDrive()
    const r = recorder()
    let extracted = 0
    const c = cacheRow({
      kind: 'pdf',
      source_mime: 'application/pdf',
      source_modified_time: T1,
      source_version: 'aa',
    })
    await streamDocument({
      plan: plan({}, 'f1', c),
      provider: d.provider,
      extractText: async (...a) => {
        extracted += 1
        return await pdfExtract(...a)
      },
      record: r.record,
    })
    expect(extracted).toBe(0)
    expect(r.writes[0]?.text).toBeNull()
  })

  it('an image streams; the bytes must be what the label says', async () => {
    const d = drive([
      { id: 'i1', name: 'a.png', mimeType: 'image/png', modifiedTime: T1, size: '11', body: PNG },
      {
        id: 'i2',
        name: 'b.png',
        mimeType: 'image/png',
        modifiedTime: T1,
        size: '11',
        body: '<html><script>alert(1)</script></html>',
      },
    ])
    expect(
      (
        await streamDocument({
          plan: plan({}, 'i1'),
          provider: d.provider,
          extractText: noExtract,
          record: recorder().record,
        })
      ).ok,
    ).toBe(true)
    const bad = await streamDocument({
      plan: plan({}, 'i2'),
      provider: d.provider,
      extractText: noExtract,
      record: recorder().record,
    })
    expect(bad).toMatchObject({ ok: false, status: 415 })
  })

  it('refuses a file over the cap before downloading it', async () => {
    const d = drive([
      {
        id: 'f1',
        name: 'big.pdf',
        mimeType: 'application/pdf',
        modifiedTime: T1,
        size: String(LIMITS.binaryBytes + 1),
        body: PDF,
      },
    ])
    const out = await streamDocument({
      plan: plan(),
      provider: d.provider,
      extractText: pdfExtract,
      record: recorder().record,
    })
    expect(out).toMatchObject({ ok: false, status: 413 })
    expect(d.calls.map((c) => c.kind)).toEqual(['meta'])
  })

  it('refuses a disconnected source, a held document and a text file', async () => {
    const d = pdfDrive()
    const dis = await streamDocument({
      plan: plan({ connected: false }),
      provider: d.provider,
      extractText: pdfExtract,
      record: recorder().record,
    })
    expect(dis).toMatchObject({ ok: false, status: 409 })
    const held = await streamDocument({
      plan: plan({ mode: 'held' }),
      provider: d.provider,
      extractText: pdfExtract,
      record: recorder().record,
    })
    expect(held).toMatchObject({ ok: false, status: 404 })
    const t = drive([
      { id: 'f1', name: 'n.txt', mimeType: 'text/plain', modifiedTime: T1, size: '1', body: 'x' },
    ])
    expect(
      await streamDocument({
        plan: plan(),
        provider: t.provider,
        extractText: noExtract,
        record: recorder().record,
      }),
    ).toMatchObject({ ok: false, status: 415 })
    expect(d.calls).toHaveLength(0)
  })

  it('passes a Drive failure through with its words', async () => {
    const d = drive([], {
      fail: {
        f1: {
          status: 403,
          body: JSON.stringify({ error: { errors: [{ reason: 'downloadQuotaExceeded' }] } }),
        },
      },
    })
    const out = await streamDocument({
      plan: plan(),
      provider: d.provider,
      extractText: pdfExtract,
      record: recorder().record,
    })
    expect(out).toMatchObject({ ok: false, failure: { code: 'quota' } })
  })

  it('sniff accepts real magic numbers and nothing else', () => {
    expect(sniff(PDF, 'application/pdf')).toBe(true)
    expect(sniff(PNG, 'image/png')).toBe(true)
    expect(sniff(PNG, 'application/pdf')).toBe(false)
    expect(sniff(new TextEncoder().encode('<script>'), 'image/png')).toBe(false)
    expect(sniff(PDF, 'image/svg+xml')).toBe(false)
  })
})

describe('capText', () => {
  it('leaves short text alone and normalises line endings', () => {
    expect(capText('a\r\nb')).toEqual({ text: 'a\nb', truncated: false })
  })
})
