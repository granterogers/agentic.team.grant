/**
 * A turn that died owes the person who asked a sentence.
 *
 * 8 September, 08:02. Grant sent a 17-second voice note to his own Telegram
 * chat. The transcription path threw, the job retried to attempt 4 of 5 and
 * moved to `failed`, and `public.deliveries` for it holds ZERO rows. He spoke
 * into his phone and nothing ever came back - no answer, no apology, not even
 * "I could not hear that". Silence on a voice note is the worst case of this,
 * because it is indistinguishable from never having been heard.
 *
 * The crash itself is long fixed. The silence was the general case: every
 * terminal failure in `worker.ts` ends `moveTo(job, 'failed')` and returns.
 * #211 taught the coherence gate to record an IMPEDIMENT - a row on the
 * Governance page, a screen he has to go and look at - and CLAUDE.md states
 * the rule one layer further out than the fix reached: *"Anything that can end
 * a turn with no answer has to say so somewhere he looks."*
 *
 * Three decisions worth keeping:
 *
 * **Who is owed is decided in SQL** (`app.owed_a_word`), not here, so every
 * death site shares one definition instead of each deciding for itself. It
 * excludes a retry, a duty, a child branch, a turn that already answered, and
 * one with nowhere to reply to.
 *
 * **The sentence is composed in code**, with no model call. A turn that just
 * failed - possibly BECAUSE the model was unusable - is the worst moment to
 * ask a model for an apology, and a code-composed sentence cannot fabricate,
 * so it cannot be refused by the gate that killed the turn in the first place.
 *
 * **It says the attempt failed, never that the office cannot.** #320's
 * invariant: *cannot perform* / *needs something* / *this attempt failed* /
 * *done* must not collapse into one generic refusal. The office CAN answer
 * him; this try did not.
 *
 * Containment is inherited, not re-implemented. `app.claim_delivery` already
 * refuses a harness job any destination outside `public.test_destinations`
 * (0523), so this path cannot reach him from a synthetic run.
 */
import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { HandlerOutput, Job, Notifier } from './worker.ts'

/* Same one-liner `worker.ts` uses. Copied rather than imported because it is
   not exported there, and a second export of a two-line quoter is not worth a
   change to the module it lives in. */
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface OwedWord {
  readonly channel: string
  readonly accountRef: string
  readonly targetRef: string
  readonly threadRef: string | null
  readonly kind: string
}

/**
 * What he reads.
 *
 * Deliberately plain and deliberately short. It states that the turn did not
 * get through, that the office still can, and what he can do about it in one
 * move. It does NOT paste the internal reason: "incoherent output metadata:
 * body" is a sentence for the Governance page, and putting it on his phone
 * would be the issue-number defect - a message composed for a person carrying
 * words written for a machine.
 */
export function apology(spoken: boolean): string {
  const what = spoken
    ? 'I could not get through what you sent me just now'
    : 'I could not get through what you asked me just now'
  return (
    `${what}. That is my fault rather than yours, and it is not something ` +
    'I am unable to do - this attempt simply did not finish. Say it again ' +
    'and I will pick it straight up.'
  )
}

/**
 * What he reads when the turn did not die but PARKED for good (0634): a step that changes something outside the
 * office was interrupted, or was written by other code, so nothing will resume it. It says what is true and what
 * he can actually do - stop it on the dashboard and ask again - and promises nothing the office cannot perform.
 */
export function parkedNotice(): string {
  return (
    'I stopped part-way through what you asked and I will not carry on by myself: a step outside our own ' +
    'records may or may not have gone through, or kept being refused, and repeating it could do it twice. ' +
    'It is parked on the dashboard - stop it there, and if you still want it, ask me again and I will start ' +
    'it fresh.'
  )
}

export type LastWordOutcome = 'told' | 'nobody owed' | 'could not'

/**
 * Tell the person who asked that their turn died.
 *
 * Never throws. A failure to apologise must not become a second failure, which
 * is the rule every observability call in `worker.ts` already follows.
 */
export async function lastWord(
  db: SqlExecutor,
  job: Job,
  notify: Notifier | undefined,
  /** The turn parked rather than died: the sentence says so (0634). */
  parked = false,
): Promise<LastWordOutcome> {
  if (notify === undefined) return 'nobody owed'

  /*
    `owed_a_word` is the GATE, not the destination: the existing notifier
    resolves where to reply from the job's own inbound origin and has done
    since it was written. Two functions deciding a destination is the defect
    0310 exists about, so this asks only the question nothing else answers -
    is anybody owed a sentence at all.
  */
  try {
    const { rows } = await db.execute(
      `select channel, account_ref, target_ref, thread_ref, kind
         from app.owed_a_word(${lit(job.jobId)}::uuid)`,
    )
    const r = rows[0] as
      | {
          channel: string
          account_ref: string
          target_ref: string
          thread_ref: string | null
          kind: string
        }
      | undefined
    if (r === undefined) return 'nobody owed'
  } catch {
    return 'could not'
  }

  /*
    Was it spoken? `voice_file_id` is the only thing that knows, and it changes
    one word of the sentence - "what you sent me" rather than "what you asked
    me". Worth the query: the voice note is the case this exists for, and
    telling somebody their SPOKEN message did not get through is a different
    reassurance from telling them their typed one did not.
  */
  let spoken = false
  try {
    const { rows } = await db.execute(
      `select (c.voice_file_id is not null) as spoken
         from public.jobs j
         join public.inbound_commands c
           on c.command_id = (j.pinned_config ->> 'command_id')::uuid
        where j.job_id = ${lit(job.jobId)}::uuid`,
    )
    spoken = (rows[0] as { spoken: boolean } | undefined)?.spoken === true
  } catch {
    /* The plainer wording is correct for both, so this is not worth failing. */
  }

  const body = parked ? parkedNotice() : apology(spoken)

  /*
    Stored as an output before it is sent, for the same reason every other
    answer is: `deliveries` joins to a job through one, the Governance page
    reads it, and a sentence that reached his phone and exists nowhere in the
    record is the half of a delivery this office cannot audit.

    346 failed jobs already carry outputs, so this is the ordinary shape rather
    than a new one. `deterministic` is FALSE although the sentence is
    code-composed: the turn spent inference before it died, and
    `enforce_deterministic_claim` correctly refuses the claim on a correlation
    that did - the four confirmations #237 found are what that rule is for.
  */
  let outputId: string
  try {
    const { rows } = await db.execute(`
      insert into public.outputs
        (job_id, staff_id, body, confidence, evidence, sources, deterministic)
      values
        (${lit(job.jobId)}::uuid,
         (select st.staff_id from public.staff st
           where st.slug = app.staff_behind_job(${lit(job.jobId)}::uuid)),
         ${lit(body)},
         'high'::public.confidence_level,
         'inferred'::public.evidence_type,
         '[]'::jsonb,
         false)
      returning output_id::text as id`)
    const r = rows[0] as { id: string } | undefined
    if (r === undefined) return 'could not'
    outputId = r.id
  } catch {
    return 'could not'
  }

  /*
    The path is ASKED, never asserted. A confirmation composed in code is
    tempted to claim `deterministic_retrieval` and `enforce_deterministic_claim`
    refuses it on any correlation that spent a model call - which this one did,
    before it died. #237 found four confirmations making exactly that claim;
    `howComposed` is the one answer they now share.
  */
  let path: HandlerOutput['path']
  try {
    path = await howComposed(db, job.jobId)
  } catch {
    path = 'inference'
  }

  const output: HandlerOutput = {
    announce: true,
    body,
    confidence: 'high',
    contradictions: null,
    evidence: 'inferred',
    model: null,
    path,
    sources: [],
  }

  /*
    AND THE COLUMN IS CORRECTED BEFORE THE NOTIFIER READS IT.

    `announce: true` above is on the OUTPUT; the combined notifier suppresses
    on `public.jobs.announce`, the COLUMN, because that is how the worker's
    dedupe seam (0584/0585/0589) reaches a notifier that runs later. Reading
    the output there instead would defeat `app.say_once` entirely, so the
    column is right and this is the one caller that arrives without having
    written it.

    Left alone, a job whose earlier attempt set the column false and which
    then died would have its apology answered with "nothing worth
    announcing" — the 0074 gate, correct for an interim poll, swallowing the
    one message 0571 exists to guarantee.

    NOT REACHABLE TODAY, and that is the reason to close it rather than to
    leave it: 77 jobs already have exactly this shape (failed,
    `office.instruction`, an inbound command, `announce = false`) and every
    one is a verify suite suppressing its own traffic. No product path sets
    the flag on a job `app.owed_a_word` can select, because every handler
    that returns `announce: false` is a DUTY and a duty carries no inbound
    command. The invariant therefore holds by the accident of which handlers
    exist, and is one quiet confirmation away from not holding.

    Safe in the other direction too: `owed_a_word` requires an inbound
    command and `parent_job_id is null`, so this can never resurrect a duty's
    muted chatter — the rows 0584 silences are not rows this function returns.
  */
  await db
    .execute(`update public.jobs set announce = true where job_id = ${lit(job.jobId)}::uuid`)
    .catch(() => undefined)

  try {
    await notify(job, output, outputId)
    return 'told'
  } catch {
    return 'could not'
  }
}
