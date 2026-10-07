/**
 * #26 — one agent, selected agents, or the whole team.
 *
 * Two of the three already worked. Addressing one person has worked since
 * `inbound_commands.addressed_to` existed, and naming NOBODY is "ask the
 * entire team": the roster reads the subject and convenes whoever the
 * expertise columns say knows about it, which is also why asking the whole
 * team does not produce eight near-identical replies.
 *
 * The middle one — Grant picking two or three himself — is what 0410, 0411
 * and this path add, and it joins the SAME `alsoConvened` mechanism a routed
 * roster uses rather than a second one. These tests are about that join.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { speaker } from '../../src/handlers/instruction.ts'

/** The roster, as `speaker` reads it: one row per active slug it is asked for. */
const roster: Record<string, Record<string, unknown>> = {
  'chief-of-staff': {
    slug: 'chief-of-staff',
    name: 'Claire',
    title: 'Chief of Staff',
    communication_style: 'brisk',
    responsibilities: 'runs the office',
  },
  'finance-director': {
    slug: 'finance-director',
    name: 'Daniel',
    title: 'Finance & Data',
    communication_style: 'precise',
    responsibilities: 'the numbers',
  },
}

const db: SqlExecutor = {
  kind: 'fake',
  execute: (sql: string): Promise<SqlResult> => {
    const hit = Object.keys(roster).find((slug) => sql.includes(`'${slug}'`))
    return Promise.resolve({
      rows: hit === undefined ? [] : [roster[hit] as Record<string, unknown>],
    })
  },
}

describe('#26 — a selection Grant made himself', () => {
  it('one person, and nobody else — unchanged', async () => {
    // A specialist whose bot he opened. (This case was written with the chief as the person; the chief is the router
    // and is no longer a "direct" address on her own: see agents/addressing.ts and the next test.)
    const who = await speaker(db, 'finance-director', 'what is open?', null, null, [])
    expect(who.slug).toBe('finance-director')
    expect(who.alsoConvened).toEqual([])
    expect(who.convened).toEqual(['finance-director'])
    expect(who.reason).toContain('addressed directly')
  })

  it('the chief alone is NOT a direct address: she routes, so the roster is consulted', async () => {
    const asked: string[] = []
    const spy: SqlExecutor = {
      kind: 'fake',
      execute: (sql: string): Promise<SqlResult> => {
        asked.push(sql)
        return db.execute(sql)
      },
    }
    const who = await speaker(spy, 'chief-of-staff', 'what is open?', null, null, [])
    expect(who.reason).not.toContain('addressed directly')
    expect(asked.some((s) => s.includes('who_knows_about') || s.includes('public.staff where active'))).toBe(true)
  })

  it('one answers and the rest are convened, each in their own name', async () => {
    const who = await speaker(db, 'chief-of-staff', 'what is open?', null, null, [
      'finance-director',
      'research-director',
    ])
    expect(who.slug).toBe('chief-of-staff')
    expect(who.alsoConvened).toEqual(['finance-director', 'research-director'])
    // Addressing somebody IS convening them, so the answerer is in this list.
    expect(who.convened).toEqual(['chief-of-staff', 'finance-director', 'research-director'])
  })

  it('and the reason says he chose them, rather than claiming a bot was opened', async () => {
    const who = await speaker(db, 'chief-of-staff', 'x', null, null, ['finance-director'])
    // The reason is recorded on the routing decision and read by `measure`, so
    // "Grant opened this person's bot" would be false about a selection made
    // in the composer.
    expect(who.reason).toContain('picked')
    expect(who.reason).not.toContain('bot')
  })

  it('the answerer is never also convened as a companion', async () => {
    const who = await speaker(db, 'chief-of-staff', 'x', null, null, [
      'chief-of-staff',
      'finance-director',
    ])
    expect(who.alsoConvened).toEqual(['finance-director'])
  })

  it('an empty string in the selection is not a person', async () => {
    const who = await speaker(db, 'chief-of-staff', 'x', null, null, ['', 'finance-director'])
    expect(who.alsoConvened).toEqual(['finance-director'])
  })

  /*
    The one that matters most, and the reason the child jobs carry an
    addressee and no selection: the chain has to terminate at one by
    construction rather than by the depth cap.
  */
  it('a child job — an addressee and no selection — convenes nobody further', async () => {
    const who = await speaker(db, 'finance-director', 'the same question again', null, null, [])
    expect(who.slug).toBe('finance-director')
    expect(who.alsoConvened).toEqual([])
  })
})
