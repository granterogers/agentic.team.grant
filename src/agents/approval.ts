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
}

interface RawDecision {
  verdict?: string
  tool?: string
  because?: string
  action_level?: number
  autonomy?: string
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
  where: { readonly projectId?: string | null; readonly tool: string },
): Promise<Decision> => {
  const { rows } = await db.execute(
    `select app.may_act(${uuidOrNull(where.projectId)}, ${lit(where.tool)}) as d`,
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
