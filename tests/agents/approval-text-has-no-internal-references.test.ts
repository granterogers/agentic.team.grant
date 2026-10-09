/**
 * No sentence an approval puts in front of a person carries a plan step id, a tool code or an issue number.
 *
 * Found by the Version 1 acceptance suite (journey G): the message that asks for approval read
 * `I have stopped before "s4:draft.create" because I need you to say. draft.create: ...`. CLAUDE.md's #242 rule: an
 * internal reference in text a person or a model reads becomes part of the answer. The id stays in the job's state
 * (the step name, the fingerprint's `binds`, the pause detail); the sentence is in plain words.
 *
 * Driven, not read: the real step runner, the real composers, a recording database. Plus one source property over every
 * module that raises a question, for the writers that cannot be driven without a database.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { governOutward } from '../../src/agents/approval.ts'
import type { GoalPlan, PlanStep } from '../../src/agents/goal.ts'
import {
  reasonInWords,
  STEP_ID_SHAPE,
  stepInWords,
  stoppedPartWay,
  stoppedToAsk,
} from '../../src/agents/pause-words.ts'
import { compile } from '../../src/agents/perform.ts'
import type { Paused } from '../../src/jobs/checkpoint.ts'

const JOB = '00000000-0000-0000-0000-0000000000aa'
const ISSUE = /#\d{2,}/

/** A database that answers every statement with one row carrying a policy decision, and records the SQL. */
const recording = (decision: Record<string, unknown>) => {
  const sql: string[] = []
  const db = {
    execute: async (q: string) => {
      sql.push(q)
      return { rows: [{ d: decision, blocker_id: 'b-1' }] }
    },
  }
  return { db: db as never, sql }
}

const stepOf = (over: Partial<PlanStep>): PlanStep => ({
  id: 's4',
  capability: 'draft.create',
  why: 'Prepare the note to the venue',
  needs: [],
  specialist: null,
  audience: 'outside',
  ...over,
})
const planOf = (step: PlanStep): GoalPlan => ({
  goal: 'g',
  steps: [step],
  unreachable: [],
  refused: [],
  how: 'model',
  why: null,
  model: null,
})

const ASKS: Record<string, unknown>[] = [
  {
    verdict: 'ask',
    reason: 'outside_audience',
    because: 'This is meant for somebody outside the office, so it waits for your say-so.',
  },
  { verdict: 'ask', reason: 'dial', autonomy: 'suggest', because: 'It proposes; you decide.' },
]

describe('a plan step that asks: what is written to the blocker and what the person is told', () => {
  for (const ask of ASKS) {
    for (const why of [
      'Prepare the note to the venue',
      'Email the caterer about the allergy list',
      '', // a step with no description at all
    ]) {
      for (const capability of ['draft.create', 'task.create', 'task.extract']) {
        it(`${capability} / "${why.slice(0, 20)}" / ${String(ask.reason)}`, async () => {
          const { db, sql } = recording(ask)
          const [step] = compile(
            planOf(stepOf({ capability, why })),
            db,
            JOB,
            null,
            'Please sort the venue out',
          )
          const result = await step?.run({})
          const pause = result?.pause as Paused
          expect(pause?.reason).toBe('awaiting_approval')

          // what the person is told
          for (const said of [stoppedToAsk(pause), stoppedPartWay(pause)]) {
            expect(said).not.toMatch(STEP_ID_SHAPE)
            expect(said).not.toMatch(new RegExp(`\\b${capability.replace('.', '\\.')}\\b`))
            expect(said).not.toMatch(ISSUE)
            // and what he needs to decide is still there: what will happen, and why it waits
            expect(said).toContain(why === '' ? 'the next step' : why)
            expect(said).toContain(String(ask.because))
          }

          // what is written for him to answer: the blocker's own columns
          const insert = sql.find((q) => q.includes('insert into public.blockers')) ?? ''
          expect(insert).not.toBe('')
          expect(insert).not.toMatch(STEP_ID_SHAPE)
          expect(insert).not.toMatch(new RegExp(`'[^']*\\b${capability.replace('.', '\\.')}\\b`))

          // the machinery is intact: the id and the tool are still in the pause's own state and in what is bound
          expect(pause.detail).toContain(capability)
          expect((pause.binds as { step?: string }).step).toBe(`s4:${capability}`)
        })
      }
    }
  }
})

describe('the other question composers', () => {
  it('governOutward: the blocker it raises carries no id, no tool code, no issue number', async () => {
    let drafted: Record<string, unknown> | undefined
    await governOutward(
      recording({ verdict: 'ask', because: 'It proposes; you decide.' }).db,
      {
        jobId: JOB,
        tool: 'notion.write',
        summary: 'Mirror the budget to Notion',
        detail: 'One page, "Budget".',
        empty: false,
        agent: 'operations-director',
      },
      (async (_db: unknown, draft: Record<string, unknown>) => {
        drafted = draft
        return 'b'
      }) as never,
    )
    const text = [
      drafted?.requestedAction,
      drafted?.whyNeeded,
      drafted?.consequencesOfDelay,
      ...((drafted?.approvalOptions as string[]) ?? []),
    ].join('\n')
    expect(text).not.toBe('')
    expect(text).not.toMatch(STEP_ID_SHAPE)
    expect(text).not.toMatch(ISSUE)
  })

  /*
    The writers that need a database to run are read instead. Every module that raises a question or requests an
    approval is scanned for the text it composes: the expressions after requestedAction / whyNeeded / consequencesOfDelay
    must not interpolate a step id, a capability, a compiled step name or `run.at`, and no sentence may name an issue.
  */
  const modules = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? modules(`${dir}/${e.name}`)
        : e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')
          ? [`${dir}/${e.name}`]
          : [],
    )
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const raisers = modules('src').filter((f) =>
    /raiseBlocker\(|request_approval\(|requestedAction:/.test(strip(readFileSync(f, 'utf8'))),
  )
  it('finds the question writers it is meant to scan (control: the list is not empty)', () => {
    expect(raisers.length).toBeGreaterThanOrEqual(6)
    expect(raisers).toContain('src/agents/perform.ts')
  })
  for (const file of raisers) {
    it(`${file}: no composed question interpolates a plan code or an issue number`, () => {
      const code = strip(readFileSync(file, 'utf8'))
      const fields = [...code.matchAll(/\b(requestedAction|whyNeeded|consequencesOfDelay):/g)].map(
        (m) =>
          code.slice(m.index ?? 0, (m.index ?? 0) + 700).split(/\n\s*\n|\n\s{0,14}[a-zA-Z]+:/)[0],
      )
      for (const field of fields) {
        expect(field).not.toMatch(/\$\{[^}]*(?:step\.id|\.capability|stepName\(|run\.at)/)
        expect(field).not.toMatch(ISSUE)
      }
    })
  }
})

describe('the handlers whose step names ARE plan codes say the pause through the composer', () => {
  /*
    The composers above are pure, so a handler that stopped calling them would leave every check green. What
    discriminates is the wired call: the handler's body is built FROM the composer's answer, and nothing in these two
    files interpolates the compiled step name or the tool-prefixed detail into a sentence.
  */
  const code = (f: string): string =>
    readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
  it('pursue.ts composes the question and the part-way stop from the composer', () => {
    const src = code('src/handlers/pursue.ts')
    expect(src).toMatch(/\?\s*`\$\{sofar\}\$\{stoppedToAsk\(run\.pause\)\}`/)
    expect(src).toMatch(/:\s*`\$\{sofar\}\$\{stoppedPartWay\(run\.pause\)\}`/)
  })
  for (const f of ['src/handlers/pursue.ts', 'src/handlers/plan.ts']) {
    it(`${f} never interpolates a compiled step name or the tool-prefixed detail`, () => {
      const src = code(f)
      expect(src).not.toMatch(/\$\{run\.at\}/)
      expect(src).not.toMatch(/\$\{run\.pause\.detail\}/)
    })
  }
  it('plan.ts says its pause through the composer', () => {
    expect(code('src/handlers/plan.ts')).toMatch(/done\(stoppedPartWay\(run\.pause\)/)
  })
})

describe('pause-words: the pure composers', () => {
  const paused = (why: unknown, detail = 'draft.create: because'): Paused => ({
    reason: 'awaiting_approval',
    detail,
    resumeWhen: 'Grant answers.',
    binds: { step: 's4:draft.create', why },
  })
  it('names the step by what it is for', () => {
    expect(stepInWords(paused('Prepare the note to the venue'))).toBe(
      'Prepare the note to the venue',
    )
  })
  it('never prints an id even when the description itself carries one (a model wrote it)', () => {
    expect(stepInWords(paused('s4:draft.create — prepare the note'))).toBe('the next step')
  })
  it('stands in plainly when there is no description', () => {
    expect(stepInWords(paused(''))).toBe('the next step')
    expect(stepInWords(paused(undefined))).toBe('the next step')
    expect(stepInWords(undefined)).toBe('the next step')
  })
  it('takes the tool code off the reason and leaves a reason that has none', () => {
    expect(reasonInWords(paused('x', 'draft.create: waits for your say-so.'))).toBe(
      'waits for your say-so.',
    )
    expect(reasonInWords(paused('x', 'Waits: for your say-so.'))).toBe('Waits: for your say-so.')
    expect(reasonInWords(paused('x', 'The note is due at 9:30 tomorrow.'))).toBe(
      'The note is due at 9:30 tomorrow.',
    )
  })
  it('the step-id shape: finds ids and tool codes, not clock times or prose', () => {
    for (const bad of ['s4:draft.create', 'r2:s1:task.create', '2:create_project'])
      expect(bad).toMatch(STEP_ID_SHAPE)
    for (const fine of ['at 9:30 tomorrow', 'Step 4: write it', 'ratio 3:2', 'meet at 5:pm'])
      expect(fine).not.toMatch(STEP_ID_SHAPE)
  })
})
