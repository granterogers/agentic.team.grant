import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  commandEngine,
  engineRunFor,
  type HermesTurnDeps,
  openHermesTurn,
  resumeHermesTurn,
} from '../../src/engines/hermes/turn.ts'
import type { EngineRunRow } from '../../src/engines/hermes/types.ts'
import { requestProblem } from '../../src/engines/hermes/types.ts'
import type { Job } from '../../src/jobs/worker.ts'

type Reply = { rows: Record<string, unknown>[] } | Error

/** A database that records every statement and answers by the first matching rule; an unmatched statement answers no rows. */
const fakeDb = (rules: [RegExp, Reply | (() => Reply)][]) => {
  const seen: string[] = []
  return {
    kind: 'fake',
    seen,
    execute: async (sql: string) => {
      seen.push(sql)
      for (const [re, reply] of rules) {
        if (!re.test(sql)) continue
        const r = typeof reply === 'function' ? reply() : reply
        if (r instanceof Error) throw r
        return r
      }
      return { rows: [] }
    },
  }
}

const job: Job = {
  jobId: '11111111-1111-4111-8111-111111111111',
  kind: 'office.instruction',
  correlationId: 'c',
  projectId: null,
  idempotencyKey: 'k',
  attempt: 1,
}
const COMMAND = '22222222-2222-4222-8222-222222222222'

describe('engineRunFor (the resume door)', () => {
  it('is null for a job with no run', async () => {
    const db = fakeDb([[/engine_run_for_job/, { rows: [{ r: null }] }]])
    expect(await engineRunFor(db, job)).toBeNull()
  })
  it('returns the run, whether the driver hands jsonb back as an object or as text', async () => {
    const run = {
      run_id: 'r',
      state: 'running',
      engine: 'hermes',
      deadline_at: 'd',
      result: null,
      failure: null,
    }
    expect(
      await engineRunFor(fakeDb([[/engine_run_for_job/, { rows: [{ r: run }] }]]), job),
    ).toEqual(run)
    expect(
      await engineRunFor(
        fakeDb([[/engine_run_for_job/, { rows: [{ r: JSON.stringify(run) }] }]]),
        job,
      ),
    ).toEqual(run)
  })
  it('is null on a database that predates the engine (the function does not exist)', async () => {
    const db = fakeDb([
      [/engine_run_for_job/, new Error('42883 function app.engine_run_for_job does not exist')],
    ])
    expect(await engineRunFor(db, job)).toBeNull()
  })
  it('THROWS on any other failure, so a job holding a run is never answered by the team because a read failed', async () => {
    const db = fakeDb([[/engine_run_for_job/, new Error('connection reset by peer')]])
    await expect(engineRunFor(db, job)).rejects.toThrow(/connection reset/)
  })
  it('asks for the job in the job’s own office, never an office it was told', async () => {
    const db = fakeDb([[/engine_run_for_job/, { rows: [{ r: null }] }]])
    await engineRunFor(db, job)
    expect(db.seen[0]).toMatch(/app\.job_office\('11111111-1111-4111-8111-111111111111'::uuid\)/)
  })
})

describe('commandEngine (the open door)', () => {
  it('is team with no command, without asking the database', async () => {
    const db = fakeDb([])
    expect(await commandEngine(db, job, '')).toBe('team')
    expect(db.seen).toEqual([])
  })
  it('is hermes only when the stored word is exactly hermes', async () => {
    expect(
      await commandEngine(
        fakeDb([[/inbound_commands/, { rows: [{ engine: 'hermes' }] }]]),
        job,
        COMMAND,
      ),
    ).toBe('hermes')
    for (const v of ['team', 'HERMES', '', null, undefined, 'other'])
      expect(
        await commandEngine(
          fakeDb([[/inbound_commands/, { rows: [{ engine: v }] }]]),
          job,
          COMMAND,
        ),
      ).toBe('team')
    expect(await commandEngine(fakeDb([[/inbound_commands/, { rows: [] }]]), job, COMMAND)).toBe(
      'team',
    )
  })
  it('is team on a database with no engine column yet', async () => {
    const db = fakeDb([[/inbound_commands/, new Error('42703 column "engine" does not exist')]])
    expect(await commandEngine(db, job, COMMAND)).toBe('team')
  })
  it('THROWS on any other failure: a message sent to Hermes is never quietly answered by the team', async () => {
    const db = fakeDb([[/inbound_commands/, new Error('statement timeout')]])
    await expect(commandEngine(db, job, COMMAND)).rejects.toThrow(/statement timeout/)
  })
  it("reads the command in the job's own office", async () => {
    const db = fakeDb([[/inbound_commands/, { rows: [{ engine: 'team' }] }]])
    await commandEngine(db, job, COMMAND)
    expect(db.seen[0]).toMatch(/office_id = app\.job_office\(/)
  })
})

const available = { rows: [{ r: { available: true, because: null } }] }
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const open = (state: EngineRunRow['state'], extra: Partial<EngineRunRow> = {}): EngineRunRow => ({
  run_id: RUN_ID,
  state,
  engine: 'hermes',
  deadline_at: '2030-01-01T00:00:00Z',
  result: null,
  failure: null,
  ...extra,
})
const calls = (db: { seen: string[] }, re: RegExp): number =>
  db.seen.filter((s) => re.test(s)).length
const deps = (db: ReturnType<typeof fakeDb>): HermesTurnDeps => ({
  db,
  turnsBefore: async () => [{ said: 'earlier question', answered: 'earlier answer' }],
  now: () => new Date('2026-10-11T10:00:00Z'),
})

describe('openHermesTurn', () => {
  it('an unavailable Hermes is one honest sentence: no run is opened, the job is not parked, nothing else is done', async () => {
    const db = fakeDb([
      [
        /engine_available/,
        {
          rows: [
            { r: { available: false, because: "Hermes's host hasn't checked in for 7 minutes" } },
          ],
        },
      ],
    ])
    const out = await openHermesTurn(deps(db), job, { instruction: 'hello', commandId: COMMAND })
    expect(out.body).toContain("Hermes's host hasn't checked in for 7 minutes")
    expect(out.body).toMatch(/Nothing else was done/)
    expect(calls(db, /engine_run_open/)).toBe(0)
    expect(calls(db, /pause_job/)).toBe(0)
    expect(out.path).toBe('deterministic_retrieval')
    expect(out.model).toBeNull()
  })
  it('never falls back to the team: it asks no model, enqueues nothing and writes no routing decision', async () => {
    const db = fakeDb([
      [/engine_available/, { rows: [{ r: { available: false, because: 'off' } }] }],
    ])
    await openHermesTurn(deps(db), job, { instruction: 'hello', commandId: COMMAND })
    const text = db.seen.join('\n')
    expect(text).not.toMatch(/routing_decisions|enqueue|inference_usage\s*\(|insert into/i)
  })
  it('opens ONE run with an acceptable request and parks the job as a dependency wait', async () => {
    const db = fakeDb([
      [/engine_available/, available],
      [/engine_run_open/, { rows: [{ r: { run_id: RUN_ID, state: 'open', opened: true } }] }],
      [/engine_run_for_job/, { rows: [{ r: open('open') }] }],
    ])
    const out = await openHermesTurn(deps(db), job, {
      instruction: 'What is due?',
      commandId: COMMAND,
    })
    expect(calls(db, /engine_run_open/)).toBe(1)
    const stmt = db.seen.find((s) => /engine_run_open/.test(s)) ?? ''
    const json = /'(\{.*\})'::jsonb/s.exec(stmt)?.[1]?.replace(/''/g, "'") ?? '{}'
    const request = JSON.parse(json)
    expect(request.input).toBe('What is due?')
    expect(request.conversation_history).toEqual([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ])
    expect(requestProblem(request)).toBeNull()
    expect(Object.keys(request).sort()).toEqual(['conversation_history', 'input', 'instructions'])
    const pause = db.seen.find((s) => /pause_job/.test(s)) ?? ''
    expect(pause).toContain('dependency_wait')
    expect(pause).toContain('Hermes is working on it.')
    expect(out.announce).toBe(false)
    expect(out.body).toBe('Hermes is working on it.')
  })
  it('refuses to open for the office’s own work: the database says so and the person is told, with no pause', async () => {
    const db = fakeDb([
      [/engine_available/, available],
      [
        /engine_run_open/,
        {
          rows: [
            {
              r: {
                error: 'not_from_a_person',
                because: 'Only a message you send yourself can be sent to Hermes.',
              },
            },
          ],
        },
      ],
    ])
    const out = await openHermesTurn(deps(db), job, { instruction: 'x', commandId: COMMAND })
    expect(out.body).toContain('Only a message you send yourself can be sent to Hermes')
    expect(calls(db, /pause_job/)).toBe(0)
  })
  it('a failed conversation read does not stop the run', async () => {
    const db = fakeDb([
      [/engine_available/, available],
      [/engine_run_open/, { rows: [{ r: { run_id: RUN_ID, state: 'open', opened: true } }] }],
      [/engine_run_for_job/, { rows: [{ r: open('open') }] }],
    ])
    const out = await openHermesTurn(
      { ...deps(db), turnsBefore: async () => Promise.reject(new Error('boom')) },
      job,
      { instruction: 'x', commandId: COMMAND },
    )
    expect(out.body).toBe('Hermes is working on it.')
  })
})

describe('resumeHermesTurn', () => {
  it('a run still open or running parks the job again and says nothing new', async () => {
    for (const state of ['open', 'running'] as const) {
      const db = fakeDb([])
      const out = await resumeHermesTurn(deps(db), job, open(state))
      expect(calls(db, /pause_job/)).toBe(1)
      expect(out.announce).toBe(false)
      expect(out.body).toBe('Hermes is working on it.')
    }
  })
  it('failed, expired and cancelled each say what happened, in code, and change nothing', async () => {
    const stored = {
      rows: [{ request: { input: 'q', instructions: '', conversation_history: [] }, minutes: 15 }],
    }
    const failed = await resumeHermesTurn(
      deps(fakeDb([[/engine_runs/, stored]])),
      job,
      open('failed', { failure: 'bridge_lost' }),
    )
    expect(failed.body).toMatch(
      /couldn't finish this \(the computer running it stopped answering\)/,
    )
    const expired = await resumeHermesTurn(
      deps(fakeDb([[/engine_runs/, stored]])),
      job,
      open('expired'),
    )
    expect(expired.body).toMatch(/longer than 15 minutes/)
    const pressed = await resumeHermesTurn(
      deps(
        fakeDb([
          [/engine_runs/, stored],
          [/stop_requested/, { rows: [{ r: true }] }],
        ]),
      ),
      job,
      open('cancelled'),
    )
    expect(pressed.body).toMatch(/Stopped/)
    expect(pressed.announce).toBe(false)
    const notPressed = await resumeHermesTurn(
      deps(
        fakeDb([
          [/engine_runs/, stored],
          [/stop_requested/, { rows: [{ r: false }] }],
        ]),
      ),
      job,
      open('cancelled'),
    )
    // The waiting pass left `announce = false` on the job, so an ending that is news says so explicitly.
    expect(notPressed.announce).toBe(true)
    expect(failed.announce).toBe(true)
    expect(expired.announce).toBe(true)
    for (const o of [failed, expired, pressed]) expect(o.evidence).toBe('verified')
  })
  it('a completed run becomes an inferred answer grounded on the served calls only', async () => {
    const db = fakeDb([
      [
        /engine_runs/,
        {
          rows: [
            {
              request: {
                input: 'What is due?',
                instructions: '',
                conversation_history: [
                  { role: 'user', content: 'I run Harvest Lane' },
                  { role: 'assistant', content: 'old office prose' },
                ],
              },
              minutes: 15,
            },
          ],
        },
      ],
      [
        /engine_run_grounding/,
        {
          rows: [
            {
              r: {
                excerpts: ['Task: order seed'],
                domains: ['tasks'],
                complete_domains: [],
                tools: ['list_tasks'],
              },
            },
          ],
        },
      ],
    ])
    const out = await resumeHermesTurn(
      deps(db),
      job,
      open('completed', {
        result: {
          answer: 'Order seed by Friday.',
          model: 'm:free',
          tools_started: 1,
          approvals_denied: 0,
        },
      }),
    )
    expect(out.body).toBe('Order seed by Friday.')
    expect(out.announce).toBe(true)
    expect(out.evidence).toBe('inferred')
    expect(out.path).toBe('inference')
    expect(out.sources).toEqual(['hermes:list_tasks'])
    expect(out.grounding).toContain('Task: order seed')
    expect(out.grounding).not.toContain('old office prose')
  })
  it('a completed run with an empty answer is a failure sentence, never an empty reply', async () => {
    const db = fakeDb([
      [
        /engine_runs/,
        {
          rows: [
            { request: { input: 'q', instructions: '', conversation_history: [] }, minutes: 15 },
          ],
        },
      ],
      [
        /engine_run_grounding/,
        { rows: [{ r: { excerpts: [], domains: [], complete_domains: [], tools: [] } }] },
      ],
    ])
    const out = await resumeHermesTurn(
      deps(db),
      job,
      open('completed', { result: { answer: '  ', tools_started: 0, approvals_denied: 0 } }),
    )
    expect(out.body).toMatch(/couldn't finish/)
  })
})

describe('the seam in instruction.ts', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
  it('asks for an existing run before it reads or cleans the message, and resumes it', () => {
    const resume = src.indexOf(
      'if (hermesRun !== null) return resumeHermesTurn(hermesDeps, job, hermesRun)',
    )
    expect(resume).toBeGreaterThan(0)
    expect(src.indexOf('const hermesRun = await engineRunFor(deps.db, job)')).toBeLessThan(resume)
    expect(resume).toBeLessThan(src.indexOf('instruction = cleanDictation(instruction)'))
  })
  it('opens a run after the instruction is resolved and before any routing, planning or model work', () => {
    const open = src.indexOf(
      "if ((await commandEngine(deps.db, job, String(payload.command_id ?? ''))) === 'hermes')",
    )
    expect(open).toBeGreaterThan(0)
    expect(src.slice(open, open + 250)).toMatch(/return openHermesTurn\(hermesDeps, job,/)
    expect(open).toBeGreaterThan(src.indexOf('const paired = await pairWithNearby('))
    expect(open).toBeLessThan(src.indexOf('const rejects = rejectsWithoutSaying(cleanedWords)'))
    expect(open).toBeLessThan(src.indexOf('await speaker('))
  })
  it('nothing in the engine module reaches a model router', () => {
    const mod = ['turn', 'brief', 'result']
      .map((f) => readFileSync(`src/engines/hermes/${f}.ts`, 'utf8'))
      .join('\n')
    expect(mod).not.toMatch(/router|\.complete\(|ProviderRouter|openrouter/i)
  })
})
