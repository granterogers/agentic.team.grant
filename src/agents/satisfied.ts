/**
 * WAS THE GOAL ACTUALLY MET? (#283)
 *
 * "All plan steps ended" is not "Grant's goal was achieved", and nothing in
 * this office could tell the two apart. A plan whose every step honestly
 * reported finding nothing ended exactly as successfully as one that read the
 * material and put the right thing on his list.
 *
 * ## Deterministic, and deliberately so
 *
 * This asks nothing of a model. Every input is canonical — what the plan said
 * it would do, what each step actually observed, what receipts exist — and the
 * verdict follows from them by rule. A judge would cost a call on every turn
 * and could be talked into agreeing that nothing happening was fine, which is
 * precisely the failure it would exist to catch.
 *
 * The brief is explicit that expensive judging does not belong on trivial
 * questions without evidence it is worthwhile. When something genuinely needs
 * reading — comparing a long answer against a long request — that is a
 * different instrument and `src/eval/judge.ts` is where it would go.
 *
 * ## The verdict is not a permission
 *
 * Nothing here authorizes anything. It says what happened; `pursue.ts` decides
 * whether another round is worth trying, and every action in that round goes
 * through the same capability, permission, autonomy and approval gates as the
 * first. An assessment that could widen what the office may do would be the
 * model-as-authorization defect wearing a new hat.
 */

import type { GoalPlan } from './goal.ts'
import type { Observation } from './perform.ts'

/**
 * The seven honest answers.
 *
 * Seven rather than two, because "not satisfied" covers outcomes that want
 * completely different things next: a pause waiting on Grant is not a failure,
 * a capability nobody built is not a blocked permission, and a provider outage
 * is not either of them. Collapsing them is how an office tells somebody
 * "I could not" about something that simply had not happened yet.
 */
/**
 * The two things the office can say about having reconsidered.
 *
 * Named because two callers need them: `pursue.ts` says them, and
 * `verify:pursues` asserts that it did. A suite matching the handler's prose
 * with its own regex is the wording lock this repository has paid for six
 * times — and it caught the seventh here, where the check demanded "another
 * route" and the handler had written "no other route".
 *
 * One assembly, two callers.
 */
export const RECONSIDERED = {
  tookAnother: (route: string): string => `It tried another route: ${route}.`,
  noneLeft: 'It looked for another route and there was no other route available to it.',
  sameAgain: 'It tried another route and arrived at the same place, so it stopped.',
} as const

/** Whether a body records that the office reconsidered at all. */
export const saysItReconsidered = (body: string): boolean =>
  /tried another route|no other route available/i.test(body)

export type Verdict =
  | 'satisfied'
  | 'partially_satisfied'
  | 'blocked'
  | 'awaiting_grant'
  | 'impossible_here'
  | 'temporarily_unavailable'
  | 'failed'

export interface Assessment {
  readonly verdict: Verdict
  /** A sentence for a person, never a code. */
  readonly because: string
  /**
   * What the goal still wants, in the plan's own words.
   *
   * This is what a re-plan is allowed to address and NOTHING ELSE. It is built
   * from the steps that did not produce and the work the planner already said
   * it could not reach — so a second round can only ever be another attempt at
   * what Grant asked, never a widening of it.
   */
  readonly unmet: readonly string[]
  /** Whether trying another route could conceivably help. */
  readonly worthAnotherRoute: boolean
}

/** What the run ended as, in the words `checkpoint.ts` uses. */
export interface RunShape {
  readonly kind: 'done' | 'paused' | 'stopped'
  readonly pauseReason?: string | undefined
}

const listOf = (steps: { id: string; why: string; capability: string }[]): string[] =>
  steps.map((s) => (s.why.trim() === '' ? s.capability : s.why.trim()))

/**
 * An impediment another route could never get past.
 *
 * A policy refusal and a capability nobody has built will answer the same way
 * however many times they are asked, so re-planning into one is the loop the
 * bounds exist for — and in the refusal case it is worse than a loop. If the
 * office responded to `observe` by looking for another way to write, the
 * autonomy dial would be a suggestion.
 *
 * Shared rather than written twice, because the first version of this file
 * applied it ONLY where nothing at all had produced — so a plan that read
 * successfully and was then refused the write counted as "partially satisfied,
 * worth another go", and the suite caught the office re-planning around a
 * refusal. A partial success does not make a refusal negotiable.
 */
const final = (impediment: string): boolean =>
  /did not do this|switched off|withdrawn|never done without|no longer in the capability registry|nothing in the office performs it/i.test(
    impediment,
  )

/**
 * Judge the run against the plan.
 *
 * `outcomes` is keyed by compiled step name (`<id>:<capability>`), which is
 * what `runSteps` returns.
 */
export function assess(
  plan: GoalPlan,
  outcomes: Readonly<Record<string, Observation>>,
  run: RunShape,
): Assessment {
  const steps = plan.steps.map((s) => ({
    id: s.id,
    why: s.why,
    capability: s.capability,
    seen: outcomes[`${s.id}:${s.capability}`],
  }))
  const produced = steps.filter((s) => s.seen?.found === true)
  const ran = steps.filter((s) => s.seen !== undefined)
  const couldNot = steps.filter((s) => s.seen !== undefined && s.seen.found !== true)
  const neverRan = steps.filter((s) => s.seen === undefined)
  const receipts = produced.flatMap((s) => s.seen?.ids ?? [])

  /*
    A PAUSE IS NOT A FAILURE, AND THE THREE KINDS WANT DIFFERENT THINGS.

    Waiting on Grant is the office behaving correctly under his own dial; a
    provider outage resolves itself; anything else stopped for a reason a
    person has to look at. Reporting all three as "blocked" would tell him to
    intervene in the two cases where he should not have to.
  */
  if (run.kind === 'paused') {
    const unmet = [...listOf(couldNot), ...listOf(neverRan), ...plan.unreachable]
    if (run.pauseReason === 'awaiting_approval') {
      return {
        verdict: 'awaiting_grant',
        because: 'The office has done what it may and needs you to say before the rest.',
        unmet,
        // He has to answer. Another route would be going round him.
        worthAnotherRoute: false,
      }
    }
    if (run.pauseReason === 'provider_unavailable' || run.pauseReason === 'rate_limited') {
      return {
        verdict: 'temporarily_unavailable',
        because: 'It stopped part way through because a provider was not answering.',
        unmet,
        // It will pick itself up. Trying a different route now would race it.
        worthAnotherRoute: false,
      }
    }
    return {
      verdict: 'blocked',
      because: `It stopped part way through: ${run.pauseReason ?? 'a reason it recorded'}.`,
      unmet,
      worthAnotherRoute: false,
    }
  }

  if (run.kind === 'stopped') {
    return {
      verdict: 'blocked',
      because: 'You asked it to stop, so it stopped.',
      unmet: [...listOf(neverRan), ...plan.unreachable],
      worthAnotherRoute: false,
    }
  }

  if (ran.length === 0) {
    return {
      verdict: 'failed',
      because: 'Nothing in the plan ran at all.',
      unmet: [...listOf(steps), ...plan.unreachable],
      worthAnotherRoute: false,
    }
  }

  /*
    NOTHING PRODUCED. Which of three things that is depends on WHY, and the
    impediments say — so they are read rather than summarised into a single
    apology.
  */
  if (produced.length === 0) {
    const why = couldNot.map((s) => String(s.seen?.impediment ?? '')).join(' ')
    const forbidden = /did not do this|switched off|withdrawn|never done without/i.test(why)
    const unbuilt = /nothing in the office performs it|no longer in the capability registry/i.test(
      why,
    )
    return {
      verdict: forbidden ? 'blocked' : unbuilt ? 'impossible_here' : 'failed',
      because: forbidden
        ? 'Everything the plan needed is something the office is not allowed to do here.'
        : unbuilt
          ? 'Everything the plan needed is something the office cannot do yet.'
          : 'Every step ran and none of them found anything.',
      unmet: [...listOf(couldNot), ...plan.unreachable],
      /*
        Only worth another route when the office LOOKED and found nothing. A
        permission refusal and a missing capability will answer the same way
        however many times they are asked, and re-planning into them is the
        loop this whole design exists to prevent.
      */
      worthAnotherRoute: !forbidden && !unbuilt,
    }
  }

  const unmet = [...listOf(couldNot), ...listOf(neverRan), ...plan.unreachable]
  if (unmet.length === 0) {
    /*
      SATISFIED NEEDS A RECEIPT WHEN THE PLAN SAID IT WOULD DO SOMETHING.

      A plan of pure reads is satisfied by having read — there is nothing to
      point at and that is honest. A plan containing a step that WRITES is not
      satisfied by prose saying it did: "created a task" requires a task.
      Without this, the one claim the office must never make is the one this
      function would have waved through.
    */
    const meantToAct = steps.some(
      (s) => s.capability !== 'db.read' && s.capability !== 'notebook.read',
    )
    if (meantToAct && receipts.length === 0) {
      return {
        verdict: 'partially_satisfied',
        because:
          'Every step reported success, but nothing it did left a record — so the office ' +
          'cannot show you what it changed.',
        unmet: listOf(steps.filter((s) => (s.seen?.ids ?? []).length === 0)),
        worthAnotherRoute: false,
      }
    }
    return {
      verdict: 'satisfied',
      because: 'Every step of the plan did what it set out to do.',
      unmet: [],
      worthAnotherRoute: false,
    }
  }

  return {
    verdict: 'partially_satisfied',
    because: `${String(produced.length)} of ${String(steps.length)} steps produced something.`,
    unmet,
    /*
      Something worked and something did not, so a different route to the
      remainder is exactly the case bounded re-planning is for — UNLESS what
      stopped it was final. A refusal or a capability nobody built answers the
      same way however it is approached, and a partial success does not make
      either negotiable.
    */
    worthAnotherRoute: couldNot.some(
      (s) => s.seen?.impediment !== undefined && !final(String(s.seen.impediment)),
    ),
  }
}
