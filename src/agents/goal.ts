/**
 * What work a goal requires — proposed by a model, ruled on by code (#283).
 *
 * ## The measurement this exists because of
 *
 * 23 realistic requests, frozen before this file was written:
 *
 *     today's architecture   7 / 23 goals reachable
 *     of those seven         all single-step
 *     multi-step goals       0 / 16
 *     unsafe proposals       0
 *
 * `understand.ts` fixed the first inversion: human language is read by a model
 * before any regex sees it. This is the same inversion one level down.
 * `plan.ts` says so in its own header — *"an instruction whose shape is not in
 * this file gets a prose answer rather than a plan"* — and its whole vocabulary
 * is eight notebook-shaped steps. Everything else is nine independent
 * recognisers, each firing at most once, none able to express "step B consumes
 * step A".
 *
 * ## The boundary, restated for this layer
 *
 *     THE MODEL DECIDES WHAT SEQUENCE OF WORK LOOKS APPROPRIATE.
 *     DETERMINISTIC CODE DECIDES WHETHER ANY OF IT MAY HAPPEN.
 *
 * A plan is a PROPOSAL. Nothing here executes, grants, or resolves an entity.
 * `validate` is sovereign: a step naming a capability that does not exist, or
 * one that exists and is not granted, or one above the autonomy ceiling, is
 * refused rather than improvised. That is the answer to the objection
 * `plan.ts` raised and was right about — a freely-generated plan proposing
 * steps nothing can execute produces a confident plan followed by silence.
 *
 * ## The vocabulary is the DATABASE, not this file
 *
 * `public.tool_permissions` already carries stable identity, purpose, verbs,
 * level, whether it is granted, whether it can run inside this reply, and what
 * delivers it. It is the source of truth for permission and #7 of the brief
 * forbids a second copy: a catalogue hardcoded here would be wrong the day
 * Grant grants something, and wrong in the dangerous direction the day he
 * revokes something.
 *
 * So the planner's action vocabulary is read at planning time. A capability
 * added to the registry becomes proposable with no code change; one disabled
 * stops being proposable in the same breath.
 *
 * ## Every failure falls back to today
 *
 * No provider, invalid JSON, a step out of vocabulary, a cycle, too many steps
 * — all of them yield `null`, and the caller runs the existing cascade
 * unchanged. The change cannot be worse than the status quo, which is the same
 * property that made `understand.ts` safe to put in front of the recognisers.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { ProviderRouter } from '../providers/router.ts'

/** One capability, exactly as the registry describes it. */
export interface Capability {
  readonly tool: string
  /** 0 read · 1 reversible write · 2 external effect · 3 never autonomous. */
  readonly level: number
  readonly enabled: boolean
  /** Can it run inside this reply, or only as a job that reports back later? */
  readonly inReply: boolean
  readonly purpose: string
  readonly verbs: readonly string[]
}

/** One piece of proposed work. */
export interface PlanStep {
  /** Stable within the plan, so a later step can depend on it. */
  readonly id: string
  /** A `tool_permissions.tool`. Anything else fails validation. */
  readonly capability: string
  /** Why this step, in Grant's terms. Shown to him; never used to decide. */
  readonly why: string
  /** Earlier step ids whose OUTPUT this step needs. Empty means independent. */
  readonly needs: readonly string[]
  /** A staff slug, when the work genuinely belongs to one. */
  readonly specialist: string | null
}

export interface GoalPlan {
  /** The goal in one sentence, as the model understood it. */
  readonly goal: string
  readonly steps: readonly PlanStep[]
  /**
   * Work the goal needs that no granted capability can do.
   *
   * The honest half. #60's lesson is that a plan understanding a third of a
   * request and presenting it as complete is worse than one that understands
   * nothing: an unrepresentable clause is NAMED rather than dropped.
   */
  readonly unreachable: readonly string[]
  /** Steps that were proposed and refused, with the reason. Never executed. */
  readonly refused: readonly string[]
  readonly how: 'model' | 'fallback'
  readonly why: string | null
  readonly model: string | null
}

/**
 * Bounds. A plan larger than this is a model malfunctioning, not a thorough
 * assistant, and executing twelve steps from one sentence is the worst thing
 * this layer could do.
 */
const MOST_STEPS = 8
const LONGEST_WHY = 240

/**
 * The autonomy ceiling for a PROPOSAL.
 *
 * Level 3 is "never autonomous" — `db.delete`, `gmail.send`, `production.write`,
 * `spend.money`. A plan may not contain one at all: 0's CHECK constraint
 * already refuses a level-3 action resolving to `proceed`, and this is the same
 * rule enforced a step earlier, where it can be explained to Grant instead of
 * raising.
 *
 * Level 2 is an external effect and stays proposable, because `slack.post` and
 * `notebook.write` are ordinary office work; the approval policy decides, as it
 * does today.
 */
const NEVER_PROPOSABLE = 3

/**
 * The catalogue, read from the registry.
 *
 * Only the enabled rows: a disabled capability is not a thing the office can
 * offer to do, and putting it in the prompt invites exactly the claim #64 was
 * about — being told YES about something impossible, which costs the work
 * silently.
 */
export const planningCatalogue = async (db: SqlExecutor): Promise<readonly Capability[]> => {
  const { rows } = await db.execute(`
    select tool, level, enabled, in_reply,
           coalesce(description, '') as purpose,
           coalesce(verbs, '{}') as verbs
      from public.tool_permissions
     where enabled and level < ${String(NEVER_PROPOSABLE)}
     order by level, tool`)
  return rows.map((r) => {
    const row = r as {
      tool: string
      level: number
      enabled: boolean
      in_reply: boolean
      purpose: string
      verbs: unknown
    }
    return {
      tool: String(row.tool),
      level: Number(row.level),
      enabled: row.enabled === true,
      inReply: row.in_reply === true,
      purpose: String(row.purpose),
      verbs: Array.isArray(row.verbs) ? row.verbs.map((v) => String(v)) : [],
    }
  })
}

/** How the catalogue reads to a model. Purpose truncated: it feeds a prompt. */
export const catalogueSheet = (catalogue: readonly Capability[]): string =>
  catalogue
    .map(
      (c) =>
        `- ${c.tool} (${c.inReply ? 'runs now' : 'runs as a background job'}) — ` +
        `${c.purpose.split('.')[0]?.slice(0, 150) ?? c.purpose.slice(0, 150)}`,
    )
    .join('\n')

interface RawPlan {
  goal?: unknown
  steps?: {
    id?: unknown
    capability?: unknown
    why?: unknown
    needs?: unknown
    specialist?: unknown
  }[]
  unreachable?: unknown[]
}

const fellBack = (why: string): GoalPlan => ({
  goal: '',
  steps: [],
  unreachable: [],
  refused: [],
  how: 'fallback',
  why,
  model: null,
})

/**
 * THE SOVEREIGN HALF. Exported, because every rule here is one a model will
 * eventually try to break and each deserves its own test.
 *
 * Refuses rather than repairs. A plan with one bad step is a plan whose author
 * did not understand the catalogue, and silently dropping the bad step would
 * hand Grant a confident plan that does less than it says.
 */
export function validate(
  raw: RawPlan,
  catalogue: readonly Capability[],
  known: ReadonlySet<string>,
): GoalPlan {
  const byName = new Map(catalogue.map((c) => [c.tool, c]))
  const goal = typeof raw.goal === 'string' ? raw.goal.trim().slice(0, 400) : ''
  const proposed = Array.isArray(raw.steps) ? raw.steps : []
  if (proposed.length > MOST_STEPS) {
    return fellBack(`the plan had ${String(proposed.length)} steps`)
  }

  const steps: PlanStep[] = []
  const refused: string[] = []
  const seen = new Set<string>()

  for (const s of proposed) {
    const id = typeof s?.id === 'string' ? s.id.trim() : ''
    const capability = typeof s?.capability === 'string' ? s.capability.trim() : ''
    const why = typeof s?.why === 'string' ? s.why.trim().slice(0, LONGEST_WHY) : ''
    const needs = Array.isArray(s?.needs) ? s.needs.map((n) => String(n).trim()) : []
    const specialist =
      typeof s?.specialist === 'string' && s.specialist.trim() !== '' ? s.specialist.trim() : null

    if (id === '' || seen.has(id)) {
      refused.push(`a step had ${id === '' ? 'no id' : `a repeated id (${id})`}`)
      continue
    }
    /*
      THE RULE THAT MAKES THIS SAFE TO SHIP. A capability outside the catalogue
      is not improvised into something similar, because "something similar"
      is how a plan to read the diary becomes a plan to write to it.
    */
    const known_capability = byName.get(capability)
    if (known_capability === undefined) {
      refused.push(
        `${capability === '' ? 'a step named no capability' : capability} is not a capability this office has`,
      )
      continue
    }
    /*
      A DEPENDENCY MAY ONLY POINT BACKWARDS. Forward and self references are
      the two ways a model expresses a cycle, and a cycle in an execution graph
      is a hang rather than an error.
    */
    const backwards = needs.filter((n) => seen.has(n))
    if (backwards.length !== needs.length) {
      refused.push(`${id} depends on a step that does not come before it`)
      continue
    }
    if (specialist !== null && !known.has(specialist)) {
      /*
        An unknown specialist is dropped rather than refusing the step: WHO
        does the work is a routing preference and `pickRoster` is sovereign
        over it anyway, whereas WHAT the step does is the safety question.
      */
      refused.push(`${specialist} is not on the roster, so ${id} was left unassigned`)
      steps.push({ id, capability, why, needs, specialist: null })
      seen.add(id)
      continue
    }
    steps.push({ id, capability, why, needs, specialist })
    seen.add(id)
  }

  const unreachable = (Array.isArray(raw.unreachable) ? raw.unreachable : [])
    .filter((u): u is string => typeof u === 'string' && u.trim() !== '')
    .map((u) => u.trim().slice(0, LONGEST_WHY))
    .slice(0, MOST_STEPS)

  /*
    A plan that proposed something and had ALL of it refused is not a plan. It
    falls back, so the cascade answers, rather than presenting Grant with an
    empty plan and a list of complaints.
  */
  if (steps.length === 0 && proposed.length > 0 && unreachable.length === 0) {
    return fellBack(`every proposed step was refused: ${refused.join('; ').slice(0, 200)}`)
  }

  return { goal, steps, unreachable, refused, how: 'model', why: null, model: null }
}

const SYSTEM = (sheet: string, roster: string): string =>
  [
    'You are the chief of staff of a small office. You are given one clear request',
    'and you say what work is required to satisfy it. You do NOT do the work and you',
    'do NOT answer the request.',
    '',
    'Answer with JSON only, in exactly this shape:',
    '{"goal":"...","steps":[{"id":"s1","capability":"...","why":"...","needs":[],"specialist":null}],"unreachable":[]}',
    '',
    'THE ONLY CAPABILITIES THIS OFFICE HAS:',
    sheet,
    '',
    'THE PEOPLE:',
    roster,
    '',
    'RULES',
    '1. capability MUST be one of the names listed above, exactly. If the work needs',
    '   something not on that list, do not invent a name — put a short description of',
    '   the missing work in unreachable instead.',
    '2. needs lists the ids of EARLIER steps whose RESULT this step requires. Use it',
    '   only for a real dependency: if the second step cannot be written until the',
    '   first one has found something out, it depends on it. Independent work has',
    '   needs [].',
    '3. Fewest steps that genuinely satisfy the request. A question answerable by',
    '   reading is ONE step and nothing more — do NOT add a write, a draft or an',
    '   artifact that was not asked for. Padding a question into work is the worst',
    '   thing you can do here.',
    '3b. draft.create is for when Grant asked for something WRITTEN — a document, a',
    '   write-up, a report, a message to be prepared. Analysis he wants told to him',
    '   is not a draft.',
    '3c. task.create is for putting something on GRANT\u2019S OWN list. Work the office',
    '   should go and do is a step of its own, not a task telling somebody to do it.',
    '3d. A standing instruction about how the office should behave in future is',
    '   preference.update. One step, nothing else.',
    '4. If the request asks for nothing to be done — thanks, an acknowledgement, a',
    '   remark — return no steps at all.',
    '5. specialist is a slug from the list of people, and only when the work genuinely',
    '   belongs to their subject. null otherwise.',
    '6. Contacting anybody outside the office is never a step. Preparing what would',
    '   be sent is draft.create; the sending is Grant’s decision, not yours.',
    '7. If the request is too vague to act on, or names something you cannot',
    '   identify, return no steps and say what you would need in unreachable.',
    '8. why is one short phrase for Grant, not an explanation to yourself.',
  ].join('\n')

/**
 * Ask what this goal requires. Never throws; every failure is today's behaviour.
 */
export async function planFor(
  request: string,
  catalogue: readonly Capability[],
  roster: readonly { readonly slug: string; readonly title: string }[],
  router: ProviderRouter | undefined,
  trace: { readonly jobId?: string; readonly correlationId?: string } = {},
): Promise<GoalPlan> {
  const said = request.trim()
  if (said === '') return fellBack('nothing was said')
  /*
    SHORT AND SINGLE-CLAUSE NEVER REACHES THE PLANNER.

    The same fast path `understand.ts` uses, for the same reason and now with a
    second one. The first measurement of this planner asked it about "How many
    projects have we got open?" and got back `db.read` FOLLOWED BY
    `draft.create` — it padded a trivial question into work, which is the
    failure the controls exist to catch, and it cost 13 seconds on average to
    do it.

    A planner that turns every ordinary message into an agent loop is not an
    improvement however well it scores on the hard cases. All four controls in
    the corpus are under sixty characters and every genuinely composed request
    is far longer, so the split is cheap and measurable rather than a guess.
  */
  if (said.length <= 60 && !/\b(also|then|and|after|once|so that|before)\b/i.test(said)) {
    return fellBack('short and single-clause — the cascade is faster and enough')
  }
  if (router === undefined) return fellBack('no provider was available')
  if (catalogue.length === 0) return fellBack('the capability registry answered with nothing')

  const result = await router
    .complete({
      messages: [
        {
          role: 'system',
          content: SYSTEM(
            catalogueSheet(catalogue),
            roster.map((r) => `- ${r.slug} (${r.title})`).join('\n'),
          ),
        },
        { role: 'user', content: said.slice(0, 2_000) },
      ],
      temperature: 0,
      /*
        Room for the answer and whatever the model spends thinking first.
        CLAUDE.md records a judge given 2,000 returning nothing at all because
        it spent them all reasoning.
      */
      maxTokens: 1_600,
      ...(trace.correlationId === undefined ? {} : { correlationId: trace.correlationId }),
      ...(trace.jobId === undefined ? {} : { jobId: trace.jobId }),
    })
    .catch(() => null)
  if (result === null) return fellBack('the provider did not answer')

  const at = result.content.indexOf('{')
  const to = result.content.lastIndexOf('}')
  if (at < 0 || to <= at) return fellBack('the answer carried no JSON')
  let raw: RawPlan
  try {
    raw = JSON.parse(result.content.slice(at, to + 1)) as RawPlan
  } catch {
    return fellBack('the answer was not valid JSON')
  }

  const checked = validate(raw, catalogue, new Set(roster.map((r) => r.slug)))
  return checked.how === 'fallback' ? checked : { ...checked, model: result.model ?? null }
}
