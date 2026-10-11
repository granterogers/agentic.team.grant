import { describe, expect, it } from 'vitest'
import {
  badRequest,
  claimAnswer,
  finishAnswer,
  heartbeatAnswer,
  MAX_BODY_BYTES,
  MIN_CLAIM_GAP_MS,
  parseClaim,
  parseFinish,
  parseHeartbeat,
  parseProposal,
  parseSkillsQuery,
  proposalAnswer,
  routeOf,
  skillsAnswer,
  Throttle,
  unhealthyAnswer,
  upstreamAnswer,
} from '../../supabase/functions/engine/routes.ts'

const RUN = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const HERMES = `run_${'a'.repeat(32)}`

describe('routeOf: exactly /engine/<route>, nothing near it', () => {
  it('names each route, with or without the functions prefix and a trailing slash', () => {
    expect(routeOf('/engine/claim')).toBe('claim')
    expect(routeOf('/functions/v1/engine/heartbeat')).toBe('heartbeat')
    expect(routeOf('/engine/finish/')).toBe('finish')
    expect(routeOf('/engine/health')).toBe('health')
    expect(routeOf('/engine/proposal')).toBe('proposal')
    expect(routeOf('/functions/v1/engine/skills')).toBe('skills')
  })
  it('refuses everything else', () => {
    for (const p of [
      '/',
      '/engine',
      '/engine/',
      '/engine/claims',
      '/engine/claim/extra',
      '/mcp/claim',
      '/engine/../claim',
      '/ENGINE/claim',
      '/engine/proposals',
      '/engine/skills/extra',
      '/engine/Skills',
    ])
      expect(routeOf(p), p).toBeNull()
  })
})

describe('parseClaim', () => {
  const ok = { bridge_version: '0.1.0', hermes_ok: true, toolsets_ok: true }
  it('accepts the preflight report', () => expect(parseClaim(ok)).toEqual({ ok: true, value: ok }))
  it('refuses each malformed field by name', () => {
    expect(parseClaim(null)).toEqual({ ok: false, field: 'body' })
    expect(parseClaim([])).toEqual({ ok: false, field: 'body' })
    expect(parseClaim({ ...ok, bridge_version: '' })).toEqual({
      ok: false,
      field: 'bridge_version',
    })
    expect(parseClaim({ ...ok, bridge_version: 'x'.repeat(41) })).toEqual({
      ok: false,
      field: 'bridge_version',
    })
    expect(parseClaim({ ...ok, hermes_ok: 'yes' })).toEqual({ ok: false, field: 'hermes_ok' })
    expect(parseClaim({ ...ok, toolsets_ok: 1 })).toEqual({ ok: false, field: 'toolsets_ok' })
    expect(parseClaim({ ...ok, office_id: RUN })).toEqual({ ok: false, field: 'office_id' })
  })
  it('refuses a body that tries to name an office, a bridge or a run', () => {
    for (const k of ['office_id', 'office', 'bridge_id', 'run_id', 'p_office'])
      expect(parseClaim({ ...ok, [k]: RUN }).ok, k).toBe(false)
  })
})

describe('parseHeartbeat', () => {
  const ok = {
    run_id: RUN,
    claim_gen: 1,
    hermes_run_id: HERMES,
    progress: { events: 3, tools: 1, last_event: 'tool.started' },
  }
  it('accepts a heartbeat, with or without the optional parts', () => {
    expect(parseHeartbeat(ok)).toEqual({
      ok: true,
      value: { run_id: RUN, claim_gen: 1, hermes_run_id: HERMES },
    })
    expect(parseHeartbeat({ run_id: RUN, claim_gen: 3 })).toEqual({
      ok: true,
      value: { run_id: RUN, claim_gen: 3, hermes_run_id: null },
    })
    expect(parseHeartbeat({ run_id: RUN, claim_gen: 2, hermes_run_id: null })).toMatchObject({
      ok: true,
    })
  })
  it('refuses each malformed field by name', () => {
    expect(parseHeartbeat({ ...ok, run_id: 'nope' })).toEqual({ ok: false, field: 'run_id' })
    expect(parseHeartbeat({ ...ok, run_id: RUN.toUpperCase() })).toEqual({
      ok: false,
      field: 'run_id',
    })
    for (const g of [0, 4, 1.5, -1, '1', null])
      expect(parseHeartbeat({ ...ok, claim_gen: g }), String(g)).toEqual({
        ok: false,
        field: 'claim_gen',
      })
    expect(parseHeartbeat({ ...ok, hermes_run_id: 'run_1' })).toEqual({
      ok: false,
      field: 'hermes_run_id',
    })
    expect(parseHeartbeat({ ...ok, hermes_run_id: 5 })).toEqual({
      ok: false,
      field: 'hermes_run_id',
    })
    expect(parseHeartbeat({ ...ok, progress: 'x' })).toEqual({ ok: false, field: 'progress' })
    expect(parseHeartbeat({ ...ok, progress: { events: -1, tools: 0, last_event: 'x' } })).toEqual({
      ok: false,
      field: 'progress',
    })
    expect(
      parseHeartbeat({ ...ok, progress: { events: 1, tools: 0, last_event: 'x'.repeat(61) } }),
    ).toEqual({ ok: false, field: 'progress' })
    expect(
      parseHeartbeat({
        ...ok,
        progress: { events: 1, tools: 0, last_event: 'x', content: 'hello' },
      }),
    ).toEqual({ ok: false, field: 'progress' })
    expect(parseHeartbeat({ ...ok, office_id: RUN })).toEqual({ ok: false, field: 'office_id' })
  })
})

describe('parseFinish', () => {
  const ok = {
    run_id: RUN,
    claim_gen: 2,
    outcome: 'completed',
    result: { answer: 'x', tools_started: 1, approvals_denied: 0 },
  }
  it('accepts each outcome', () => {
    for (const outcome of ['completed', 'failed', 'cancelled'])
      expect(parseFinish({ ...ok, outcome }), outcome).toMatchObject({ ok: true })
  })
  it('refuses each malformed field by name', () => {
    expect(parseFinish({ ...ok, outcome: 'success' })).toEqual({ ok: false, field: 'outcome' })
    expect(parseFinish({ ...ok, outcome: 'Completed' })).toEqual({ ok: false, field: 'outcome' })
    expect(parseFinish({ ...ok, result: 'text' })).toEqual({ ok: false, field: 'result' })
    expect(parseFinish({ ...ok, result: [1] })).toEqual({ ok: false, field: 'result' })
    expect(parseFinish({ ...ok, claim_gen: 9 })).toEqual({ ok: false, field: 'claim_gen' })
    expect(parseFinish({ ...ok, run_id: '1' })).toEqual({ ok: false, field: 'run_id' })
    expect(parseFinish({ ...ok, office_id: RUN })).toEqual({ ok: false, field: 'office_id' })
  })
})

describe('what the database said, mapped to what the bridge is told', () => {
  it('a claim: a run means poll_after_s 0, none means the idle poll, and a refusal is passed on', () => {
    expect(claimAnswer({ run: { run_id: RUN } })).toEqual({
      status: 200,
      body: { run: { run_id: RUN }, poll_after_s: 0 },
    })
    expect(claimAnswer({ run: null })).toEqual({
      status: 200,
      body: { run: null, poll_after_s: 15 },
    })
    expect(claimAnswer({ run: null, refused: 'this bridge is not enabled' }).body).toMatchObject({
      refused: 'this bridge is not enabled',
      poll_after_s: 15,
    })
    expect(claimAnswer(null).body).toEqual({ run: null, poll_after_s: 15 })
    expect(claimAnswer('garbage').body).toEqual({ run: null, poll_after_s: 15 })
  })
  it('an unhealthy preflight says which half failed, hands out nothing, and asks for a longer wait', () => {
    expect(
      unhealthyAnswer({ bridge_version: '1', hermes_ok: false, toolsets_ok: true }).body,
    ).toMatchObject({ run: null, poll_after_s: 60 })
    expect(
      String(
        unhealthyAnswer({ bridge_version: '1', hermes_ok: false, toolsets_ok: true }).body.refused,
      ),
    ).toContain('Hermes is not answering')
    expect(
      String(
        unhealthyAnswer({ bridge_version: '1', hermes_ok: true, toolsets_ok: false }).body.refused,
      ),
    ).toContain('toolset other than the office')
  })
  it('a heartbeat: a lost claim is a 409, anything else is 200 with the stop decision', () => {
    expect(heartbeatAnswer({ stop: true, because: 'not yours', lease_until: null })).toEqual({
      status: 409,
      body: { error: 'not_yours' },
    })
    expect(
      heartbeatAnswer({ stop: true, because: 'a person pressed Stop', lease_until: 'x' }),
    ).toEqual({
      status: 200,
      body: { stop: true, because: 'a person pressed Stop', lease_until: 'x' },
    })
    expect(heartbeatAnswer({ stop: false, because: null, lease_until: 't' }).body).toEqual({
      stop: false,
      because: null,
      lease_until: 't',
    })
  })
  it('a finish: ok, a lost claim, a run that is not running, a bad result, a bad outcome, anything else backs off', () => {
    expect(finishAnswer({ ok: true, resumed: true, state: 'completed' })).toEqual({
      status: 200,
      body: { ok: true, resumed: true, state: 'completed' },
    })
    expect(finishAnswer({ ok: false, error: 'not_yours' })).toEqual({
      status: 409,
      body: { error: 'not_yours' },
    })
    expect(finishAnswer({ ok: false, error: 'not_running' })).toEqual({
      status: 409,
      body: { error: 'not_running' },
    })
    expect(
      finishAnswer({
        ok: false,
        error: 'bad_result',
        because: 'a completed run needs a non-empty answer',
      }),
    ).toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        field: 'result',
        because: 'a completed run needs a non-empty answer',
      },
    })
    expect(finishAnswer({ ok: false, error: 'bad_outcome' })).toEqual(badRequest('outcome'))
    expect(finishAnswer({ ok: false, error: 'something new' }).status).toBe(503)
    expect(finishAnswer(null).status).toBe(503)
    expect(finishAnswer({ ok: 'true' }).status).toBe(503)
  })
  it('a database failure: an inactive office is 403, everything else (and a network error) is 503 with a retry hint', () => {
    expect(upstreamAnswer(403).status).toBe(403)
    expect(upstreamAnswer(403).body).toMatchObject({ error: 'disabled' })
    for (const s of [500, 502, 503, 404, 400, null]) {
      const a = upstreamAnswer(s)
      expect(a.status, String(s)).toBe(503)
      expect(a.retryAfterS).toBeGreaterThan(0)
    }
  })
})

describe('Throttle', () => {
  it('lets the first claim through and refuses a second inside the gap, naming the wait', () => {
    let now = 1_000_000
    const t = new Throttle(5000, () => now)
    expect(t.check('a')).toBeNull()
    now += 1000
    expect(t.check('a')).toBe(4)
    now += 3900
    expect(t.check('a')).toBe(1)
    now += 200
    expect(t.check('a')).toBeNull()
  })
  it('keeps bridges apart, and a refused claim does not extend the wait (the control: it cannot be starved)', () => {
    let now = 0
    const t = new Throttle(5000, () => now)
    expect(t.check('a')).toBeNull()
    expect(t.check('b')).toBeNull()
    now = 4900
    expect(t.check('a')).toBe(1)
    now = 5000
    expect(t.check('a')).toBeNull()
  })
  it('uses the contract gap by default', () => {
    expect(MIN_CLAIM_GAP_MS).toBe(5000)
    expect(MAX_BODY_BYTES).toBe(65_536)
  })
})

describe('parseProposal (M8b): five fields and nothing about where a skill applies', () => {
  const skill = {
    name: 'A name',
    when: 'When it comes up',
    procedure: 'Do the steps in order.',
    tools: ['db.read'],
    dropped: [] as string[],
  }
  const ok = { run_id: RUN, skill }
  it('accepts exactly a run and a skill of five fields', () => {
    expect(parseProposal(ok)).toEqual({ ok: true, value: ok })
  })
  it('refuses a key it does not know, at either level, naming it', () => {
    for (const k of ['office_id', 'project_id', 'scope', 'source', 'claim_gen'])
      expect(parseProposal({ ...ok, [k]: 'x' }), k).toEqual({ ok: false, field: k })
    for (const k of ['scope', 'project_id', 'run_id', 'from_job', 'source', 'staff'])
      expect(parseProposal({ ...ok, skill: { ...skill, [k]: 'x' } }), k).toEqual({
        ok: false,
        field: `skill.${k}`,
      })
  })
  it('refuses each malformed field by name', () => {
    expect(parseProposal(null)).toEqual({ ok: false, field: 'body' })
    expect(parseProposal({ ...ok, run_id: 'nope' })).toEqual({ ok: false, field: 'run_id' })
    expect(parseProposal({ run_id: RUN })).toEqual({ ok: false, field: 'skill' })
    expect(parseProposal({ ...ok, skill: { ...skill, name: 3 } })).toEqual({
      ok: false,
      field: 'skill.name',
    })
    expect(parseProposal({ ...ok, skill: { ...skill, procedure: 'x'.repeat(8001) } })).toEqual({
      ok: false,
      field: 'skill.procedure',
    })
    expect(parseProposal({ ...ok, skill: { ...skill, tools: 'db.read' } })).toEqual({
      ok: false,
      field: 'skill.tools',
    })
    expect(parseProposal({ ...ok, skill: { ...skill, tools: Array(6).fill('a') } })).toEqual({
      ok: false,
      field: 'skill.tools',
    })
    expect(parseProposal({ ...ok, skill: { ...skill, dropped: [1] } })).toEqual({
      ok: false,
      field: 'skill.dropped',
    })
    const { tools: _t, ...noTools } = skill
    expect(parseProposal({ ...ok, skill: noTools })).toEqual({ ok: false, field: 'skill.tools' })
  })
})

describe('parseSkillsQuery, proposalAnswer, skillsAnswer', () => {
  it('reads an optional run id and nothing else from the query', () => {
    expect(parseSkillsQuery('')).toEqual({ ok: true, value: { run_id: null } })
    expect(parseSkillsQuery(`?run_id=${RUN}`)).toEqual({ ok: true, value: { run_id: RUN } })
    expect(parseSkillsQuery('?run_id=x')).toEqual({ ok: false, field: 'run_id' })
    expect(parseSkillsQuery(`?run_id=${RUN}&office_id=1`)).toEqual({
      ok: false,
      field: 'office_id',
    })
  })
  it('a refusal of a proposal is an answer (200, ok false), a stored one carries its id, anything else is a back-off', () => {
    expect(proposalAnswer({ suggestion_id: RUN })).toEqual({
      status: 200,
      body: { ok: true, suggestion_id: RUN },
    })
    expect(proposalAnswer({ refused: 'already waiting' })).toEqual({
      status: 200,
      body: { ok: false, refused: 'already waiting' },
    })
    expect(proposalAnswer(null).status).toBe(503)
    expect(proposalAnswer({ error: 'x' }).status).toBe(503)
  })
  it('the skills answer keeps four text fields of each skill and drops everything else', () => {
    const a = skillsAnswer({
      skills: [
        { slug: 's', name: 'n', when_to_use: 'w', procedure: 'p', office_id: 'LEAK' },
        'junk',
      ],
      generated_at: 't',
    })
    expect(a.status).toBe(200)
    expect(a.body).toEqual({
      skills: [{ slug: 's', name: 'n', when_to_use: 'w', procedure: 'p' }],
      generated_at: 't',
    })
    expect(skillsAnswer({}).status).toBe(503)
  })
})
