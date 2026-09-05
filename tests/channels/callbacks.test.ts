/**
 * Acting on a press, against a scripted executor.
 *
 * The live behaviour is proven by `npm run verify:slack`, which presses real
 * buttons at the deployed endpoint. What is worth pinning here is the set of
 * decisions the processor makes — because each of them is a place where the
 * obvious implementation does something subtly wrong:
 *
 *   - a mute recorded as engagement teaches learning that the notification
 *     worked;
 *   - `more_detail` acted on would be a second, unaudited way to create work;
 *   - a stale Undo that returns success is worse than one that says it is stale.
 */
import { describe, expect, it } from 'vitest'
import { processCallbacks } from '../../src/channels/callbacks.ts'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'

const COMMAND = 'aaaaaaaa-0000-0000-0000-000000000001'
const CORRELATION = 'bbbbbbbb-0000-0000-0000-000000000002'
const OUTPUT = 'cccccccc-0000-0000-0000-000000000003'
const OFFER = 'dddddddd-0000-0000-0000-000000000004'

interface Options {
  readonly action: string
  readonly correlationId?: string | null
  readonly outputId?: string | null
  readonly offers?: Record<string, unknown>[]
  readonly claimSucceeds?: boolean
}

class Scripted implements SqlExecutor {
  readonly kind = 'scripted'
  readonly statements: string[] = []
  constructor(private readonly options: Options) {}

  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)
    if (sql.includes('from public.inbound_commands c')) {
      return {
        rows: [
          {
            command_id: COMMAND,
            callback_action: this.options.action,
            origin_channel: 'slack',
            origin_ref: 'C1:1.2',
            actor: 'U0GRANT',
            correlation_id:
              this.options.correlationId === undefined ? CORRELATION : this.options.correlationId,
            project_id: null,
            output_id: this.options.outputId === undefined ? OUTPUT : this.options.outputId,
          },
        ],
      }
    }
    if (sql.includes('update public.inbound_commands')) {
      return { rows: this.options.claimSucceeds === false ? [] : [{ id: COMMAND }] }
    }
    if (sql.includes('from public.undo_offers')) {
      return { rows: this.options.offers ?? [] }
    }
    if (sql.includes('app.request_undo')) return { rows: [{ status: 'undone' }] }
    if (sql.includes('preference_instructions')) {
      return { rows: [{ instruction_id: 'eeeeeeee-0000-0000-0000-000000000005' }] }
    }
    return { rows: [] }
  }

  wrote(fragment: string): boolean {
    return this.statements.some((s) => s.includes(fragment))
  }
}

describe('feedback', () => {
  it('records a 👍 against the output it was about', async () => {
    const db = new Scripted({ action: 'useful' })
    const [done] = await processCallbacks(db)
    expect(done?.outcome).toBe('acted')
    expect(db.wrote('insert into public.feedback')).toBe(true)
    expect(db.wrote(`'output'`)).toBe(true)
    // The button says "useful"; the stored signal says "positive". Two
    // vocabularies, mapped rather than shared, so renaming a button label does
    // not rewrite what past feedback meant.
    expect(db.wrote(`'positive'`)).toBe(true)
  })

  it('records a press with no delivery record as feedback about a NOTIFICATION, not an output', async () => {
    // Attaching it to a guessed output would be worse than attaching it to
    // nothing; discarding it would throw away "Grant pressed this".
    const db = new Scripted({ action: 'not_useful', correlationId: null, outputId: null })
    const [done] = await processCallbacks(db)
    expect(done?.outcome).toBe('acted')
    expect(db.wrote(`'notification'`)).toBe(true)
    expect(String(done?.note)).toContain('no output')
  })

  it('moves the notification past `delivered`, which is what learning reads', async () => {
    const db = new Scripted({ action: 'useful' })
    await processCallbacks(db)
    expect(db.wrote("set outcome = 'acted'")).toBe(true)
    expect(db.wrote('resolved_at = app.now_utc()')).toBe(true)
  })
})

describe('undo', () => {
  it('acts through app.request_undo when there is a live offer', async () => {
    const db = new Scripted({
      action: 'undo',
      offers: [{ id: OFFER, description: 'A Slack post that can be retracted.' }],
    })
    const [done] = await processCallbacks(db)
    expect(done?.outcome).toBe('acted')
    expect(db.wrote('app.request_undo')).toBe(true)
  })

  it('says so when the offer has lapsed, rather than reporting success', async () => {
    const db = new Scripted({ action: 'undo', offers: [] })
    const [done] = await processCallbacks(db)
    expect(done?.outcome).toBe('nothing_to_undo')
    expect(db.wrote('app.request_undo')).toBe(false)
  })

  it('does not guess at a subject when the message has no delivery record', async () => {
    const db = new Scripted({ action: 'undo', correlationId: null })
    const [done] = await processCallbacks(db)
    expect(done?.outcome).toBe('unresolvable')
    expect(db.wrote('app.request_undo')).toBe(false)
  })
})

describe('the presses that are not requests', () => {
  it('records a mute as DISMISSED, not as engagement', async () => {
    const db = new Scripted({ action: 'mute_24h' })
    await processCallbacks(db)
    expect(db.wrote("set outcome = 'dismissed'")).toBe(true)
    expect(db.wrote("set outcome = 'acted'")).toBe(false)
  })

  it('applies a mute through the same parse a typed instruction uses', async () => {
    const db = new Scripted({ action: 'mute_24h' })
    await processCallbacks(db)
    // One implementation of what a mute means, one audit trail.
    expect(db.wrote('preference_instructions')).toBe(true)
  })

  it('records `more_detail` and refuses to create work from it', async () => {
    const db = new Scripted({ action: 'more_detail' })
    const [done] = await processCallbacks(db)
    expect(done?.outcome).toBe('not_routed')
    expect(db.wrote('insert into public.jobs')).toBe(false)
  })

  it('marks `more_detail` processed anyway, because an unprocessable row left pending is a loop', async () => {
    const db = new Scripted({ action: 'more_detail' })
    await processCallbacks(db)
    expect(db.wrote('set processed_at')).toBe(true)
  })

  it('treats opening a project as a signal', async () => {
    const db = new Scripted({ action: 'open_project' })
    const [done] = await processCallbacks(db)
    expect(done?.outcome).toBe('noted')
  })
})

describe('claiming', () => {
  it('does nothing when another processor got there first', async () => {
    const db = new Scripted({ action: 'useful', claimSucceeds: false })
    expect(await processCallbacks(db)).toEqual([])
    expect(db.wrote('insert into public.feedback')).toBe(false)
  })

  it('claims with an UPDATE guarded on processed_at, not a read then a write', async () => {
    const db = new Scripted({ action: 'useful' })
    await processCallbacks(db)
    const claim = db.statements.find((s) => s.includes('update public.inbound_commands'))
    expect(claim).toContain('processed_at is null')
  })
})
