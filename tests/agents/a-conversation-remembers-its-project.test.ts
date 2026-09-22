/**
 * #308 — a conversation remembers which project it is about.
 *
 * ## Why this reads a migration
 *
 * The behaviour is entirely in `app.enqueue_inbound`, because §5 says an
 * adapter may only translate and this is the canonical layer — so every
 * surface gets the continuity at once rather than three adapters getting it
 * three ways. It is proved against the real database by
 * `npm run verify:context`, 17 checks including inheritance over four turns,
 * explicit switching and back, isolation between conversations, and both
 * directions of containment.
 *
 * What a unit test can hold is the two properties that decide whether
 * inheriting context is trustworthy at all, and both are visible in the SQL:
 *
 *   1. **only an explicit resolution is remembered.** An asset's project, a
 *      project the surface named and a Slack channel's mapping are
 *      resolutions. Unnamed and most-recently-updated are guesses, and a
 *      guess written into a conversation's memory locks the whole exchange
 *      onto something nobody said — worse than guessing once, because it
 *      compounds.
 *   2. **the conversation is consulted BELOW anything the message says and
 *      ABOVE both guesses.** That ordering is the invariant: what he says now
 *      wins, and what the conversation is about beats a fallback.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('migrations/0547_a_conversation_remembers_its_project.sql', 'utf8')
/** The function body, without the file's own explanatory header. */
const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'))

describe('only an explicit resolution becomes the conversation', () => {
  it('refuses to remember the reserved unnamed project', () => {
    /*
      Unnamed is the ABSENCE of a project, not a project. A conversation that
      remembered it could never resolve to anything else.
    */
    expect(fn).toContain('v_project is distinct from app.unnamed_project()')
  })

  it('records only where a scope and a conversation are both known', () => {
    expect(fn).toMatch(/v_scope is not null[\s\S]{0,60}v_talk is not null/)
  })

  it('writes at most one row per project per conversation', () => {
    /*
      Compared against what the scope already says, so an exchange that stays
      on one project writes one switch rather than one per turn — otherwise
      the table grows by the length of every conversation.
    */
    expect(fn).toContain('v_project is distinct from app.current_project(v_scope, v_talk)')
  })
})

describe('and it is consulted in the right place', () => {
  const at = (needle: string): number => fn.indexOf(needle)

  it('below the Slack channel mapping, which is something the message says', () => {
    expect(at('slack_channel_map')).toBeLessThan(at('v_project := app.current_project'))
  })

  it('above the Unnamed fallback', () => {
    expect(at('v_project := app.current_project')).toBeLessThan(
      at('routing.unnamed_when_unresolved'),
    )
  })

  it('and above the most-recently-updated guess', () => {
    expect(at('v_project := app.current_project')).toBeLessThan(at("status = 'active'"))
  })
})

describe('the conversation is the exchange, not the person', () => {
  it('is keyed on the first segment of the origin ref', () => {
    /*
      `1386648496:325` is a chat and a message; `C0BVD21Q9S5:1790016258.057200`
      is a channel and a timestamp. Keying on the whole ref would make every
      message its own conversation and inherit nothing; keying on the actor
      would make every chat with one person a single conversation.
    */
    expect(fn).toContain("split_part(coalesce(c.origin_ref, ''), ':', 1)")
  })

  it('maps each channel to its own scope kind', () => {
    for (const [channel, scope] of [
      ['telegram', 'telegram_chat'],
      ['slack', 'slack_channel'],
      ['voice', 'voice'],
      ['teamhq', 'dashboard'],
    ]) {
      expect(fn).toMatch(new RegExp(`when '${channel}'\\s+then '${scope}'`))
    }
  })
})
