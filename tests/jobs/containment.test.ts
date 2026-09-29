/**
 * Every job kind says what it can do outside the office (#378).
 *
 * `src/jobs/containment.ts` treats an unlisted kind as external, which keeps a
 * new handler contained at run time. This makes the author classify it before
 * the change lands, and it is read from the source the same way the other
 * wiring tests here are, so a kind added to a handler cannot be missed by a
 * list somebody forgot to update.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { containmentRefusal, REACH, reachOf } from '../../src/jobs/containment.ts'

const KIND = /'([a-z_]+\.[a-z_]+)'/g
const handlerKinds = (): Set<string> => {
  const kinds = new Set<string>()
  for (const f of readdirSync('src/handlers')) {
    if (!f.endsWith('.ts')) continue
    for (const m of readFileSync(`src/handlers/${f}`, 'utf8').matchAll(
      /kind: '([a-z_]+\.[a-z_]+)'/g,
    ))
      kinds.add(String(m[1]))
  }
  // Kinds handed to a handler factory by the pass, e.g. the two channel kinds.
  const pass = readFileSync('src/office/pass.ts', 'utf8')
  for (const block of pass.matchAll(/\.\.\.\[([^\]]+)\]\.map\(\(kind\)/g))
    for (const m of String(block[1]).matchAll(KIND)) kinds.add(String(m[1]))
  return kinds
}

/*
  A database that answers the gate's question. `h` is the old harness_job
  answer and is translated to the origin it implies (true -> harness,
  false -> trusted, anything else -> not a word the gate knows); `o` is an
  origin given directly.
*/
const fakeDb = (answer: { h?: unknown; o?: unknown; known?: unknown } | Error): SqlExecutor =>
  ({
    execute: async () => {
      if (answer instanceof Error) throw answer
      const o =
        'o' in answer
          ? answer.o
          : answer.h === true
            ? 'harness'
            : answer.h === false
              ? 'trusted'
              : answer.h
      return { rows: [{ o, known: answer.known }] }
    },
  }) as unknown as SqlExecutor

describe('containment: every job kind is classified', () => {
  const kinds = handlerKinds()
  it('found the handler kinds (a scan that finds nothing proves nothing)', () => {
    expect(kinds.size).toBeGreaterThan(35)
    expect(kinds.has('office.notion_import')).toBe(true)
    expect(kinds.has('office.provision_channels')).toBe(true)
  })
  it('every kind a handler serves is in the registry', () => {
    expect([...kinds].filter((k) => REACH[k] === undefined)).toEqual([])
  })
  it('the registry names no kind that nothing serves', () => {
    expect(Object.keys(REACH).filter((k) => !kinds.has(k))).toEqual([])
  })
  it('every external kind names who is on the other end', () => {
    for (const [k, v] of Object.entries(REACH))
      if (v.reach === 'external') expect(v.service, k).toBeTruthy()
  })
  it('the writers the audit found are external', () => {
    for (const k of [
      'office.notion_import',
      'office.notion_adopt',
      'notebook.add_source',
      'notebook.push_document',
      'office.execute_plan',
      'google.revoke',
      'ci.dispatch',
      'office.vault_export',
      'google.write_calendar_tasks',
    ])
      expect(reachOf(k).reach, k).toBe('external')
  })
  it('an unlisted kind is external (fails closed)', () => {
    expect(reachOf('something.new').reach).toBe('external')
  })
})

describe('containment: the refusal', () => {
  const job = (kind: string) => ({ jobId: '00000000-0000-0000-0000-000000000001', kind })
  it('refuses harness work of an external kind', async () => {
    expect(
      await containmentRefusal(fakeDb({ h: true, known: true }), job('office.notion_import')),
    ).toMatch(/harness work may not write to Notion/)
  })
  it('lets real work of an external kind through', async () => {
    expect(
      await containmentRefusal(fakeDb({ h: false, known: true }), job('office.notion_import')),
    ).toBeNull()
  })
  it('never asks about an internal or read kind', async () => {
    const db = fakeDb(new Error('must not be asked'))
    expect(await containmentRefusal(db, job('office.instruction'))).toBeNull()
    expect(await containmentRefusal(db, job('browser.gather'))).toBeNull()
  })
  it('refuses when the question cannot be answered', async () => {
    expect(await containmentRefusal(fakeDb(new Error('down')), job('ci.dispatch'))).toMatch(
      /could not establish/,
    )
    expect(
      await containmentRefusal(fakeDb({ h: false, known: false }), job('ci.dispatch')),
    ).toMatch(/could not establish/)
    expect(await containmentRefusal(fakeDb({ h: null, known: true }), job('ci.dispatch'))).toMatch(
      /could not establish/,
    )
  })
})

describe('containment: the origin question (#379)', () => {
  const job = (kind: string) => ({ jobId: '00000000-0000-0000-0000-000000000001', kind })
  it('refuses work of unknown origin', async () => {
    expect(
      await containmentRefusal(fakeDb({ o: 'unknown', known: true }), job('office.notion_import')),
    ).toMatch(/no production door or office process made this work/)
  })
  it("lets the office's own work through", async () => {
    expect(
      await containmentRefusal(fakeDb({ o: 'internal', known: true }), job('office.notion_sync')),
    ).toBeNull()
  })
  it('refuses an origin word it does not know', async () => {
    expect(
      await containmentRefusal(fakeDb({ o: 'probably-fine', known: true }), job('ci.dispatch')),
    ).toMatch(/could not establish/)
  })
  const twoStep = (first: Error, second: { h: unknown; known: unknown }): SqlExecutor => {
    let calls = 0
    return {
      execute: async () => {
        calls += 1
        if (calls === 1) throw first
        return { rows: [second] }
      },
    } as unknown as SqlExecutor
  }
  it('before 0603 exists, asks app.harness_job instead (deploy order)', async () => {
    const missing = new Error('42883: function app.job_origin(uuid) does not exist')
    expect(
      await containmentRefusal(twoStep(missing, { h: false, known: true }), job('ci.dispatch')),
    ).toBeNull()
    expect(
      await containmentRefusal(twoStep(missing, { h: true, known: true }), job('ci.dispatch')),
    ).toMatch(/harness work/)
  })
  it('any other error still refuses, and never falls back', async () => {
    expect(
      await containmentRefusal(
        twoStep(new Error('57014: canceling statement due to statement timeout'), {
          h: false,
          known: true,
        }),
        job('ci.dispatch'),
      ),
    ).toMatch(/could not establish/)
  })
})

describe('containment: a handler may speak only for a kind nobody listed', () => {
  const job = (kind: string) => ({ jobId: '00000000-0000-0000-0000-000000000001', kind })
  it('cannot relabel a production writer as internal', async () => {
    expect(
      await containmentRefusal(
        fakeDb({ h: true, known: true }),
        job('office.notion_import'),
        'internal',
      ),
    ).toMatch(/Notion/)
  })
  it('may declare a suite-only kind internal', async () => {
    expect(
      await containmentRefusal(
        fakeDb(new Error('must not be asked')),
        job('research.liar'),
        'internal',
      ),
    ).toBeNull()
  })
  it('an undeclared suite-only kind is still refused for harness work', async () => {
    expect(
      await containmentRefusal(fakeDb({ h: true, known: true }), job('research.liar')),
    ).toMatch(/unclassified/)
  })
})

describe('containment: the worker asks before the handler', () => {
  const worker = readFileSync('src/jobs/worker.ts', 'utf8')
  it('runJob cancels contained work before the "on it" and before the handler', () => {
    const gate = worker.indexOf(
      'const contained = await containmentRefusal(db, job, handler.reach)',
    )
    const onStart = worker.indexOf('await onStart(job)')
    const handle = worker.indexOf('output = await handler.handle(job, db)')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(onStart)
    expect(gate).toBeLessThan(handle)
    expect(worker.slice(gate, gate + 300)).toMatch(
      /moveTo\(db, job\.jobId, 'cancelled', contained\)/,
    )
  })
})

describe('containment: nothing in the office sends around the delivery guard', () => {
  /*
    A message sent with a bare fetch is one app.claim_delivery never saw: no
    decision about harness traffic, no row, nothing a witness can count. The
    exceptions are named with the reason they are safe, so a new one has to
    argue for itself.
  */
  const SENDS = /(api\.telegram\.org\/bot[^/`'"]*\/send|slack\.com\/api\/chat\.)/
  const ALLOWED: Record<string, string> = {
    // Its job kind is external in the registry, so the worker cancels harness work before it runs.
    'src/backup/vault-export.ts': 'office.vault_export is contained at the job boundary',
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(`${dir}/${e.name}`)
        : e.name.endsWith('.ts')
          ? [`${dir}/${e.name}`]
          : [],
    )
  it('found the source (a scan that finds nothing proves nothing)', () => {
    expect(walk('src').length).toBeGreaterThan(100)
  })
  it('no direct send outside the clients and the named exceptions', () => {
    const offenders = walk('src')
      .filter(
        (f) => !['src/telegram/api.ts', 'src/slack/api.ts'].includes(f) && ALLOWED[f] === undefined,
      )
      .filter((f) => SENDS.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
  it('the pattern catches the shape it exists for', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of the defect, quoted verbatim
    expect(SENDS.test('await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {')).toBe(
      true,
    )
    expect(SENDS.test("fetch('https://slack.com/api/chat.postMessage')")).toBe(true)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of the defect, quoted verbatim
    expect(SENDS.test('await fetch(`https://api.telegram.org/bot${token}/getFile`, {')).toBe(false)
  })
  it('the transcript echo and the correction question carry their job', () => {
    const instruction = readFileSync('src/handlers/instruction.ts', 'utf8')
    const echo = instruction.slice(instruction.indexOf('async function echoTranscript('))
    expect(echo.slice(0, 2500)).toMatch(
      /dedupeKey: `heard:\$\{job\.jobId\}`[\s\S]*jobId: job\.jobId,/,
    )
    const callbacks = readFileSync('src/channels/callbacks.ts', 'utf8')
    const ask = callbacks.slice(callbacks.indexOf('const askForTheCorrection = async'))
    expect(ask.slice(0, 2500)).toMatch(/\.deliver\(\{[\s\S]*jobId: row\.job_id,/)
  })
})
