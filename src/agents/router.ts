/**
 * The router (§9): who is needed, who is not, and whether this work already
 * exists.
 *
 * Phase 5's acceptance names two things this file has to make impossible
 * rather than discouraged:
 *
 *   - *"duplicate-work avoidance is enforced by the router as a **required
 *     query**"*
 *   - *"ambiguous input produces a bounded investigation or a clarification,
 *     never an uncontrolled multi-agent workload"*
 *
 * ## Why the duplicate scan is a parameter and not a step
 *
 * The obvious implementation is `route()` calling `scanForDuplicates()` first.
 * That is a convention: the next person to add a routing path writes their own
 * `route`, forgets the scan, and nothing anywhere reports a fault — the
 * duplicated work looks exactly like work.
 *
 * So `route()` takes a `DuplicateScan` it cannot construct. The only way to
 * obtain one is `scanForDuplicates()`, which runs the query. Skipping the scan
 * is not a discipline failure here; it is a type error, and then, if someone
 * defeats the type, a NOT NULL violation on `routing_decisions` (0020).
 *
 * Three layers for one rule looks excessive until you notice they fail
 * differently: the type catches it at author time, the schema catches a
 * different codepath at write time, and the recorded row catches it in review
 * months later. §11 makes the same argument about paid inference and uses
 * four.
 *
 * ## Why "convene nobody" is the default
 *
 * §9: *"Trivial work spawns no subagents. Simple factual retrieval is not a
 * team meeting."* The roster starts empty and each addition has to be argued
 * for by the intent class. A router whose default is a full team is a router
 * that costs money to ask the time.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { Classification, IntentClass } from './intent.ts'
import { classifyIntent, INTENT_COST, needsClarification } from './intent.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * §9's roles, by slug. Matches the 0019 seed.
 *
 * Duplicated here rather than read from the database on every route because
 * routing must work when the database is degraded, and because a typo in a
 * slug should fail at compile time. 0019 is the source of truth for their
 * identity; this is the source of truth for what the router may name, and
 * `verifyRosterMatchesDatabase` below keeps the two honest.
 */
export const ROLE_SLUGS = [
  'chief-of-staff',
  'research-director',
  'strategy-director',
  'growth-director',
  'finance-director',
  'operations-director',
  'quality-director',
  'communications-director',
] as const

export type RoleSlug = (typeof ROLE_SLUGS)[number]

/**
 * The hard ceiling, matching `routing_decisions_roster_bounded`.
 *
 * `system_config.agents.max_specialists_per_job` holds the tunable 3. This is
 * the number a misread config cannot exceed, which is why it is a constant and
 * not a lookup.
 */
export const ROSTER_CEILING = 5

// ---------------------------------------------------------------------------
// The duplicate scan
// ---------------------------------------------------------------------------

declare const scanBrand: unique symbol

export interface SimilarJob {
  readonly jobId: string
  readonly kind: string
  readonly state: string
  readonly intentClass: string | null
  /** How many of this instruction's terms the live job also has. A count, not a score. */
  readonly matchedTerms: number
  /** The overlapping words themselves, so a human can judge the match. */
  readonly sharedTerms: readonly string[]
}

/**
 * Proof that the duplicate query ran.
 *
 * The brand is unforgeable outside this module, which is the point: it is the
 * ticket `route()` demands, and only `scanForDuplicates` issues tickets.
 */
export interface DuplicateScan {
  readonly [scanBrand]: 'duplicate-scan'
  readonly terms: readonly string[]
  readonly candidates: readonly SimilarJob[]
  /**
   * Live jobs the scan could not see, because they never went through the
   * router and so have no subject terms.
   *
   * Carried on the result rather than logged, because `none_found` means
   * something different at 0 than at 40 and a caller that cannot tell them
   * apart will treat a blind spot as an all-clear.
   */
  readonly unroutedLiveJobs: number
}

/**
 * Words too common to distinguish one piece of work from another.
 *
 * Kept short on purpose. An aggressive stop list makes the scan miss real
 * duplicates, and a missed duplicate is the expensive error - the cheap error
 * is a spurious candidate, which a human glance dismisses.
 */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'if',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'up',
  'about',
  'into',
  'over',
  'after',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'do',
  'does',
  'did',
  'can',
  'could',
  'should',
  'would',
  'will',
  'shall',
  'have',
  'has',
  'had',
  'this',
  'that',
  'these',
  'those',
  'it',
  'we',
  'you',
  'i',
  'me',
  'my',
  'our',
  'your',
  'us',
  'them',
  'they',
  'please',
  'just',
  'now',
  'get',
  'got',
  'need',
  'want',
])

/**
 * Reduce an instruction to the words worth searching on.
 *
 * Deliberately crude: lowercase, split on non-letters, drop stop words and
 * anything under four characters. This is not trying to be a search engine. It
 * is trying to be a net wide enough that "summarise the pricing research" and
 * "what did we find on pricing" share the term `pricing`, which is the case
 * the idempotency key provably cannot catch.
 */
export const searchTerms = (instruction: string): readonly string[] => {
  const seen = new Set<string>()
  for (const raw of instruction.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue
    if (STOP_WORDS.has(raw)) continue
    seen.add(raw)
  }
  return [...seen].slice(0, 12)
}

/**
 * Fallback term for an instruction with no distinctive words in it.
 *
 * `routing_decisions_search_was_performed` requires at least one term, and
 * "ok do it" reduces to none. Recording a marker is honest - the search ran
 * and had nothing to search on - where synthesising a term would fabricate
 * evidence of a query that could not have matched anything.
 */
export const NO_DISTINCTIVE_TERMS = '(no distinctive terms)'

/**
 * Run the required query.
 *
 * Compares this instruction's subject terms against the subject terms of every
 * LIVE routed job. Live only: §5's concern is concurrent duplication, not a
 * deliberate re-run months later - a research job over the same sources should
 * be runnable again next year, and 0005's idempotency index takes the same
 * view for the same reason.
 *
 * The first version of this searched `jobs.idempotency_key` with ILIKE. Since
 * §6 derives that key from semantic inputs - a hash, in practice - it could
 * never have matched, and would have recorded a compliant, constraint-
 * satisfying `none_found` forever. 0021 has the full note. The lesson is the
 * one the POC gates kept teaching: a check that cannot fail is not a check,
 * and a schema can enforce that a search happened without noticing that the
 * search was pointed at the wrong column.
 *
 * It looks only at the CALLER'S OFFICE's jobs (multi-user P3). It used to match on subject terms alone, with the
 * project as an optional narrowing - so an instruction with no project could be "linked to" a live job of ANOTHER
 * office that shared two words with it. The office is the claimed job's (`jobId`), else the project's, else the test
 * office (a harness with neither is harness traffic).
 */
export const scanForDuplicates = async (
  db: SqlExecutor,
  instruction: string,
  options: {
    /** SQL for the office the scan is confined to, when the caller names it (the claimed job's, or a script's). */
    office?: string | undefined
    projectId?: string | undefined
    jobId?: string | undefined
  } = {},
): Promise<DuplicateScan> => {
  const derived = searchTerms(instruction)
  const terms = derived.length > 0 ? derived : [NO_DISTINCTIVE_TERMS]

  const office =
    options.office !== undefined && options.office !== ''
      ? options.office
      : options.jobId !== undefined && options.jobId !== ''
        ? `app.job_office(${lit(options.jobId)}::uuid)`
        : options.projectId !== undefined && options.projectId !== ''
          ? `(select p.office_id from public.projects p where p.project_id = ${lit(options.projectId)}::uuid)`
          : 'app.test_office()'

  const coverage = await db.execute(`select app.unrouted_live_jobs(${office}) as n`)
  const unroutedLiveJobs = Number(coverage.rows[0]?.n ?? 0)

  if (derived.length === 0) {
    // Nothing distinctive to match on. Reported as a scan with no candidates
    // rather than skipped, because the constraint and the audit trail both
    // want the row, and "we looked and had nothing to look for" is a true
    // statement about a real query.
    return scanned({ terms, candidates: [], unroutedLiveJobs })
  }

  const termArray = `array[${terms.map(lit).join(', ')}]::text[]`
  const scopeClause =
    options.projectId === undefined || options.projectId === ''
      ? ''
      : `and j.project_id = ${lit(options.projectId)}::uuid`

  // `&&` is the overlap operator, which the GIN index in 0021 serves. The
  // shared terms are extracted with INTERSECT rather than ranked, because a
  // rank invites a threshold and a threshold invites lowering it when it is
  // inconvenient. "Shares the words pricing, competitor" is a sentence a human
  // can check; "similarity 0.62" is not.
  const { rows } = await db.execute(`
    with shared as (
      select r.job_id,
             array(select unnest(r.subject_terms) intersect select unnest(${termArray})) as terms
      from public.routing_decisions r
      where r.subject_terms && ${termArray}
    )
    select j.job_id::text as job_id, j.kind, j.state::text as state, j.intent_class,
           s.terms::text as shared_terms, cardinality(s.terms) as matched
    from shared s
    join public.jobs j on j.job_id = s.job_id
    where j.office_id = ${office}
      and j.state not in ('complete', 'cancelled', 'failed')
      ${scopeClause}
    order by matched desc, j.created_at desc
    limit 10
  `)

  return scanned({
    terms,
    unroutedLiveJobs,
    candidates: rows.map((r) => ({
      jobId: String(r.job_id),
      kind: String(r.kind),
      state: String(r.state),
      intentClass: r.intent_class === null ? null : String(r.intent_class),
      matchedTerms: Number(r.matched),
      sharedTerms: parsePgTextArray(String(r.shared_terms ?? '{}')),
    })),
  })
}

/**
 * Apply the brand, in one place, on a value the compiler has already checked.
 *
 * `DuplicateScan` carries a private symbol so that only a real scan can be
 * passed where one is required — a caller cannot fabricate the evidence that it
 * looked for duplicates. The cast is how a brand is applied and is not a
 * mistake.
 *
 * It was written inline at both return sites, and there it was indistinguishable
 * from the `as unknown as` that hid six invalid production paths in the
 * handlers. Here the argument is typed, so the fields are checked; only the
 * brand is asserted, which is the one thing that cannot be.
 */
const scanned = (scan: Omit<DuplicateScan, typeof scanBrand>): DuplicateScan =>
  scan as DuplicateScan

/** Postgres renders a text[] as {a,b,c}. Quoted where a value needs it. */
export const parsePgTextArray = (raw: string): readonly string[] =>
  raw
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((s) => s.replace(/^"|"$/g, '').trim())
    .filter((s) => s !== '')

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type DuplicateResolution = 'none_found' | 'linked_to_existing' | 'proceeded_distinct'

export interface RoutingDecision {
  readonly intent: IntentClass
  readonly confident: boolean
  readonly intentReason: string
  readonly searchTerms: readonly string[]
  readonly candidates: readonly SimilarJob[]
  /** Live jobs the scan could not see. `none_found` at 0 is not the same claim as at 40. */
  readonly unroutedLiveJobs: number
  readonly resolution: DuplicateResolution
  readonly linkedJobId: string | null
  readonly distinctJustification: string | null
  readonly roster: readonly RoleSlug[]
  readonly rosterReason: string
  /** True when the right answer is to ask Grant rather than to start work. */
  readonly clarificationNeeded: boolean
}

/**
 * Which roles an intent class justifies, at most.
 *
 * Read as a ceiling, not a prescription: `pickRoster` intersects this with
 * what the request is actually about. Cheap classes map to nobody, which is
 * §9's rule stated as data.
 */
const ROSTER_CEILINGS: Readonly<Record<IntentClass, readonly RoleSlug[]>> = {
  // A remark is a remark. Nobody is convened to hear it.
  thought: [],
  /*
    #230. A question may reach a specialist, but only when the SUBJECT earns it.

    This was `[]` — a question could never convene anybody, by construction —
    and `question` is 237 of the 505 routing decisions this office has ever
    made, the largest class by a distance. So the commonest thing Grant does
    could only ever reach the Chief of Staff, and five of the eight people here
    had never been selected once in the system's history.

    `verify:roster` proved it rather than argued it: eight instructions each
    written for one specific person — a gross-margin question for Daniel, a
    channel question for Ruby, a bottleneck question for Marcus — and every one
    of them went to Claire, with the router logging "question needs no
    specialist" each time.

    The comment that used to sit here said *"answering from what we already hold
    is retrieval, not a meeting"*, and that is TRUE OF SOME QUESTIONS. "What
    documents do we have on this project" is retrieval. "What does a fifteen per
    cent cut to the middle tier do to our gross margin" is a question too, and
    it is the thing a finance director is for. §9's rule was never wrong; the
    equation `question = trivial` was.

    So the ceiling opens to every specialist and `TOPIC_ONLY` below makes them
    earn it — the intersection with the subject matter is what decides, and a
    question that names no subject still goes to Claire exactly as before.
  */
  question: [
    'finance-director',
    'growth-director',
    'communications-director',
    'operations-director',
    'quality-director',
    'research-director',
    'strategy-director',
  ],
  /*
    #232, and it is #230's defect a third time.

    These five lists predate half the roster, and a ceiling is a HARD gate: the
    roster is the intersection of the ceiling with the subject, so a specialist
    missing from the list cannot be reached however clearly the request names
    them. `direct_command` was research, strategy and operations — so *"Draft
    the announcement email for the pricing change"* named the communications
    director, was refused by this table, and fell to `ceiling[0]`. Six of the
    corpus's eleven communications cases went to the research director that
    way, which is worse than going to Claire: the wrong specialist answers
    confidently.

    So each list opens to everyone the class could plausibly need, and the
    SUBJECT decides within it — which is the same correction #230 made to
    `question`, and it is safe for the same reason. The first entry of each is
    unchanged, because that is what an unclassifiable request of this class
    still falls back to.
  */
  discussion: [
    'strategy-director',
    'finance-director',
    'growth-director',
    'communications-director',
    'operations-director',
    'quality-director',
    'research-director',
  ],
  suggestion: [
    'strategy-director',
    'finance-director',
    'growth-director',
    'communications-director',
    'operations-director',
    'quality-director',
    'research-director',
  ],
  light_investigation: [
    'research-director',
    'finance-director',
    'growth-director',
    'communications-director',
    'operations-director',
    'quality-director',
    'strategy-director',
  ],
  assignment: [
    'research-director',
    'strategy-director',
    'operations-director',
    'finance-director',
    'growth-director',
    'communications-director',
    'quality-director',
  ],
  direct_command: [
    'research-director',
    'strategy-director',
    'operations-director',
    'finance-director',
    'growth-director',
    'communications-director',
    'quality-director',
  ],
}

/**
 * Intents where a specialist must be EARNED by the subject matter (#230).
 *
 * For every other class, an unmatched topic still takes `ceiling[0]` — an
 * unclassifiable assignment is work, and somebody has to hold it. For these,
 * an unmatched topic means NOBODY, and the Chief of Staff picks it up as she
 * always did.
 *
 * That asymmetry is the whole safety of opening `question` up. Without it,
 * every "what documents do we have" would convene a finance director on the
 * strength of being first in a list, which is worse than the defect being
 * fixed and would show up as cost and latency on the commonest message Grant
 * sends.
 */
const TOPIC_ONLY: ReadonlySet<IntentClass> = new Set<IntentClass>(['question'])

/** Subject-matter hints, so a roster is about the work and not just its class. */
const TOPIC_ROLES: readonly { readonly role: RoleSlug; readonly pattern: RegExp }[] = [
  {
    role: 'finance-director',
    pattern:
      /\b(cost|costs|pricing|prices|price|budget|budgets|revenue|margin|margins|forecast|forecasts|spend)\b/i,
  },
  {
    role: 'growth-director',
    pattern:
      /\b(marketing|positioning|messaging|audience|audiences|campaign|campaigns|channel|channels|launch|demand|brand)\b/i,
  },
  {
    role: 'communications-director',
    pattern: /\b(write|draft|copy|announcement|email|post|blog|wording)\b/i,
  },
  {
    role: 'operations-director',
    pattern: /\b(process|schedule|capacity|sequence|rollout|deadline|staffing)\b/i,
  },
  {
    role: 'research-director',
    pattern: /\b(research|evidence|sources?|compare|competitors?|benchmarks?|study|studies)\b/i,
  },
]

/**
 * Choose the smallest roster the work justifies.
 *
 * Intersection, not union: the class sets a ceiling and the topic decides
 * which of those roles are relevant. A union would let one keyword pull a
 * finance director into a passing thought, which is the "simple factual
 * retrieval is not a team meeting" failure with extra steps.
 *
 * Quality review is deliberately absent. §10's reviewer is not a routing
 * choice — it applies to substantive output whether or not the router thought
 * of it, and the 0018 trigger enforces that regardless of what is decided
 * here.
 */
/*
  Who the subject names, from the database when it answered and from this
  file's regexes when it did not.

  One definition, two callers — the unrecognised branch below and the ordinary
  intersection after it. CLAUDE.md: a list built twice is a list that will
  disagree.
*/
const subjects = (
  topical: readonly RoleSlug[] | undefined,
  instruction: string,
): readonly RoleSlug[] =>
  topical ?? TOPIC_ROLES.filter((t) => t.pattern.test(instruction)).map((t) => t.role)

export const pickRoster = (
  classification: Classification,
  instruction: string,
  /*
    Who the roster says knows about this, in rank order.

    Passed in rather than looked up here, because the lookup is a database call
    and this function is pure — which is what makes every routing rule in it
    testable without a database. Omitted, it falls back to `TOPIC_ROLES`.

    Issue #65. `TOPIC_ROLES` is five regexes in this file and it has routed
    correctly for months; it is also the one thing Grant cannot change. He is
    building a dashboard to *"look at each agent, what their skill sets are,
    and adjust and add and refine"*, and a regex in TypeScript is not
    adjustable. `app.who_knows_about` reads `staff.expertise`, which is a
    column he edits, and 0201 moved this file's vocabulary into it.

    The hardcoded list stays as the fallback rather than being deleted: if the
    database is unreachable or an expertise column is emptied by mistake,
    routing degrades to what it did yesterday instead of to nothing.
  */
  topical?: readonly RoleSlug[],
  /*
    Who works on THIS project (#36, migration 0323).

    Grant can take a specialist off a project in Settings, and the Issue asks
    for that to take effect rather than merely to be stored — a setting nothing
    reads is #64 with the sign reversed, and being told YES about something
    that does not happen is the expensive direction.

    Passed in for the same reason `topical` is: this function is pure, and
    every routing rule in it stays testable without a database. Omitted means
    no restriction, which is what a project with no decisions recorded against
    it deserves and what every caller that has no project should get.
  */
  onProject?: readonly RoleSlug[],
): { readonly roster: readonly RoleSlug[]; readonly reason: string } => {
  const here = (r: RoleSlug): boolean => onProject === undefined || onProject.includes(r)

  /*
    Text no rule understood, whose subject is nonetheless clear (#232).

    This is #230's defect one layer up. `classifyIntent` falls back to
    `thought` for anything its regexes do not cover, `thought`'s ceiling is
    empty, and the early return below therefore discarded a correctly
    identified specialist before the subject was ever consulted. Measured over
    the 91-case corpus, every phrasing that describes a subject without naming
    it — vague, colloquial, spoken — scored 0%, and *"Run the numbers if we
    sell it cheaper"* was one of them.

    `recognised` is what makes this safe to open. A DELIBERATE remark — "fyi",
    "just thinking", "note to self" — is recognised, keeps the empty ceiling
    and still convenes nobody, which is what §9 is actually about. Only text
    nothing understood reaches this branch.

    **One person, never a team**, and never on a guess: the subject must be
    named by `topical`, and nothing here falls back to `ceiling[0]`. That is
    §6 resolving ambiguity downward, and it is also the shape
    `routing_decisions_unconfident_stays_small` requires of the row — an
    unrecognised request is by definition not confident.
  */
  if (!classification.recognised) {
    const named = subjects(topical, instruction).filter(here)
    const one = named[0]
    return one === undefined
      ? {
          roster: [],
          reason:
            'no intent rule matched this and nothing in it names a subject area, ' +
            'so the Chief of Staff has it',
        }
      : {
          roster: [one],
          reason:
            'no intent rule matched this, but the subject is clearly ' +
            `${one.replace('-director', '')} — one specialist, because an unrecognised ` +
            'request is not evidence that a team is needed',
        }
  }

  const ceiling = ROSTER_CEILINGS[classification.intent].filter(here)
  if (ceiling.length === 0) {
    /*
      Two different empties, and saying which is the whole value of the line.

      A `thought` convenes nobody because §9 says trivial work spawns no
      subagents. An `assignment` on a project Grant has taken every specialist
      off ALSO convenes nobody, and reporting that as "trivial work" would
      hide his own setting from him in the one place he would look for it.
      Either way the Chief of Staff picks it up, which is what an empty roster
      means everywhere else in this system.
    */
    const wasFull = ROSTER_CEILINGS[classification.intent].length > 0
    return {
      roster: [],
      reason: wasFull
        ? `${classification.intent} would normally go to ` +
          `${ROSTER_CEILINGS[classification.intent].join(', ')}, and none of them are on ` +
          'this project, so the Chief of Staff has it'
        : `${classification.intent} needs no specialist (§9: trivial work spawns no subagents)`,
    }
  }

  if (!classification.confident) {
    /*
      #230. For a TOPIC_ONLY class, a contested reading convenes NOBODY.

      Taking `ceiling[0]` here would hand every ambiguous question to the
      finance director purely for being first in the list — the ceiling is now
      seven roles wide rather than empty, so the old line would have turned a
      fix into a much noisier bug. §6 resolves ambiguity downward and the
      floor for a question is the Chief of Staff.
    */
    /*
      Contested, so at most ONE person either way — and the subject picks them.

      §6 resolves ambiguity downward and a team convened off a maybe is the
      uncontrolled workload Phase 5 rules out. One agent may ask; a committee
      may not. Mirrors `routing_decisions_unconfident_stays_small`.

      Which one, though, is a question the old code answered twice and badly.
      For a TOPIC_ONLY class it took nobody even when the subject was
      unmistakable — *"Talk me out of doing this. What am I missing?"* names
      the quality director and reads as both a question and a discussion, so it
      went to Claire for being AMBIGUOUS rather than for being unclear. For
      every other class it took `ceiling[0]`, ignoring the subject entirely and
      handing a contested finance request to the research director for being
      first in a list.

      Both are the same mistake: an uncertain READING is not an uncertain
      SUBJECT. Take the person the subject names; fall back to `ceiling[0]`
      only where an unnamed subject still has to go to somebody, which is every
      class except the TOPIC_ONLY ones.
    */
    const named = subjects(topical, instruction).filter((r) => ceiling.includes(r))
    const one = named[0] ?? (TOPIC_ONLY.has(classification.intent) ? undefined : ceiling[0])
    const contested = `the reading was contested (${classification.considered.join(' or ')})`
    if (one === undefined) {
      return {
        roster: [],
        reason:
          `${contested}, and a ${classification.intent} only convenes a specialist when the ` +
          'subject is clear, so the Chief of Staff has it',
      }
    }
    return {
      roster: [one],
      reason:
        `${contested}, so one specialist — ` +
        (named[0] === undefined
          ? 'nothing named a subject, so the first of the class'
          : `the request is about ${one.replace('-director', '')}`) +
        ' — rather than a team on a guess',
    }
  }

  const fromRoster = subjects(topical, instruction)
  /*
    Ordered by the SUBJECT, not by the ceiling (#231).

    `ceiling` is already filtered to who is on the project, so either
    direction carries that restriction — but the direction decides WHO
    ANSWERS, because `handlers/instruction.ts` takes `roster[0]` as the
    speaker and hands the rest the work as subagents.

    Written the other way round, the hardcoded ceiling list picked. Held-out
    acceptance traffic found it twice in nine turns: *"Draft the announcement
    copy for the tier change"* was ranked communications, growth by
    `who_knows_about` — correctly, "announcement", "copy" and "draft" are all
    in the communications director's expertise — and `light_investigation`'s
    ceiling lists growth before communications, so Ruby answered. *"Audit the
    refund policy for compliance risk"* ranked quality first and went to
    research the same way.

    The ceiling is a GATE. It says who this class of request may reach; it has
    never had an opinion about which of them is most apt, and the list's order
    is an artefact of how it was typed. `who_knows_about` returns a ranking,
    from Grant's own expertise columns, and it was being thrown away.

    #230 and #232 both fixed a version of "the ceiling's first entry decided",
    for the empty case and the unconfident case. This is the third and it is
    the ordinary one. The unconfident branch above already reads
    subject-first, so the two branches now agree.
  */
  const chosen = fromRoster.filter((r) => ceiling.includes(r))

  /*
    Nothing topical matched.

    For most classes: take the single cheapest-to-justify role from the ceiling
    rather than all of it. An unclassifiable assignment is still work, but it is
    not evidence that everyone is needed.

    For a TOPIC_ONLY class (#230): take NOBODY. A question that names no subject
    area is the retrieval the original comment was right about, and it goes to
    the Chief of Staff exactly as it did before this change.
  */
  /*
    Nobody, for every class — the fourth and last instance of "the ceiling's
    first entry decided" (#249).

    This used to read `topicOnly ? [] : [ceiling[0]]`, so a confident
    assignment that named no subject went to whoever happened to be typed
    first in the class's list. The comment forty lines above says it outright:
    the ceiling is a GATE, it has never had an opinion about which of its
    members is most apt, and the list's order is an artefact of how it was
    typed. Taking the first of it is that artefact deciding who answers.

    #230 fixed this for the empty case, #232 for the unconfident case, #231 for
    the ordinary intersection. This is the remaining one, and it was
    unreachable until #249 taught the classifier to recognise instructions it
    had no phrase for — "Sort that out for me when you get a chance" was an
    unrecognised remark before, and became a confident assignment with no
    subject.

    An empty roster is not a refusal. It means the Chief of Staff has it, which
    is what it means everywhere else here, and she is the right answer to an
    instruction whose subject nobody can name.
  */
  const roster = chosen

  return {
    roster: roster.slice(0, ROSTER_CEILING),
    reason:
      chosen.length > 0
        ? `${classification.intent} permits ${ceiling.join(', ')}; the request is about ${fromRoster.join(', ')}, so the intersection was taken in that order of fit`
        : `${classification.intent} permits ${ceiling.join(', ')}, and nothing in the request names a subject area, so the Chief of Staff has it rather than whoever is first in that list`,
  }
}

/**
 * Route an instruction.
 *
 * `scan` is required and unforgeable. That is the enforcement; everything else
 * in this function is judgement.
 */
export const route = (
  instruction: string,
  scan: DuplicateScan,
  options: {
    readonly linkTo?: string
    readonly justification?: string
    /** From `app.who_knows_about`. See `pickRoster`. */
    readonly topical?: readonly RoleSlug[]
    /** From `app.staff_on_project`. See `pickRoster`. */
    readonly onProject?: readonly RoleSlug[]
  } = {},
): RoutingDecision => {
  const classification = classifyIntent(instruction)
  const clarify = needsClarification(classification)

  const { roster, reason } = clarify
    ? {
        // Clarification is not work, so it convenes nobody. Phase 5's
        // acceptance offers "a bounded investigation OR a clarification"; when
        // the reading is bad enough to need asking, asking is the bounded one.
        roster: [] as readonly RoleSlug[],
        reason:
          'the reading was too uncertain to act on, so the decision is to ask ' +
          'rather than to convene anyone',
      }
    : pickRoster(classification, instruction, options.topical, options.onProject)

  let resolution: DuplicateResolution = 'none_found'
  let linkedJobId: string | null = null
  let distinctJustification: string | null = null

  if (scan.candidates.length > 0) {
    if (options.linkTo !== undefined && options.linkTo !== '') {
      resolution = 'linked_to_existing'
      linkedJobId = options.linkTo
    } else {
      resolution = 'proceeded_distinct'
      distinctJustification =
        options.justification ??
        // A default that is honest about being a default. The alternative was
        // to throw, but a router that refuses to route because a caller did
        // not explain itself fails closed in the wrong direction: the work
        // still needs doing and the explanation can be reviewed.
        `similar live work exists (${scan.candidates
          .map((c) => `${c.jobId.slice(0, 8)} matched ${String(c.matchedTerms)} term(s)`)
          .join('; ')}), but no caller justification was supplied. Recorded as ` +
          'distinct so the decision is reviewable rather than invisible.'
    }
  }

  return {
    intent: classification.intent,
    confident: classification.confident,
    intentReason: classification.reason,
    searchTerms: scan.terms,
    candidates: scan.candidates,
    unroutedLiveJobs: scan.unroutedLiveJobs,
    resolution,
    linkedJobId,
    distinctJustification,
    roster,
    rosterReason: reason,
    clarificationNeeded: clarify,
  }
}

/**
 * Persist a decision. Insert only — 0020 revokes update.
 */
export const recordDecision = async (
  db: SqlExecutor,
  jobId: string,
  decision: RoutingDecision,
  delegationDepth = 0,
): Promise<string> => {
  const arr = (xs: readonly string[]): string =>
    xs.length === 0 ? `'{}'::text[]` : `array[${xs.map(lit).join(', ')}]::text[]`

  // raw-sql[2]: keyed by the claimed job; routing_decisions has no office column, its office is its job's (composite key).
  const { rows } = await db.execute(`
    insert into public.routing_decisions
      (job_id, intent_class, confident, intent_reason,
       subject_terms, duplicate_candidates, duplicate_resolution,
       linked_job_id, distinct_justification, roster, roster_reason, delegation_depth)
    values
      (${lit(jobId)}::uuid, ${lit(decision.intent)}, ${String(decision.confident)},
       ${lit(decision.intentReason)},
       ${arr(decision.searchTerms)},
       ${lit(JSON.stringify(decision.candidates))}::jsonb,
       ${lit(decision.resolution)}::public.duplicate_resolution,
       ${decision.linkedJobId === null ? 'null' : `${lit(decision.linkedJobId)}::uuid`},
       ${decision.distinctJustification === null ? 'null' : lit(decision.distinctJustification)},
       ${arr(decision.roster)}, ${lit(decision.rosterReason)}, ${String(delegationDepth)})
    returning decision_id::text as decision_id
  `)
  return String(rows[0]?.decision_id)
}

/**
 * Check that `ROLE_SLUGS` still matches the seeded roles.
 *
 * The constant above buys compile-time safety at the price of a second copy,
 * and a second copy drifts. This is the thing that notices — called by the
 * live verification script rather than by the router, because a routing
 * decision must not depend on a round trip to confirm a constant.
 */
export const verifyRosterMatchesDatabase = async (
  db: SqlExecutor,
): Promise<{ readonly ok: boolean; readonly missing: string[]; readonly extra: string[] }> => {
  const { rows } = await db.execute(
    `select slug from public.staff where permanent and active order by slug`,
  )
  const inDb = new Set(rows.map((r) => String(r.slug)))
  const missing = ROLE_SLUGS.filter((s) => !inDb.has(s))
  const extra = [...inDb].filter((s) => !(ROLE_SLUGS as readonly string[]).includes(s))
  return { ok: missing.length === 0 && extra.length === 0, missing, extra }
}

/** Cheapest-first ordering, for reporting. Reuses §6's ladder. */
export const byCost = (a: IntentClass, b: IntentClass): number => INTENT_COST[a] - INTENT_COST[b]
