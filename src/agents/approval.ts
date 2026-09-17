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
}

interface RawDecision {
  verdict?: string
  tool?: string
  because?: string
  action_level?: number
  autonomy?: string
  asked_for?: boolean
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
  },
): Promise<Decision> => {
  const { rows } = await db.execute(
    `select app.may_act(${uuidOrNull(where.projectId)}, ${lit(where.tool)}, ${uuidOrNull(where.jobAskedFor)}) as d`,
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
  })

  if (what.empty || decision.verdict === 'proceed') {
    return { go: true, decision, said: '', blocker: null }
  }

  if (decision.verdict === 'refuse') {
    await recordRefusal(db, {
      jobId: what.jobId,
      tool: what.tool,
      because: decision.because,
      noticedBy: what.agent,
    })
    return { go: false, decision, said: refusalSentence(decision), blocker: null }
  }

  const option = what.standingOption ?? 'Do that from now on without asking me'
  const blocker = await raise(db, {
    projectId: what.projectId ?? undefined,
    jobId: what.jobId,
    requestedAction: `${what.summary}. Shall I?\n\n${what.detail}`,
    whyNeeded: decision.because,
    consequencesOfDelay:
      'Nothing happens until you say. Our own records are already right; it is ' +
      'only the copy outside that waits.',
    approvalOptions: ['Yes, do it', option, 'No, leave it'],
    originatingAgent: what.agent,
    // The rest of the office carries on. This is a question, not a halt.
    workCanContinue: true,
    standingTool: what.tool,
    standingOption: option,
  })
  return { go: false, decision, said: refusalSentence(decision), blocker }
}
