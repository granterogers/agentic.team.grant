import { describe, expect, it } from 'vitest'
import { metadataProblems } from '../../src/agents/quality.ts'
import {
  cancelledSentence,
  expiredSentence,
  failedSentence,
  failureInWords,
  hermesOutput,
  type OutputContext,
  saying,
  unavailableSentence,
} from '../../src/engines/hermes/result.ts'
import { ENGINE_READ_TOOLS } from '../../src/engines/hermes/timing.ts'
import type { EngineRunRow } from '../../src/engines/hermes/types.ts'

const run = (answer: string | undefined, model?: string): EngineRunRow => ({
  run_id: '33333333-3333-4333-8333-333333333333',
  state: 'completed',
  engine: 'hermes',
  deadline_at: '2026-10-11T12:00:00Z',
  failure: null,
  result: {
    ...(answer === undefined ? {} : { answer }),
    ...(model === undefined ? {} : { model }),
    tools_started: 2,
    approvals_denied: 0,
  },
})

const ctx: OutputContext = {
  asked: 'What is due on Harvest Lane?',
  saidBefore: ['I run Harvest Lane'],
  answeredBefore: ['An earlier office answer that mentions £999.'],
  grounding: {
    excerpts: ['Task: order seed (due 14 Oct)'],
    domains: ['tasks', 'projects'],
    complete_domains: ['projects'],
    tools: ['list_tasks', 'list_projects', 'list_tasks'],
  },
  openProjects: 3,
  standingRules: ['Give the conclusion first.'],
}

describe('hermesOutput', () => {
  it('is an untrusted inference: inferred evidence, medium confidence, no contradictions, nothing acted', () => {
    const o = hermesOutput(run('Order seed by the 14th.'), ctx)
    expect(o).not.toBeNull()
    expect(o?.evidence).toBe('inferred')
    expect(o?.confidence).toBe('medium')
    expect(o?.contradictions).toBeNull()
    expect(o?.acted).toBe(0)
    expect(o?.tasksChanged).toBe(0)
    expect(o?.body).toBe('Order seed by the 14th.')
  })
  it('an empty or blank answer is no output at all (the caller treats it as a failure)', () => {
    expect(hermesOutput(run(undefined), ctx)).toBeNull()
    expect(hermesOutput(run('   \n'), ctx)).toBeNull()
  })
  it('cites one source per distinct served tool, in the scheme:ref shape, and nothing else', () => {
    const o = hermesOutput(run('x'), ctx)
    expect(o?.sources).toEqual(['hermes:list_projects', 'hermes:list_tasks'])
    expect(
      hermesOutput(run('x'), { ...ctx, grounding: { ...ctx.grounding, tools: [] } })?.sources,
    ).toEqual([])
  })
  it('names the served model, or hermes-agent when none was reported', () => {
    expect(hermesOutput(run('x', 'vendor/model:free'), ctx)?.model).toBe('vendor/model:free')
    expect(hermesOutput(run('x'), ctx)?.model).toBe('hermes-agent')
  })
  it('grounds on what was asked, what the person said, and what the tools served: never on the office’s own earlier prose', () => {
    const g = hermesOutput(run('x'), ctx)?.grounding ?? ''
    expect(g).toContain('What is due on Harvest Lane?')
    expect(g).toContain('I run Harvest Lane')
    expect(g).toContain('order seed (due 14 Oct)')
    expect(g).not.toContain('£999')
  })
  it('consulted and complete domains are exactly what the tools served', () => {
    const o = hermesOutput(run('x'), ctx)
    expect(o?.consulted).toEqual({ consulted: ['projects', 'tasks'], complete: ['projects'] })
    const none = hermesOutput(run('x'), {
      ...ctx,
      grounding: { excerpts: [], domains: [], complete_domains: [], tools: [] },
    })
    expect(none?.consulted).toEqual({ consulted: [], complete: [] })
  })
  it('ignores a domain it does not know instead of passing it on', () => {
    const o = hermesOutput(run('x'), {
      ...ctx,
      grounding: { ...ctx.grounding, domains: ['tasks', 'secrets'], complete_domains: ['secrets'] },
    })
    expect(o?.consulted).toEqual({ consulted: ['tasks'], complete: [] })
  })
  it('declares the project census only when the run was actually shown the project list', () => {
    expect(hermesOutput(run('x'), ctx)?.holds).toEqual({ projects: 3 })
    expect(
      hermesOutput(run('x'), { ...ctx, grounding: { ...ctx.grounding, complete_domains: [] } })
        ?.holds,
    ).toEqual({})
  })
  it('hands the gate the office tool names (bare and prefixed) and the standing rules as written', () => {
    const o = hermesOutput(run('x'), ctx)
    for (const t of ENGINE_READ_TOOLS) {
      expect(o?.toolNames).toContain(t)
      expect(o?.toolNames).toContain(`mcp__office__${t}`)
    }
    expect(o?.standingRules).toEqual(['Give the conclusion first.'])
  })
})

describe('the sentences Hermes owes', () => {
  it('the unavailable sentence names the reason, says nothing else was done, and offers the team without doing it', () => {
    const s = unavailableSentence("Hermes's host hasn't checked in for 7 minutes.")
    expect(s).toContain("Hermes's host hasn't checked in for 7 minutes")
    expect(s).toMatch(/Nothing else was done/)
    expect(s).toMatch(/without Hermes selected/)
    expect(s).not.toMatch(/\.\./)
  })
  it('a failure is described in plain words and the raw text from outside is never repeated', () => {
    const secret = 'Authorization: Bearer abc123 from the provider'
    expect(failedSentence(secret)).not.toContain('abc123')
    expect(failureInWords('bridge_lost')).toMatch(/stopped answering/)
    expect(failureInWords('provider 429 rate limit')).toMatch(/busy/)
    expect(failureInWords('no_progress')).toMatch(/progress/)
    expect(failureInWords('containment: web_search')).toMatch(/does not allow/)
    expect(failureInWords('deadline')).toMatch(/ran out of time/)
    expect(failedSentence(null)).toMatch(/Nothing was changed/)
  })
  it('cancelled and expired say what happened and that nothing was changed or shown', () => {
    expect(cancelledSentence()).toMatch(/no answer to show/)
    expect(expiredSentence(15)).toMatch(/longer than 15 minutes/)
    expect(expiredSentence(15)).toMatch(/Nothing was changed/)
  })
  it('a composed sentence is verified, high, model-free and cites the job it is about (verified with no source is refused by the output gate)', () => {
    const s = saying('x', 'job-1')
    expect(s).toMatchObject({
      evidence: 'verified',
      confidence: 'high',
      model: null,
      sources: ['job:job-1'],
    })
    expect(
      metadataProblems({
        evidence: s.evidence,
        confidence: s.confidence,
        sources: s.sources,
        contradictions: s.contradictions,
      }),
    ).toEqual([])
    // the control: the same sentence with no source is exactly what the gate refuses
    expect(
      metadataProblems({
        evidence: 'verified',
        confidence: 'high',
        sources: [],
        contradictions: null,
      }).length,
    ).toBeGreaterThan(0)
    expect('announce' in s).toBe(false)
    expect(saying('x', 'job-1', false).announce).toBe(false)
  })
})
