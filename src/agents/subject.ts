/**
 * Naming the subject of a request when no word in it names the subject.
 *
 *   Grant: "Run the numbers if we sell it cheaper."
 *
 * A person reads that as a question for the finance director in about a
 * quarter of a second. `app.who_knows_about` reads it as nothing at all,
 * because it is a trigram match against `staff.expertise` and not one word in
 * that sentence — run, numbers, sell, cheaper — appears in any expertise list.
 *
 * ## The measurement this exists because of
 *
 * `npm run verify:routing-breadth` (#232) put 91 realistic asks through the
 * exact three calls `handlers/instruction.ts` makes. The result:
 *
 *     explicit     86%      say the noun and the vocabulary works
 *     synonym      50%
 *     long         57%
 *     typo         29%
 *     indirect     19%
 *     vague         0%
 *     command       0%
 *     colloquial    0%
 *     speech        0%
 *
 * Every form scoring zero is a form that names the subject without using the
 * noun — which is how Grant actually talks, particularly into a voice note.
 * The overall figure was 31%, and five of the eight forms he uses most were
 * flat zero.
 *
 * **So a bigger dictionary is not the fix.** #235 asks the question directly —
 * *"Can the existing routing architecture generalise beyond literal-token
 * matching? Test this empirically. If the answer is NO, do not spend hours
 * constructing an enormous synonym dictionary."* It cannot: both
 * `staff.expertise` and `TOPIC_ROLES` are literal matchers, and no quantity of
 * vocabulary reaches a sentence with no domain noun in it.
 *
 * ## What this does instead
 *
 * Asks a model, once, cheaply, and only when the literal matcher found
 * nothing. It is a subject namer, not a router: it returns role slugs and
 * `pickRoster` still decides, so every ceiling, every project restriction and
 * every §6 ambiguity rule continues to apply to its answer exactly as they
 * apply to `who_knows_about`'s. It occupies the same argument.
 *
 * ## Grant still owns the vocabulary
 *
 * The prompt is BUILT FROM `public.staff` — slug, title and the same
 * `expertise` column the trigram matcher reads. Nothing about who does what
 * is written down in this file. That is deliberate and it is his instruction:
 * he is building a dashboard to *"look at each agent, what their skill sets
 * are, and adjust and add and refine"*, and a role description hardcoded in
 * TypeScript is one he cannot adjust. Widening a specialist's remit is still
 * an edit to a column.
 *
 * ## Every way this can fail returns "nobody"
 *
 * No model, a rate limit, an empty completion, a hallucinated slug, a
 * paragraph of prose instead of an answer — all of them come back as an empty
 * array, which means the Chief of Staff answers, which is precisely what
 * happened before this file existed. The office degrades to yesterday, never
 * to nothing, for the same reason the `who_knows_about` catch does.
 *
 * ## And it is allowed to say nobody
 *
 * The expensive failure is not missing a specialist; it is summoning one for
 * *"Thanks, that is helpful."* #230's fix was one line away from putting a
 * model call on every greeting. The corpus carries ten Claire-only controls
 * for exactly this and `verify:routing-breadth` asserts none of them convenes
 * anybody — with this layer in the path.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { ROLE_SLUGS, type RoleSlug } from './router.ts'

/**
 * At most two.
 *
 * `pickRoster` caps at `ROSTER_CEILING` (five) and would happily take more,
 * but a namer that returns four roles for a sentence with no noun in it is not
 * naming a subject, it is hedging — and every extra name is a specialist
 * convened on a guess, which is the uncontrolled workload §9 rules out. Two
 * covers the genuinely overlapping request ("what does this cost and how do we
 * announce it") and nothing wider.
 */
const MOST = 2

/**
 * The Chief of Staff is never a subject.
 *
 * She is the FLOOR — an empty roster already means her, everywhere in this
 * system (`roster[0] ?? 'chief-of-staff'`). Letting the model name her would
 * make "no specialist needed" and "the chief of staff specifically" the same
 * answer arriving by two different routes, and the reason recorded against the
 * decision would then be wrong about which one happened.
 */
const NEVER: ReadonlySet<string> = new Set(['chief-of-staff'])

/**
 * Enough tokens for the answer AND the hidden reasoning before it.
 *
 * Every free model on this tier is a reasoning model and reasoning tokens come
 * out of the same completion budget — a request sized for the twenty
 * characters this actually returns spends the lot on thinking and comes back
 * `content: null, finish_reason: "length"`. That is `EmptyCompletionError`,
 * recorded in `providers/router.ts` after it was measured. 800 is generous for
 * a one-line answer and still an order of magnitude under an ordinary reply.
 */
const BUDGET = 800

interface Person {
  readonly slug: string
  readonly title: string
  readonly expertise: string
}

/**
 * Who is on the roster, described in Grant's own words from the database.
 *
 * Ordered by slug rather than by anything meaningful, so the prompt is stable
 * between calls: a list whose order moves is a prompt that busts its own cache
 * and answers differently on Tuesday.
 */
const roster = async (db: SqlExecutor): Promise<readonly Person[]> => {
  const { rows } = await db.execute(`
    select s.slug,
           coalesce(s.title, '') as title,
           coalesce(array_to_string(s.expertise, ', '), '') as expertise
      from public.staff s
     where s.active and s.slug <> 'chief-of-staff'
     order by s.slug`)
  return (rows as unknown as readonly Person[]).filter((p) =>
    (ROLE_SLUGS as readonly string[]).includes(p.slug),
  )
}

/**
 * Read an answer out of whatever came back.
 *
 * Deliberately a WHITELIST INTERSECTION rather than a parse. The model is free
 * to reply "none", to reply with a slug, to reply with a sentence containing a
 * slug, or to reply with three paragraphs of reasoning — and in every one of
 * those cases the only thing taken is the set of real role slugs that appear
 * in it. There is no format for it to get wrong, so there is no format failure
 * to handle, and a hallucinated `pricing-director` simply is not in the set.
 *
 * The cost of the looseness is a false positive if the model says "this is NOT
 * for the finance-director". Measured against the 91-case corpus rather than
 * assumed; the ten negative controls are what would catch it.
 */
export const readSlugs = (content: string, most: number = MOST): readonly RoleSlug[] => {
  const said = content.toLowerCase()
  const found = ROLE_SLUGS.filter((r) => !NEVER.has(r) && said.includes(r))
  return found.slice(0, most)
}

/**
 * Which specialists, if any, this request is for.
 *
 * Empty means the Chief of Staff, and empty is a legitimate answer rather than
 * a failure — see the header. Never throws.
 */
export const nameSubjects = async (
  db: SqlExecutor,
  router: ProviderRouter,
  instruction: string,
  trace: { readonly correlationId?: string; readonly jobId?: string } = {},
  /*
    How many names this text can justify.

    `MOST` (two) is right for a whole message, which is what this was written
    for: *"what does this cost and how do we announce it"* genuinely needs
    both. A single CLAUSE is the other case — `clauses.ts` has already
    separated the asks, so one clause has one subject and a second name from it
    is the hedging the header rules out.
  */
  most: number = MOST,
): Promise<readonly RoleSlug[]> => {
  const text = instruction.trim()
  /*
    Nothing to reason about.

    A model call on "ok" or "thanks" costs a request and a second of Grant's
    time to answer a question that has one answer. The floor is low enough that
    no real request is below it — the shortest genuine ask in the #232 corpus
    is "We need more people signing up." at 30 characters.
  */
  if (text.length < 12) return []

  const people = await roster(db).catch(() => [])
  if (people.length === 0) return []

  const sheet = people
    .map(
      (p) =>
        `- ${p.slug} (${p.title}) — ${p.expertise === '' ? 'no stated expertise' : p.expertise}`,
    )
    .join('\n')

  const result = await router
    .complete({
      messages: [
        {
          role: 'system',
          content:
            'You route one request to the right specialist in a small office. ' +
            'Answer with the slug of the ONE specialist whose job it is, or two slugs ' +
            'separated by a comma when the request genuinely needs both, or the single ' +
            'word none.\n\n' +
            'Answer none for greetings, thanks, status questions, questions about ' +
            'documents or projects or the office itself, and anything administrative. ' +
            'A general assistant handles all of those, and pulling a specialist in for ' +
            'them wastes their time. Only name a specialist when the request is ' +
            'genuinely about their subject.\n\n' +
            'Judge the SUBJECT of the request, not the words it uses. "Run the numbers ' +
            'if we sell it cheaper" is about pricing and margin even though it says ' +
            'neither.\n\n' +
            `The specialists:\n${sheet}\n\nAnswer with slugs or none. No explanation.`,
        },
        { role: 'user', content: text.slice(0, 2_000) },
      ],
      /*
        Pinned, because a router that sends the same sentence to two different
        people on two different days is not a router. Free models do not honour
        it perfectly — #229 records that measurement — but unpinned is
        measurably worse and this costs nothing.
      */
      temperature: 0,
      maxTokens: BUDGET,
      ...(trace.correlationId === undefined ? {} : { correlationId: trace.correlationId }),
      ...(trace.jobId === undefined ? {} : { jobId: trace.jobId }),
    })
    .catch(() => null)

  return result === null ? [] : readSlugs(result.content, most)
}

/** For the reason recorded against the decision, so the path taken is visible. */
export const SEMANTIC_REASON = 'no word in the request named a subject, so it was read for meaning'
