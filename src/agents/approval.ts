/**
 * May the office do this without asking? (#15)
 *
 * ## The gap this closes
 *
 * #15's title is *"the system interrupts on everything or nothing"*, and the
 * cause was not a missing feature. Every part of the answer existed:
 *
 *   * `tool_permissions.level` is 0/1/2/3 across 22 tools — the action class;
 *   * `public.autonomy_level` and `app.autonomy_for(project)` — the dial,
 *     project over global, conservative default;
 *   * `public.blockers` — the surfacing, with 397 resolved rows.
 *
 * Nothing joined them. `app.autonomy_for` was in `check:callers`' baseline,
 * which is to say **the dial Grant can set from the Settings page decided
 * nothing at all**, and `handlers/drive.ts` asked unconditionally — while
 * offering him, as one of its options, *"Just tell me when things land here,
 * do not ask again"*, which nothing could honour.
 *
 * ## Where the decision lives, and why it is not here
 *
 * In SQL (`app.may_act`), not in this file. The matrix is a table so Grant can
 * change a cell without a code change (0366's rule about a list in TypeScript
 * being one he cannot add to), the tool's level is a column, the autonomy is a
 * function, and the standing authorizations are rows. A TypeScript copy of that
 * resolution would be a second implementation of the same rule — and this
 * repository's own listing has 0303, 0304 and 0310 on what the copy costs.
 *
 * So this module is the CALLER's side: ask, shape the answer, and make sure a
 * refusal is never silent.
 *
 * ## The rule a refusal has to obey
 *
 * #211: a gate that refuses without recording is a lost answer, not a saved
 * one. Three jobs went to `failed` with nothing anywhere Grant looks. A policy
 * refusal writes a `needs_permission` impediment, which is what the Governance
 * page reads.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { raiseBlocker } from '../inference/record.ts'

/** Single-quote escaping for SQL literals. Nothing here is ever a secret. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`
const uuidOrNull = (value: string | null | undefined): string =>
  value === null || value === undefined || value === '' ? 'null' : `${lit(value)}::uuid`

export type Verdict = 'proceed' | 'ask' | 'refuse'

/** The standing authorization that decided it, when one did. */
export interface Standing {
  readonly id: string
  /** "everywhere" or "this project" — the words the page shows. */
  readonly scope: string
  readonly reason: string
  readonly since: string
  readonly until: string | null
}

export interface Decision {
  readonly verdict: Verdict
  readonly tool: string
  /**
   * A sentence a person can read. Never a code, because a refusal Grant cannot
   * read the reason for is a refusal he switches off — which is the failure
   * mode `verify:hq`'s token-shape list already taught this repository once.
   */
  readonly because: string
  /** 0 read · 1 internal write · 2 outward · 3 consequential. Absent for an unknown tool. */
  readonly actionLevel: number | null
  readonly autonomy: string | null
  readonly standing: Standing | null
  /** Whether a person asked for this run, rather than a schedule (0423). */
  readonly askedFor: boolean
  /** He said yes to exactly this action (0611). */
  readonly approved: boolean
  /** He said no to this, now or inside the refusal window (0611). */
  readonly declined: boolean
  /** The No was given before this run - the office must not ask again (0611). */
  readonly remembered: boolean
  /** Why, as a code a caller can branch on without reading English. */
  readonly reason: string | null
}

interface RawDecision {
  verdict?: string
  tool?: string
  because?: string
  action_level?: number
  autonomy?: string
  asked_for?: boolean
  approved?: boolean
  declined?: boolean
  remembered?: boolean
  reason?: string
  standing?: {
    id?: string
    scope?: string
    reason?: string
    since?: string
    until?: string | null
  } | null
}

const VERDICTS: ReadonlySet<string> = new Set(['proceed', 'ask', 'refuse'])

/**
 * Ask the policy.
 *
 * `projectId` may be null: a global instruction has no project, and
 * `autonomy_for(null)` is the global setting, which is the right answer rather
 * than a missing one.
 *
 * An unreadable answer is `ask`, never `proceed`. A missing configuration must
 * not read as permission — the same argument `app.autonomy_for` makes about
 * its own default, and the reason this does not `catch` into a boolean.
 */
export const mayAct = async (
  db: SqlExecutor,
  where: {
    readonly projectId?: string | null | undefined
    readonly tool: string
    /**
     * The job whose PURPOSE this tool is — not merely the job that is running.
     *
     * 0423 lets work a person asked for proceed without asking again, and the
     * name here is doing real work. `drive.watch` is asked for by a person when
     * he presses Check now, but what he asked for is a LOOK at the folder; the
     * ingest is something the job might additionally do, and treating his
     * request as consent for it would be reading "check that folder" as "and
     * take in whatever is there".
     *
     * So: pass the job when the tool is what was asked for, and leave it out
     * when the tool is a side effect of the asking. Left out reads as
     * unprompted, which is the conservative direction and the right default
     * for anything a caller is unsure about.
     */
    readonly jobAskedFor?: string | null | undefined
    /**
     * The specialist doing this, when a specialist is (0611). Named, they must
     * hold the tool: what a plan says or a prompt claims is not a grant. Absent
     * means the office acting as itself.
     */
    readonly staff?: string | null | undefined
    /** Who this reaches. `outside` can never proceed on its own (0611). */
    readonly audience?: 'office' | 'grant' | 'outside' | null | undefined
    /**
     * The exact action, for an answer already given to bind to (0611). The job
     * whose answer counts is `job`, which is the one running.
     */
    readonly fingerprint?: string | null | undefined
    readonly job?: string | null | undefined
  },
): Promise<Decision> => {
  /*
    Migration 0611 first, worker second. There is deliberately NO fallback to
    `app.may_act` when `app.authorize_effect` is missing: the old policy cannot
    read an answer, so a plan step would re-ask its question every round, and a
    catch loose enough to recognise "the function is missing" also recognises any
    undefined function INSIDE the boundary and would quietly drop its specialist
    and outside-audience checks. A worker ahead of its migration fails loudly and
    retries; the old worker keeps working after the migration, which is why that
    is the order.

    Named arguments: seven of them, two of which are both jobs with different
    meanings (the one whose PURPOSE the tool is, and the one running).
  */
  const { rows } = await db.execute(
    `select app.authorize_effect(
       p_project => ${uuidOrNull(where.projectId)},
       p_tool => ${lit(where.tool)},
       p_asked_job => ${uuidOrNull(where.jobAskedFor)},
       p_staff => ${where.staff === null || where.staff === undefined ? 'null' : lit(where.staff)},
       p_audience => ${where.audience === null || where.audience === undefined ? 'null' : lit(where.audience)},
       p_fingerprint => ${where.fingerprint === null || where.fingerprint === undefined ? 'null' : lit(where.fingerprint)},
       p_job => ${uuidOrNull(where.job)}) as d`,
  )
  const raw = rows[0]?.d as RawDecision | string | undefined
  const parsed: RawDecision =
    typeof raw === 'string' ? (JSON.parse(raw) as RawDecision) : (raw ?? {})

  const verdict =
    typeof parsed.verdict === 'string' && VERDICTS.has(parsed.verdict)
      ? (parsed.verdict as Verdict)
      : 'ask'

  const s = parsed.standing
  return {
    verdict,
    tool: typeof parsed.tool === 'string' ? parsed.tool : where.tool,
    because:
      typeof parsed.because === 'string' && parsed.because.trim() !== ''
        ? parsed.because
        : 'The policy did not say why, so it asks.',
    actionLevel: typeof parsed.action_level === 'number' ? parsed.action_level : null,
    autonomy: typeof parsed.autonomy === 'string' ? parsed.autonomy : null,
    askedFor: parsed.asked_for === true,
    approved: parsed.approved === true,
    declined: parsed.declined === true,
    remembered: parsed.remembered === true,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
    standing:
      s === null || s === undefined || typeof s.id !== 'string'
        ? null
        : {
            id: s.id,
            scope: typeof s.scope === 'string' ? s.scope : 'everywhere',
            reason: typeof s.reason === 'string' ? s.reason : '',
            since: typeof s.since === 'string' ? s.since : '',
            until: typeof s.until === 'string' ? s.until : null,
          },
  }
}

/**
 * Say that the policy stopped something, where Grant looks.
 *
 * `needs_permission` is the impediment kind this is for, and it already feeds
 * the Governance page's *tried and could not*. Never fatal: a job that cannot
 * record why it did not act must still be able to say it did not act.
 */
export const recordRefusal = async (
  db: SqlExecutor,
  what: {
    readonly jobId: string
    readonly tool: string
    readonly because: string
    readonly noticedBy: string
  },
): Promise<void> => {
  try {
    await db.execute(`
      select app.cannot(${lit(what.jobId)}::uuid, 'needs_permission',
        ${lit(what.tool)}, ${lit(what.noticedBy)}, ${lit(what.because)}, null)
    `)
  } catch {
    // The impediment ledger refusing is not a reason to fail the job on top of
    // the refusal it is recording. The handler still says so in its own body.
  }
}

/**
 * The sentence a handler puts in front of Grant when the policy said no.
 *
 * Shared so the wording of "I was not allowed to" is one thing rather than one
 * per handler — #186's argument about `provenanceLine`, and the reason this
 * takes the decision rather than a string.
 */
export const refusalSentence = (d: Decision): string =>
  d.verdict === 'refuse'
    ? `I did not do this: ${d.because}`
    : `I have not done this yet — I need you to say. ${d.because}`

/**
 * The whole decision, for a handler that is about to write outward.
 *
 * Three verdicts, three outcomes, one place — because the alternative is each
 * handler writing its own version of "ask, and if you cannot, say why", and
 * two of those would disagree within a month. `handlers/drive.ts` was the
 * first and did it inline; the second and third caller are the moment to stop.
 *
 * ## Why it takes a Plan rather than a sentence
 *
 * #131: *"Approving something you cannot see is not an approval. It is consent
 * to a category."* The plan is produced by the code path that performs the
 * action, so the blocker can name exactly what would happen — and the plan
 * already carries the tool it needs, so nothing has to be passed twice and
 * nothing can be passed inconsistently.
 *
 * ## Why an empty plan never asks
 *
 * A duty whose answer is "nothing to do" sixteen times a day must not raise a
 * question sixteen times a day. There is no outward effect to approve, so
 * there is nothing to approve.
 */
export interface Governed {
  /** Carry the plan out, or do not. */
  readonly go: boolean
  readonly decision: Decision
  /** What the handler should tell Grant when `go` is false. */
  readonly said: string
  /** The blocker raised, when one was. */
  readonly blocker: string | null
  /**
   * The office was already told no (0611): keep the job's own record, do not
   * announce it. A duty that repeated a refusal every hour would teach him to
   * stop reading them, and an output body may not be empty.
   */
  readonly quiet: boolean
}

export const governOutward = async (
  db: SqlExecutor,
  what: {
    readonly jobId: string
    readonly projectId?: string | null
    readonly tool: string
    /** A sentence naming what would happen. `summarise(plan)` is the intended value. */
    readonly summary: string
    /** Every step, for the question. `detail(plan)` is the intended value. */
    readonly detail: string
    /** Nothing outward to do — never asks, whatever the policy says. */
    readonly empty: boolean
    readonly agent: string
    /** Answering this grants a standing authorization for the tool. */
    readonly standingOption?: string
  },
  raise: typeof raiseBlocker = raiseBlocker,
): Promise<Governed> => {
  /*
    The job is passed as the one that ASKED FOR this tool.

    Every caller of `governOutward` is about to carry out a plan whose whole
    purpose is that tool — that is what makes a plan a plan. A handler for
    which the tool is a side effect should call `mayAct` directly and leave the
    job out, which is what `handlers/drive.ts` does.
  */
  const decision = await mayAct(db, {
    projectId: what.projectId,
    tool: what.tool,
    jobAskedFor: what.jobId,
    job: what.jobId,
  })

  if (what.empty || decision.verdict === 'proceed') {
    return { go: true, decision, said: '', blocker: null, quiet: false }
  }

  /*
    A NO ALREADY GIVEN IS NOT ASKED AGAIN (0611). He said no to this, inside
    the refusal window, and a duty that asks every hour would teach him to
    stop reading the questions. Nothing is raised and nothing is recorded as
    an impediment (it is not a fault). The job still records why it did not
    act, but `quiet` tells the caller not to announce it: the standing
    question is his to reopen by changing the dial or granting the tool.
  */
  if (decision.remembered) {
    return { go: false, decision, said: refusalSentence(decision), blocker: null, quiet: true }
  }

  if (decision.verdict === 'refuse') {
    await recordRefusal(db, {
      jobId: what.jobId,
      tool: what.tool,
      because: decision.because,
      noticedBy: what.agent,
    })
    return { go: false, decision, said: refusalSentence(decision), blocker: null, quiet: false }
  }

  const option = what.standingOption ?? 'Yes, do that from now on without asking me'
  const blocker = await raise(db, {
    projectId: what.projectId ?? undefined,
    jobId: what.jobId,
    requestedAction:
      `${what.summary}. I will not do this on my own until you allow it - ` +
      `shall I keep doing it without asking?\n\n${what.detail}`,
    whyNeeded: decision.because,
    consequencesOfDelay:
      'Nothing happens until you say. Our own records are already right; it is ' +
      'only the copy outside that waits.',
    /*
      NO ONE-OFF "Yes, do it" (audit B5).

      It was offered, answering it was accepted ("Taken as a yes ... it is
      going ahead now"), and nothing was performed: the blocker carries no
      job to enqueue and the duty that asked has already finished, so the next
      run found no permission, asked the same question again and wrote
      nothing. An option may only promise what answering it performs. What
      answering CAN perform here is the standing authorization - the row the
      next run reads - so that is the yes this question offers, and the
      question says so. A one-off yes needs the approval to bind the exact
      action it approves, which is a different piece of work.
    */
    approvalOptions: [option, 'No, leave it'],
    declineOption: 'No, leave it',
    originatingAgent: what.agent,
    // The rest of the office carries on. This is a question, not a halt.
    workCanContinue: true,
    standingTool: what.tool,
    standingOption: option,
  })
  return { go: false, decision, said: refusalSentence(decision), blocker, quiet: false }
}
