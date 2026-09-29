/**
 * Acting on a button press.
 *
 * The adapters normalize a press into an `inbound_commands` row carrying one of
 * §12's six actions. Nothing consumed those rows. This is the consumer, and it
 * is channel-agnostic on purpose: Slack buttons, Slack reactions and Telegram
 * buttons all produce the same six words (`useful`, `not_useful`, `undo`,
 * `open_project`, `mute_24h`, `more_detail`), and a per-channel handler would
 * be three implementations of one intention that then diverge.
 *
 * Two things it fixes that were each half a mechanism:
 *
 * - **`notification_events` had no writer past `delivered`.** 0031's learning
 *   weighs what happened to a notification, and until now the only rows that
 *   ever moved past `delivered` were written by that suite's own fixtures. A
 *   learning input nothing produces is a learning input that is always the same
 *   shape.
 * - **`inbound_commands.callback_action` had no reader.** The column has been
 *   constrained to exactly these six values since 0011 and nothing had ever
 *   looked at one.
 *
 * ## What it deliberately does NOT do
 *
 * `more_detail` is recorded and not acted on. Acting on it means creating work,
 * and creating work is the router's job (§5: adapters may only translate; §9:
 * the Chief of Staff decides who is needed). A processor that quietly enqueued
 * a job would be a second, unaudited entry point into the work system. It is
 * marked processed with a note saying so rather than left to be retried
 * forever — an unprocessable row that stays unprocessed is a loop.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { TelegramClient } from '../telegram/api.ts'
import { TelegramTransport } from '../telegram/transport.ts'
import { DeliveryService } from './delivery.ts'
import { applyPreference } from './preference-store.ts'
import { parseInstruction } from './preferences.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type CallbackAction =
  | 'useful'
  | 'not_useful'
  | 'undo'
  | 'open_project'
  | 'mute_24h'
  | 'more_detail'
  | 'approve'
  | 'decline'

export interface ProcessedCallback {
  readonly commandId: string
  readonly action: string
  /** What was done. `noted` means recorded as a signal and nothing else. */
  readonly outcome: 'acted' | 'noted' | 'nothing_to_undo' | 'not_routed' | 'unresolvable'
  readonly note: string
}

interface PendingRow {
  command_id: string
  callback_action: string
  origin_channel: string
  origin_ref: string
  actor: string
  /** From `slack_deliveries`, resolved by the message the button is on. */
  correlation_id: string | null
  project_id: string | null
  output_id: string | null
  /** The job the pressed message came from, for 0083's approval lookup. */
  job_id: string | null
}

/**
 * Everything a press needs, resolved from OUR record of the message.
 *
 * The correlation comes from `slack_deliveries` — which recorded `message_ts`
 * and `correlation_id` together when the message was posted — rather than from
 * the button's own value, which round-trips through a client and is visible to
 * anyone who can inspect the message.
 *
 * A null correlation is a real answer: a press on a message whose delivery row
 * has been purged is a signal with no subject. It is recorded as feedback with
 * no reference rather than discarded, because "Grant pressed 👎 on something"
 * is still information, and rather than guessed at, because attaching it to the
 * wrong output would be worse than attaching it to nothing.
 */
const PENDING = (limit: number): string => `
  with press as (
    select c.command_id, c.callback_action, c.origin_channel, c.origin_ref, c.actor
    from public.inbound_commands c
    where c.callback_action is not null
      and c.processed_at is null
    order by c.received_at
    limit ${String(limit)}
  )
  select
    press.command_id::text        as command_id,
    press.callback_action         as callback_action,
    press.origin_channel          as origin_channel,
    press.origin_ref              as origin_ref,
    press.actor                   as actor,
    d.correlation_id::text        as correlation_id,
    j.project_id::text            as project_id,
    j.job_id::text                as job_id,
    o.output_id::text             as output_id
  from press
  -- One join for every channel, which is the practical reason 0039
  -- generalised the table. origin_ref is target:message on both Slack and
  -- Telegram, because both adapters were written to the same envelope.
  left join public.deliveries d
    on d.channel = press.origin_channel
   and d.target_ref = split_part(press.origin_ref, ':', 1)
   and d.message_ref = split_part(press.origin_ref, ':', 2)
  left join public.jobs j on j.job_id = d.job_id
  left join lateral (
    -- Through the delivery's JOB, not through its correlation. A correlation
    -- spans every job an instruction spawned, so resolving that way attributes
    -- a 👍 to whichever job finished last (0037). Silently, and with a real
    -- signal, which is the worst combination.
    select o.output_id from public.outputs o
    where o.job_id = d.job_id
    order by o.created_at desc limit 1
  ) o on true
`

/**
 * Claim one press.
 *
 * The UPDATE is the lock: `processed_at is null` in the WHERE means a
 * concurrent second processor changes no rows and gets nothing back. Every
 * duplicate this will meet — a webhook retry that beat the dedupe, two workers,
 * a re-run — arrives while the first is still in flight, so a read-then-write
 * would let both act.
 */
const claim = async (db: SqlExecutor, commandId: string): Promise<boolean> => {
  const { rows } = await db.execute(`
    update public.inbound_commands
       set processed_at = app.now_utc()
     where command_id = ${lit(commandId)}::uuid
       and processed_at is null
    returning command_id::text as id
  `)
  return rows.length === 1
}

/**
 * The button vocabulary and the feedback vocabulary are different, on purpose.
 *
 * §12's buttons say `useful` / `not useful`; 0031's `feedback_signal` says
 * `positive` / `negative` / `correction`. Mapping rather than sharing an enum
 * keeps a UI label and a stored signal free to change independently — a button
 * renamed tomorrow must not rewrite what past feedback meant.
 */
const FEEDBACK_SIGNAL: Readonly<Record<string, string>> = {
  useful: 'positive',
  not_useful: 'negative',
}

/**
 * Ask what should have happened instead.
 *
 * Issue #59. Sent on the channel the press came from and nowhere else — a
 * correction asked for on Slack because the button was pressed on Telegram is
 * a question in a room he is not looking at.
 *
 * Deliberately not a model call. It is one sentence, it is the same sentence
 * every time by design, and putting a free model between Grant and a fixed
 * question is how it starts varying in ways nobody asked for.
 *
 * Never throws. This is the follow-up to an acknowledgement that already
 * happened; failing it must not un-record the feedback.
 */
const askForTheCorrection = async (db: SqlExecutor, row: PendingRow): Promise<void> => {
  if (row.origin_channel !== 'telegram') return
  const [chatId, messageId] = String(row.origin_ref).split(':')
  if (chatId === undefined || chatId === '') return

  const { rows } = await db.execute(`
    select app.callback_ack(b.bot_id, 'not_useful') as ack, b.bot_id::text as bot_id
      from public.telegram_chats c
      join public.telegram_bots b on b.bot_id = c.bot_id and b.enabled
     where c.chat_id = ${lit(chatId)}
     limit 1
  `)
  const found = rows[0] as { ack?: { token?: string }; bot_id?: string } | undefined
  const token = found?.ack?.token
  if (typeof token !== 'string' || token === '') return

  /*
    Through the delivery layer, carrying the job of the message he pressed
    (#378). This was a bare sendMessage to whatever chat the press row named,
    so anything that could write a press row could make the office speak there
    with nothing deciding and nothing recorded. The job is the provenance: a
    press on a harness job's message is contained like the message itself was,
    and a press whose message we cannot trace has no job, which the guard
    refuses rather than guesses about.
  */
  await new DeliveryService(db, new TelegramTransport(new TelegramClient(token))).deliver({
    dedupeKey: `correction:${row.command_id}`,
    accountRef: String(found?.bot_id ?? ''),
    targetRef: chatId,
    // Threaded under the message he marked, so a correction typed twenty
    // minutes later still says which answer it is about.
    threadRef: messageId !== undefined && /^\d+$/.test(messageId) ? messageId : null,
    purpose: 'ack',
    correlationId: row.correlation_id,
    jobId: row.job_id,
    staffId: null,
    body: {
      text:
        'What should I have done instead? Tell me in a sentence and I will ' +
        'take it as an instruction, not just a note.',
      silent: true,
    },
  })
}

const recordFeedback = async (
  db: SqlExecutor,
  row: PendingRow,
  signal: 'useful' | 'not_useful',
): Promise<void> => {
  await db.execute(`
    insert into public.feedback
      (subject_kind, subject_ref, signal, origin_channel, given_by)
    values (
      ${row.output_id === null ? `'notification'` : `'output'`},
      ${row.output_id === null ? 'null' : `${lit(row.output_id)}::uuid`},
      ${lit(String(FEEDBACK_SIGNAL[signal]))}::public.feedback_signal,
      ${lit(row.origin_channel)}, ${lit(row.actor)}
    )
  `)
}

/**
 * Move the notification this press was about past `delivered`.
 *
 * `acted` for anything that shows engagement; `dismissed` for a mute, which is
 * the one press that means "stop telling me". The distinction matters because
 * 0031's learning weighs them differently — and because a mute recorded as
 * engagement would teach the system that the notification worked.
 */
const resolveNotification = async (
  db: SqlExecutor,
  row: PendingRow,
  outcome: 'acted' | 'dismissed',
): Promise<void> => {
  if (row.output_id === null) return
  await db.execute(`
    update public.notification_events
       set outcome = ${lit(outcome)}::public.notification_outcome,
           resolved_at = app.now_utc()
     where subject_ref = ${lit(row.output_id)}::uuid
       and outcome = 'delivered'
  `)
}

const doUndo = async (db: SqlExecutor, row: PendingRow): Promise<ProcessedCallback> => {
  if (row.correlation_id === null) {
    return {
      commandId: row.command_id,
      action: 'undo',
      outcome: 'unresolvable',
      note: 'the message this button is on has no delivery record; nothing identified to undo',
    }
  }

  const offers = await db.execute(`
    select action_id::text as id, description from public.undo_offers
    where correlation_id = ${lit(row.correlation_id)}::uuid
    order by undo_deadline
  `)
  const offer = offers.rows[0] as { id?: string; description?: string } | undefined
  if (offer?.id === undefined) {
    // §21's stale-Undo case, and it is expected rather than exceptional: the
    // offer can lapse between the message being posted and the button being
    // pressed, and the message cannot un-draw its own button. Saying "there is
    // nothing left to undo" is the honest answer; silently succeeding is not.
    return {
      commandId: row.command_id,
      action: 'undo',
      outcome: 'nothing_to_undo',
      note: 'the undo offer has expired or was already taken',
    }
  }

  const { rows } = await db.execute(`
    select app.request_undo(${lit(offer.id)}::uuid, ${lit(row.actor)},
      ${lit(`${row.origin_channel}:button`)})::text as status
  `)
  return {
    commandId: row.command_id,
    action: 'undo',
    outcome: 'acted',
    note: `undo ${String((rows[0] as { status?: string } | undefined)?.status)}: ${String(offer.description).slice(0, 80)}`,
  }
}

export interface ProcessOptions {
  readonly limit?: number
  readonly subject?: string
}

/**
 * Process pending presses.
 *
 * Returns what it did to each, rather than a count: a run in which four presses
 * were `unresolvable` and one `acted` is not the same as five acted, and a
 * count cannot tell them apart.
 */
export const processCallbacks = async (
  db: SqlExecutor,
  options: ProcessOptions = {},
): Promise<readonly ProcessedCallback[]> => {
  const { rows } = await db.execute(PENDING(options.limit ?? 25))
  const done: ProcessedCallback[] = []

  for (const raw of rows) {
    const row = raw as unknown as PendingRow
    if (!(await claim(db, row.command_id))) continue // someone else has it

    const action = row.callback_action as CallbackAction
    switch (action) {
      case 'useful':
      case 'not_useful': {
        await recordFeedback(db, row, action)
        await resolveNotification(db, row, 'acted')

        /*
          A thumbs-down that only records displeasure is half a feature.

          Grant asked for the buttons as *"a means to confirm or to quickly
          confirm something or to correct something"* — and correcting was the
          half that did not exist. 👎 wrote a `negative` row to `feedback` and
          stopped, which tells the office something is wrong and nothing about
          what.

          So it asks. The reply he types then arrives as an ordinary inbound
          message on the same chat, which the instruction handler already
          reads in context (#63) — so the correction lands as an INSTRUCTION,
          which is what it is, rather than as more feedback.

          `feedback`'s own comment draws this line: *"a reaction is a weak
          signal and a typed sentence is not, and treating them alike is how a
          stray emoji becomes a policy."* The reaction opens the door; the
          sentence is the thing worth keeping.
        */
        if (action === 'not_useful') {
          await askForTheCorrection(db, row).catch(() => undefined)
        }

        done.push({
          commandId: row.command_id,
          action,
          outcome: 'acted',
          note:
            row.output_id === null
              ? 'recorded against no output — the delivery record is gone'
              : `recorded against output ${row.output_id}`,
        })
        break
      }

      case 'undo': {
        const outcome = await doUndo(db, row)
        if (outcome.outcome === 'acted') await resolveNotification(db, row, 'acted')
        done.push(outcome)
        break
      }

      case 'mute_24h': {
        // Through the same parse and the same store as a typed instruction, so
        // there is one implementation of what a mute means and one audit trail.
        // A button that wrote `quiet_until` directly would be a second one.
        //
        // **Deliberately global, not scoped to the project.** Scoping it when
        // we happen to know the project and not when we do not would make one
        // button mean two different things depending on what our own records
        // contain — and the one Grant would find out about is the time it
        // silenced less than he expected. "Mute 24h" on a pager means the
        // pager. The project is still recorded on the audit row.
        const applied = await applyPreference(db, parseInstruction('leave me alone today'), {
          subject: options.subject ?? 'grant',
          originChannel: row.origin_channel as 'slack' | 'telegram' | 'voice' | 'teamhq',
          instruction: 'mute 24h (button)',
          commandId: row.command_id,
        })
        await resolveNotification(db, row, 'dismissed')
        done.push({
          commandId: row.command_id,
          action,
          outcome: applied.applied ? 'acted' : 'noted',
          note: applied.applied ? 'quiet for 24 hours' : String(applied.notUnderstood),
        })
        break
      }

      case 'open_project': {
        await resolveNotification(db, row, 'acted')
        done.push({
          commandId: row.command_id,
          action,
          outcome: 'noted',
          note: 'opening a project is a signal, not a request',
        })
        break
      }

      case 'approve':
      case 'decline': {
        // Resolved from the JOB the message came from, never from the button's
        // payload. The payload round-trips through a client and §10 forbids
        // free-form input reaching a lookup; the delivery row is ours, and 0037
        // already established it as the trustworthy end of a button press.
        if (row.job_id === null) {
          done.push({
            commandId: row.command_id,
            action,
            outcome: 'unresolvable',
            note: 'the delivery record for that message is gone, so I cannot tell what it was asking about',
          })
          break
        }
        const { rows: answered } = await db.execute(`
          select app.answer_generation_approval(
            app.open_approval_for_job(${lit(row.job_id)}::uuid),
            ${action === 'approve' ? 'true' : 'false'},
            ${lit(options.subject ?? 'grant')}
          ) as r
        `)
        const r = (answered[0] as { r: Record<string, unknown> | null } | undefined)?.r ?? null
        await resolveNotification(db, row, action === 'approve' ? 'acted' : 'dismissed')
        done.push({
          commandId: row.command_id,
          action,
          outcome: r === null || r.error !== undefined ? 'unresolvable' : 'acted',
          note:
            r === null || r.error !== undefined
              ? // The same message can be answered on Slack and on Telegram.
                // Answering twice is normal, not a fault, and saying "already
                // answered" is the honest note for the second press.
                String(r?.error ?? 'nothing was waiting on that message')
              : r.already === true
                ? `already ${String(r.state)}`
                : action === 'approve'
                  ? `approved — queued as ${String(r.job_id).slice(0, 8)}`
                  : 'declined; nothing was generated',
        })
        break
      }

      case 'more_detail': {
        await resolveNotification(db, row, 'acted')
        done.push({
          commandId: row.command_id,
          action,
          outcome: 'not_routed',
          note: "more_detail creates work, which is the router's decision, not this processor's",
        })
        break
      }

      default: {
        done.push({
          commandId: row.command_id,
          action: String(row.callback_action),
          outcome: 'noted',
          note: 'no handler for this action',
        })
      }
    }
  }

  return done
}
