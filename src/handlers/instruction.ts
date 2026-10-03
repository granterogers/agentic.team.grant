/**
 * Carrying out an instruction that arrived on a surface.
 *
 * Grant: *"I want to be able to communicate with them in Telegram, tell them
 * what to do, and those commands are relayed and actions are carried out."*
 *
 * The inbound path used to end at a table. `inbound_commands` had a writer and,
 * for text, no consumer — so a message to a bot was stored and nothing
 * happened, which from the outside is exactly what a broken bot looks like.
 * This is the consumer.
 *
 * ## Who answers
 *
 * Whoever was written to. Opening `@atg_research_bot` addresses Ines, and 0072
 * records that as `addressed_to` — the router treats it as the roster rather
 * than classifying one, because choosing whose bot to open is a clearer signal
 * than any classifier could extract from the text, and overriding it would make
 * the choice of bot decorative.
 *
 * When the message went to the Chief of Staff bot there is no `addressed_to`,
 * and then the router does decide: that is what a chief of staff is for.
 *
 * ## Spoken instructions
 *
 * A voice note arrives with no words in it: `voice_file_id` and nothing else.
 * The first thing this handler does is turn it into words, on our own hardware
 * (`src/voice/inbound.ts`), record them against the command, and then carry on
 * exactly as though Grant had typed them.
 *
 * The second thing it does is send the words back, before acting on them. This
 * reverses the original instruction, and the reason is worth keeping: he said
 * *"I don't need to see the transcription"* and then, later, *"I want to see the
 * transcription immediately... I want to check if it's simply a transcription
 * problem or if it's just too stupid to understand what I'm saying."*
 *
 * Between those two sentences, Whisper turned "a new NotebookLM project" into
 * "a new Not-to-But project" and the Chief of Staff answered a question nobody
 * had asked. The old reasoning — that the answer is evidence enough of being
 * heard — is only true while transcription is right; the moment it is wrong,
 * a wrong answer with no visible input is indistinguishable from a stupid
 * colleague.
 *
 * ## Links
 *
 * Grant: *"rather than me necessarily having to go into the front end, I can
 * just send the Chief of Staff either on Telegram or on Slack a link… he'd have
 * to obviously be smart enough to know to which project are we uploading it."*
 *
 * `src/agents/links.ts` reads the link; this file decides which project it
 * belongs to and does the work. The project question has exactly three
 * answers and one of them is a question back: named in the message, or the
 * only active one, or *"which project?"* — never a guess between two, because
 * a source filed into the wrong project is invisible. It is present, it is
 * searchable, and it quietly answers questions about the wrong thing.
 *
 * ## Answering is not the same as doing
 *
 * The first version of this file could only answer. Asked to *"generate an
 * audio overview in our Google notebook"*, the Chief of Staff wrote a paragraph
 * about what an audio overview might contain — a perfect answer to a question
 * nobody asked. `src/agents/actions.ts` reads the instruction for the artifacts
 * it asks for; this file starts them, as child jobs, and says so in one
 * sentence instead of pretending to have done the work in prose.
 *
 * The confirmation is deterministic on purpose. It is a statement about what
 * just happened in the queue, and generating it with a model would put a
 * paraphrase between Grant and a fact.
 *
 * ## The reply goes back where the instruction came from
 *
 * Same chat, same bot, in that person's voice. A reply from the pager to a
 * message sent to Ines would be a colleague answering through a switchboard.
 */

import {
  artifactListing,
  artifactRequest,
  KIND_LABEL,
  notebookRequest,
  type RequestedKind,
} from '../agents/actions.ts'
import type { AnotherGo } from '../agents/again.ts'
import { alreadyPursuing } from '../agents/already.ts'
import {
  capabilityBrief,
  capabilityNow,
  contradictsReality,
  EMPTY_CAPABILITY,
  toolNames,
} from '../agents/capability.ts'
import { capabilityLies } from '../agents/capability-claims.ts'
import { clauses, split } from '../agents/clauses.ts'
import { heldToWhatIsQueued } from '../agents/commitment.ts'
import type { Correction } from '../agents/correction.ts'
import { cleanDictation } from '../agents/dictation.ts'
import { assignedTo, dueOn, withoutTheDate } from '../agents/due.ts'
import { entitled as allEntitled, noneEntitled } from '../agents/entitled.ts'
import { ownTask } from '../agents/own-task.ts'
import { projectWorkSpine, readProjectWork } from '../agents/project-work.ts'
import { sentencesOf } from '../agents/sentences.ts'

const entitled = allEntitled

import { asksAboutHisOwnList, extractionRequest } from '../agents/extract.ts'
import { answerOutranks, decideEarlyGate, type EarlyGate } from '../agents/gates.ts'
import { type Capability, planFor, planningCatalogue } from '../agents/goal.ts'
import { guidanceBrief, guidanceFor, recordSkillUse } from '../agents/guidance.ts'
import { type Handoff, handoffIn } from '../agents/handoff.ts'
import { classifyIntent } from '../agents/intent.ts'
import { type FoundLink, LINK_LABEL, type LinkRequest } from '../agents/links.ts'
import {
  personalTaskChange,
  personalTaskRequest,
  pickByName,
  subtaskRequest,
  taskStateChange,
} from '../agents/mine.ts'
import { groundedIn, namedColleague } from '../agents/named.ts'
import {
  asksWhatWasSaid,
  closesWithoutAsking,
  rejectsWithoutSaying,
  withoutNegated,
} from '../agents/negation.ts'
import type { CanonicalOutcome } from '../agents/outcome.ts'
import { contractFor, sayWhatHappened } from '../agents/outcome.ts'
import { join, PAIRING_WINDOW_MINUTES, readFragment } from '../agents/pairing.ts'
import { performable } from '../agents/perform.ts'
import {
  createsSomething,
  describePlan,
  needsGrantToChoose,
  type Plan,
  type Step,
} from '../agents/plan.ts'
import {
  type Context,
  complete,
  consulted,
  established,
  howComposed as howComposedFrom,
  provenanceNote,
} from '../agents/provenance.ts'
import { remember } from '../agents/remember.ts'
import { asksForWork } from '../agents/request.ts'
import { readRetraction } from '../agents/retraction.ts'
import { recordDecision, route, scanForDuplicates } from '../agents/router.ts'
import { SET_ASIDE_LINE } from '../agents/say-what-you-dropped.ts'
import { optionFor } from '../agents/spoken-answer.ts'
import { nameSubjects } from '../agents/subject.ts'
import {
  NEEDS_A_TITLE,
  resolveElliptical,
  type TaskRequest,
  taskRequest,
  taskTitle,
  titleReply,
  wantsAntecedent,
} from '../agents/tasks.ts'
import { strongestTeaching } from '../agents/teaching.ts'
import { resolveAgainstThread } from '../agents/thread.ts'
import {
  type AnswerClause,
  answerClause,
  asHumanWords,
  buildTurn,
  keptOf,
  retractionOf,
} from '../agents/turn.ts'
import { oneReading, type ReadingKind, understand } from '../agents/understand.ts'
import { asksWhatTheyFound, asksWhoIsOnIt } from '../agents/whoison.ts'
import { DeliveryService } from '../channels/delivery.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { callerArgs } from '../jobs/fence.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import {
  awaiting,
  contextBlock,
  correspondence,
  coverageNote,
  coverageOf,
  type MailCoverage,
  mailBlock,
  mailRefs,
  retrieveAcrossOffice,
  sourceRefs,
  waitingBlock,
} from '../knowledge/retrieval.ts'
import { NotebookActions } from '../notebook/actions.ts'
import { currentPerson } from '../office/person.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { TelegramClient } from '../telegram/api.ts'
import { escapeHtml } from '../telegram/message.ts'
import { BOT_FOR_INBOUND } from '../telegram/roster.ts'
import { TelegramTransport } from '../telegram/transport.ts'
import { scrub, scrubbedToNothing } from '../text/scrub.ts'
import {
  fetchTelegramAudio,
  readTranscriber,
  transcribeOverApi,
  transcribeTelegramVoice,
  VoiceNoteError,
} from '../voice/inbound.ts'
import { allowance, describe, officeOfJob } from './meter.ts'

/**
 * The host, for saying out loud. Never the whole url.
 *
 * "Opening https://supplier.example.com/orders/october?token=..." in a Telegram
 * message puts a query string — which can carry a token — into a channel, a
 * notification and a screenshot. The host is what a person needs to know they
 * are about to be read something from.
 */
function hostForSaying(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'that page'
  }
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * Work out what a goal actually requires, and start it as durable work (#283).
 *
 * ## Why this lives BELOW the cascade rather than beside it
 *
 * Two things deciding what a turn does is two things that will disagree, and
 * the disagreement is invisible: both halves right alone. So the planner runs
 * only where every recogniser above declined — today those turns produce prose
 * and nothing else, which makes this strictly additive and makes a regression
 * of the #282 semantic contract impossible by construction rather than by
 * assertion.
 *
 * ## A plan is a proposal. It is never an authorization.
 *
 * `validate` has already refused anything at level 3 and anything the registry
 * does not grant. This adds the second question, which is a different one:
 * **is there code that performs it.** A plan made entirely of capabilities
 * nothing executes would announce work and deliver a list of impediments, so
 * it is not started at all and the turn answers as it does today. The external
 * human-contact rule is untouched — nothing here performs one, and a step that
 * named one would become an honest impediment rather than a message.
 *
 * Two steps is the floor because one step is precisely what the cascade above
 * is for. The value the planner adds is composition, and nothing else.
 *
 * Returns the line to put in the confirmation, or null to leave the turn
 * exactly as it is today.
 */
export const planAndPursue = async (
  db: SqlExecutor,
  router: ProviderRouter,
  job: Job,
  request: string,
  /*
    WHETHER HE AUTHORISED ANOTHER ATTEMPT -- DECIDED UPSTREAM, FROM HIS WORDS.

    `request` is `goalAsHeSaidIt`, which is named for what it is MOSTLY: the
    resolved instruction, because a plan needs the referent expanded. That
    makes it the wrong text to re-derive this from, and re-deriving it here is
    how a model paraphrase could turn off `enqueue_child_once` -- the
    structural guarantee that two messages 120ms apart cannot both start work.
    The caller has already read his own pre-rewrite sentence; it passes the
    answer rather than the text, so there is one decision and it cannot drift.

    The default keeps the older behaviour for a caller that has no such
    reading of its own.
  */
  deliberately: AnotherGo | null,
): Promise<string | null> => {
  const canDo = new Set(performable())
  const [granted, roster] = await Promise.all([
    planningCatalogue(db),
    db
      .execute(
        `select slug, coalesce(title, '') as title, coalesce(name, '') as name
           from public.staff where active order by slug`,
      )
      .then(({ rows }) =>
        rows.map((r) => {
          const row = r as { slug?: unknown; title?: unknown; name?: unknown }
          return {
            slug: String(row.slug ?? ''),
            title: String(row.title ?? ''),
            name: String(row.name ?? ''),
          }
        }),
      ),
  ])
  /*
    The registry says what is ALLOWED and `performable()` says what has code
    behind it. Two different questions (0298), joined here rather than in
    either half — `goal.ts` must not import the executors and `perform.ts`
    must not build the catalogue, or the two gates become one.
  */
  const catalogue: readonly Capability[] = granted.map((c) => ({
    ...c,
    performable: canDo.has(c.tool),
  }))
  const plan = await planFor(request, catalogue, roster, router, {
    jobId: job.jobId,
    correlationId: job.correlationId,
  })

  const doable = plan.steps.filter((s) => canDo.has(s.capability))
  if (plan.steps.length < 2 || doable.length === 0) return null

  /*
    ONCE PER OBLIGATION (#316, 0556).

    Measured on Grant's REAL Telegram chat: "Write me a PDF report on where
    the Legacy Coaching…" at 08:05:27 and the identical sentence at 08:08:37,
    two children, two PDFs into his real project. On genuinely delivered real
    traffic, 57 of 290 message pairs within two hours are near-duplicates —
    this is how a person behaves when an answer has not arrived yet, not an
    edge case.

    `jobs_one_live_per_idempotency_key` has always been able to refuse this and
    `app.enqueue_child` defeated it with `gen_random_uuid()`. The insert IS the
    check, so two messages 120ms apart cannot both get through — proved with
    eight concurrent equivalent requests, which produced one child and told
    the other seven the truth.
  */
  /*
    DID HE ASK FOR ANOTHER GO ON PURPOSE?

    #316's invariant has a clause: unless he clearly asks for another
    independent attempt. This is the only thing that AUTHORISES duplication,
    so it is deterministic and narrow — a miss costs him one more sentence
    while the office stays honest about what is running; a false positive
    spends the model twice and produces two answers to one question.
  */
  const deliberate = deliberately

  /*
    THE REPHRASED CASE IS DECIDED ABOVE, ONCE.

    An earlier version asked here as well. `planAndPursue` runs AFTER the
    roster hand-off, so the two could disagree — and did: on a repeated
    request the office convened a specialist and then said it had not started
    anything a second time. One decision, one place. What remains here is the
    STRUCTURAL guarantee, which is free and cannot be raced.
  */
  const handed = await db
    .execute(`
      select ${deliberate === null ? 'app.enqueue_child_once' : 'app.enqueue_child'}(
        app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'office.pursue',
        ${
          deliberate === null
            ? `${lit(request.slice(0, 2000))},
        jsonb_build_object('plan', ${lit(JSON.stringify(plan))}::jsonb)`
            : `jsonb_build_object(
          'plan', ${lit(JSON.stringify(plan))}::jsonb,
          'request', ${lit(request.slice(0, 2000))}
        ), interval '0', true`
        }${callerArgs(job)}
      ) as r`)
    .then((r) => {
      const raw = (r.rows[0] as { r?: unknown })?.r
      /*
        `enqueue_child` returns a bare uuid and `enqueue_child_once` returns
        an object. A deliberate second attempt always created something, by
        definition — that is what taking the other door means.
      */
      if (deliberate !== null) return { created: true }
      return (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        created?: boolean
        job_id?: string
      } | null
    })

  /*
    THE CHILD THIS JOB'S OWN EARLIER ATTEMPT MADE IS NOT SOMEBODY ELSE'S
    (ledger R31). A retry of this same job reaches enqueue_child_once with the
    same obligation key, finds the pursuit its first attempt started, and was
    answered "That is already in hand - I handed exactly this on a moment
    ago" - in a brand-new chat, about a request made once. It is this
    request's own work, so it is described as this request's plan.
  */
  const ownEarlierAttempt =
    handed?.created === false && typeof handed.job_id === 'string'
      ? await db
          .execute(
            `select parent_job_id::text as p from public.jobs
              where job_id = ${lit(handed.job_id)}::uuid
                and office_id = app.job_office(${lit(job.jobId)}::uuid)`,
          )
          .then((r) => String((r.rows[0] as { p?: string } | undefined)?.p ?? '') === job.jobId)
          .catch(() => false)
      : false

  /*
    ALREADY RUNNING IS SAID, NOT SILENTLY REPEATED AND NOT SILENTLY DROPPED.

    The second reply used to be the first one word for word, with no mention
    that the office had handed the same work on ninety seconds earlier. Going
    quiet instead would be worse: he asked twice because the first answer had
    not arrived.
  */
  if (handed?.created === false && !ownEarlierAttempt) {
    return (
      'That is already in hand — I handed exactly this on a moment ago and it ' +
      'is still running, so I have not started it a second time. ' +
      'Say the word if you want somebody else to take a separate look.'
    )
  }

  /*
    WHAT IT SAYS IT WILL DO, NOT WHAT IT HAS DONE.

    Nothing has run yet, so every verb here is future tense and the receipts
    come from `office.pursue` when the steps actually produce them. #259's
    rule: never claim a thing happened unless canonical state proves it.
  */
  const steps = plan.steps
    .map((s, i) => `${String(i + 1)}. ${s.why === '' ? s.capability : s.why}`)
    .join('\n')
  return `${plan.goal === '' ? 'Taking that on' : plan.goal} — in ${String(plan.steps.length)} steps:\n${steps}\n\nI will come back with what each one actually found.`
}

/**
 * The dashboard projects, as one sentence of canonical state (#231, ADR-0024).
 *
 * ## Why a RESERVED project is not one of Grant's projects
 *
 * Asked *"what projects do we have open at the moment?"* the office answered
 * *"Here are the five open projects: 1. Unnamed, 2. AI Team HQ Test, …"*. He
 * has four. The fifth is `unnamed`, the reserved bucket ADR-0024 created so a
 * Telegram message naming no project lands somewhere rather than nowhere — he
 * confirmed that one project and nothing else.
 *
 * `projects.reserved_reason` exists to mark exactly that, is correctly set on
 * that row, and **was read by nothing anywhere in the product**. A column
 * recording a distinction no reader honours is the dial-with-no-reader
 * defect, and here it put a wrong count in a sentence about the office's own
 * spine.
 *
 * It is named rather than hidden: *"what has ended up in the unnamed
 * project?"* is a fair question and an answer that cannot see the row cannot
 * field it.
 *
 * ## Stated as a FACT, not as an order
 *
 * The first version ended *"…so do not count it as a project or offer it as
 * one unless he asks about it directly."* Driving the same three questions
 * before and after, the count went right and **two of three answers got
 * worse** — *"What projects do we have open?"* came back *"I have nothing on
 * it here"* from a prompt listing all four. A negative imperative sitting next
 * to the data it is about invites a model to over-obey it.
 *
 * A sentence the model must obey is one it can over-obey. A sentence it
 * merely has to read is not.
 */
export function projectSpine(
  rows: readonly { readonly name: string; readonly reserved: boolean }[],
): string {
  const open = rows.filter((p) => !p.reserved).map((p) => p.name)
  const held = rows.filter((p) => p.reserved).map((p) => p.name)
  if (open.length === 0 && held.length === 0) return ''
  return (
    `The dashboard projects open right now, ${String(open.length)} of them: ${open.join(', ')}.` +
    (held.length === 0
      ? ''
      : ` There is also a reserved place called ${held.join(', ')}, where anything that names ` +
        'no project lands. It is not one of his projects and is not included in that count.')
  )
}

/** One of Grant's own to-dos, as `app.my_tasks` returns it. */
interface HisTask {
  readonly title: string
  readonly due_on: string | null
  readonly overdue: boolean
}

/**
 * His own to-do list, as canonical state (#282, anchor A).
 *
 * ## The half of anchor A that the split alone does not fix
 *
 *   > "I've told you to always give your information in the form of clear
 *   > bullet points. Also, I want you to tell me what my current tasks are."
 *
 * Separating the two clauses makes the question reach the answering path. It
 * does not make it ANSWERABLE: this handler supplied documents, mail and the
 * project spine and **nothing at all about `public.tasks`**, so the honest
 * reply to "what are my current tasks" was that the office could not see them
 * — and the dishonest one, which `provenance.ts` exists to stop, was a list
 * made up out of the conversation.
 *
 * `projectSpine` is the precedent and the argument is identical: do not solve
 * fabrication by making the office incapable. Supplying the list makes the
 * honest answer and the useful answer the same sentence.
 *
 * ## Stated as a fact, never as an instruction
 *
 * `projectSpine` measured this and it cost two of three answers: a negative
 * imperative beside the data it is about invites a model to over-obey it. So
 * there is no "do not invent" here. The list is either accurate or it says
 * there is nothing on it, and both are facts.
 *
 * ## Named buckets only
 *
 * `app.my_tasks` has an unnamed `else` branch meaning "not done", and reading
 * through it would be a caller depending on a default nobody wrote down.
 * Overdue, today and upcoming are the three he asks about and all three are
 * named in the function's own case.
 */
/*
  THE REFERENT'S CANDIDATES, ON EITHER SIDE OF 0593 (ledger R42).

  0593 gave `app.my_task_referent` a `p_any_task` argument and a `candidates`
  list. A worker deployed before that migration would call a signature that
  does not exist, the call would throw, and every settle and named change
  would fall silent: worse than main, not merely unimproved. So a missing
  function is answered with the old one-argument call, mapped to the same
  shape; any other error still throws, because a failing query is not an
  absent one.

  0783 gave it an office too: the conversation it reads is the CLAIMED job's
  office's. Against a database from before 0783 the same fall-back applies - the
  office-first call does not exist there either, and the one-argument call is
  what that database answers.
*/
export async function referentCandidates(
  db: SqlExecutor,
  commandId: string,
  jobId: string,
): Promise<{ readonly rows: readonly unknown[] }> {
  const id = lit(commandId === '' ? '00000000-0000-0000-0000-000000000000' : commandId)
  try {
    return await db.execute(
      `select app.my_task_referent(app.job_office(${lit(jobId)}::uuid), ${id}::uuid, p_any_task => true) as t`,
    )
  } catch (error) {
    if (!/does not exist|42883|p_any_task/.test(String((error as Error).message))) throw error
    const r = await db.execute(`select app.my_task_referent(${id}::uuid) as t`)
    const raw = (r.rows[0] as { t?: unknown } | undefined)?.t
    const old = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      id?: string
      title?: string
    } | null
    const candidates =
      old !== null && typeof old?.id === 'string'
        ? [{ id: old.id, title: String(old.title ?? '') }]
        : []
    return { rows: [{ t: { candidates } }] }
  }
}

const NOTHING_TO_STOP = 'There was nothing still running on that, so there is nothing to stop.'

/** "Monday 28 September" for an ISO date, read as a calendar day. */
export const onDay = (iso: string): string => {
  const at = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      })
}

export function taskSpine(
  overdue: readonly HisTask[],
  today: readonly HisTask[],
  upcoming: readonly HisTask[],
  counts: { readonly overdue?: number; readonly today?: number; readonly all?: number },
  /*
    The undated ones, NAMED (ledger R8). Every open task on his real list has
    no due date, so the three dated buckets were all empty and the spine said
    only "holds 9 item(s), none of them due" - a count with no names, which
    cannot answer "what are my tasks". Optional so an older caller keeps its
    exact sentence.
  */
  unscheduled: readonly HisTask[] = [],
): string {
  /*
    With its weekday, computed here (ledger R39). Given a bare ISO date the
    model supplied the weekday itself and got it wrong: "2026-09-26
    (Tuesday)" for a Saturday, "2026-09-28 (Wednesday)" for a Monday, in an
    answer to "what have I got on this week". A weekday is derivable, so it is
    derived once, in code; the ISO date stays for the grounding check.
  */
  const say = (t: HisTask): string =>
    t.due_on === null ? t.title : `${t.title} (due ${onDay(t.due_on)}, ${t.due_on})`
  const total = Number(counts.all ?? 0)
  if (
    total === 0 &&
    overdue.length === 0 &&
    today.length === 0 &&
    upcoming.length === 0 &&
    unscheduled.length === 0
  ) {
    return 'His own to-do list is empty right now. Nothing is on it.'
  }
  const parts: string[] = []
  if (overdue.length > 0)
    parts.push(`Overdue, ${String(overdue.length)}: ${overdue.map(say).join('; ')}.`)
  if (today.length > 0)
    parts.push(`Due today or earlier, ${String(today.length)}: ${today.map(say).join('; ')}.`)
  if (upcoming.length > 0)
    parts.push(`Coming up, ${String(upcoming.length)}: ${upcoming.map(say).join('; ')}.`)
  if (unscheduled.length > 0)
    parts.push(
      `No date set, ${String(unscheduled.length)}: ${unscheduled.map((t) => t.title).join('; ')}.`,
    )
  if (parts.length === 0) {
    return `His own to-do list holds ${String(total)} item(s), none of them due or overdue.`
  }
  return `His own to-do list, read from the office's records just now. ${parts.join(' ')}`
}

/** Who is answering, and everything that makes them sound like themselves. */
interface Speaker {
  readonly slug: string
  readonly name: string
  readonly title: string
  /** §9's recorded voice. Read by the prompt; the reason they differ. */
  readonly communication_style: string | null
  readonly responsibilities: string | null
  readonly reason: string
  /**
   * The rest of the convened roster — everyone `pickRoster` chose but this one.
   *
   * #233. `pickRoster` returns up to `ROSTER_CEILING` names, and until now
   * this file took `roster[0]` and threw the remainder away. It was recorded
   * faithfully in `routing_decisions.roster`, so the office could show Grant a
   * decision it never acted on: `delegation_depth` was 0 across every real job
   * in the system's history and no agent had ever handed work to another.
   *
   * Exactly #65's shape — the decision existed and never reached the row
   * anybody would look at — one layer further out.
   */
  readonly alsoConvened: readonly string[]
  /**
   * What `pickRoster` actually returned, which may be EMPTY.
   *
   * Separate from `slug` because the two answer different questions and
   * conflating them made one of them unanswerable (#231). `slug` is who
   * speaks, and it falls back to the Chief of Staff when nobody was convened —
   * that fallback is right and is how the whole system reads an empty roster.
   *
   * #233 then recorded `[slug, ...alsoConvened]` into
   * `routing_decisions.roster`, so a question that convened NOBODY was stored
   * as having convened Claire. `npm run measure` counts who the office chooses
   * from that column, so she was being counted as a chosen specialist every
   * time no specialist was chosen, and "nobody was convened" stopped being
   * countable at all.
   *
   * 0311's lesson in a column rather than in a vocabulary: two ways to say one
   * thing, and the reader cannot tell them apart. The stored roster is this
   * one; the speaker is still `slug`.
   */
  readonly convened: readonly string[]
  /**
   * The clause somebody ELSE continues with, once this one has answered (#128).
   *
   * Null for almost every request, and deliberately: a handoff fires only when
   * the clauses are joined by a sequence word and belong to two different
   * people. A missed handoff costs what the office did before — two parallel
   * answers — and a wrong one leaves a specialist waiting for work that was
   * never coming.
   *
   * Not acted on here. The child is enqueued AFTER the answer exists, because
   * the whole difference between a handoff and a second request is that it
   * carries what the first agent produced.
   */
  readonly handoff: Handoff | null
}

/** A row of `app.decisions_about` — what the office already settled (#129). */
interface Decided {
  readonly question: string
  readonly chose: string
  readonly ruled_out: readonly string[]
  readonly because: string
  readonly by: string
  readonly project: string | null
}

export interface InstructionDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter
  /**
   * What time it is, injectable for a replay (#133).
   *
   * A job that said "by Friday" resolves to a different date a fortnight
   * later, so replaying real history against current code has to freeze the
   * clock to the original job's time or every dated request shows up as a
   * change the code did not make.
   *
   * ONE place in this handler reads the clock -- `dueOn`, when a task's
   * deadline is derivable from the words -- and that is the whole reason this
   * is a function rather than a Date: the office reads the real clock on every
   * job and a replay reads the one it is given. The default is the real clock,
   * so every existing caller is unchanged and nothing has to know about this.
   */
  readonly now?: () => Date
}

interface Payload {
  readonly instruction?: string
  readonly voice_file_id?: string | null
  readonly voice_seconds?: number | null
  readonly addressed_to?: string | null
  /**
   * Who ELSE Grant picked (#26).
   *
   * `addressed_to` answers; each of these answers in their own name, through
   * the same `alsoConvened` path a routed roster uses. Optional and empty by
   * default, so every adapter that addresses nobody is unchanged.
   */
  readonly addressed_also?: readonly string[]
  readonly origin_channel?: string
  readonly origin_ref?: string
  readonly command_id?: string
  /**
   * The output a colleague handed over, and why (#128).
   *
   * Set by the worker when it enqueues a handoff child. `from_output` is the
   * `outputs.output_id` of the first agent's answer — the thing that makes
   * this a handoff rather than a second request.
   */
  readonly from_output?: string
  readonly handed_off_because?: string
  /** The slug of the agent who handed it on. Written by #233's path too. */
  readonly handed_off_by?: string
}

/**
 * The staff member who should answer, and the roster reason.
 *
 * Returned together because §5 requires the routing decision to be recorded
 * with its reasoning, and "Grant chose this person by opening their bot" is a
 * better reason than anything a classifier produces.
 */
/**
 * How a CODE-COMPOSED confirmation may describe the way it was produced.
 *
 * `enforce_deterministic_claim` refuses `deterministic_retrieval` on a job that
 * has any `inference_usage` row against its correlation, and it is right to:
 * the claim is checkable, and a handler that can launder a model answer as a
 * constant makes §11's whole accounting worthless.
 *
 * Every confirmation in this file is composed in code and every one of them is
 * therefore tempted to claim the exemption — and by the time one is written the
 * turn has usually already spent a model call resolving the sentence against
 * the conversation (#63) or naming its subject (#232). So the claim is false on
 * most turns, and a false claim does not degrade: the insert is refused, the
 * job FAILS, and Grant receives nothing at all for an action that already
 * happened.
 *
 * #237 found that on the task confirmation and fixed it THERE. Four other sites
 * kept the hardcoded claim, and #231 found the next one the same way: *"From
 * now on keep every answer to a single short paragraph"* was correctly
 * understood, correctly stored as a preference, and then failed — so the office
 * learned the rule and told him nothing. CLAUDE.md's own line, for the fourth
 * time: when two places write the same field, grep for the other one.
 *
 * One function, every caller, so the next confirmation added cannot be the
 * fifth.
 *
 * Unreadable means assume a model was called. The expensive direction is
 * claiming an exemption the record cannot support, which fails the job; the
 * cheap direction is one unnecessary review.
 */
/*
  Moved to `agents/provenance.ts` and re-exported here (0489).

  Its own comment promised "one function, every caller, so the next
  confirmation added cannot be the fifth". The fifth turned out to be in
  `handlers/slack-rotation.ts`, in a different file, where a private const
  could never reach it. The definition is shared now; this name stays so the
  four call sites below read as they did.
*/
const howComposed = howComposedFrom

/*
  Exported for #26's tests.

  A decision function this small should be testable without a model and
  without a queue, and the alternative — asserting who answered by running a
  job end to end — is slow, stochastic, and would have told me nothing about
  the case that matters here: a CHILD job carrying an addressee and no
  selection must convene nobody, which is what stops delegation recursing.
*/
export async function speaker(
  db: SqlExecutor,
  addressedTo: string | null,
  instruction: string,
  /**
   * How the office reaches a model, for the semantic fallback below.
   *
   * Optional, and its absence is not an error: without it routing is exactly
   * what it was before #232 — the trigram matcher and nothing else. Every
   * caller in production passes it; a test that only wants the literal path
   * omits it and gets the literal path.
   */
  router: ProviderRouter | null = null,
  /**
   * Which dashboard project this is, so the roster respects who works on it.
   *
   * Null for work with no project, which is most duties. See `pickRoster`'s
   * fourth argument and migration 0323.
   */
  projectId: string | null = null,
  /**
   * The rest of a selection Grant made himself (#26).
   *
   * The specification asks for three ways to address the team - one, selected,
   * everyone - and two already worked. Naming nobody IS "ask the team": the
   * roster reads the subject and convenes whoever knows about it, which is
   * also why asking the whole team does not produce eight near-identical
   * replies. The middle one, picking two or three yourself, is this.
   *
   * It joins the SAME path a routed roster takes rather than a second one:
   * these become `alsoConvened`, one child job each, each answering in their
   * own name. A parallel mechanism for "he chose them" would be two ways to
   * convene somebody and the handler would have to know which.
   */
  alsoAddressed: readonly string[] = [],
  /**
   * The claimed job, so the project's roster is read in the job's office. Without it nobody can say whose project
   * this is and the roster is simply not restricted (the catch below), which is what a test that only wants the
   * literal path gets.
   */
  jobId: string | null = null,
): Promise<Speaker> {
  const byName = addressedTo === null || addressedTo === '' ? null : addressedTo
  if (byName !== null) {
    const { rows } = await db.execute(`
      select slug, name, title, communication_style, responsibilities
        from public.staff where slug = ${lit(byName)} and active
    `)
    const s = rows[0] as
      | Omit<Speaker, 'reason' | 'alsoConvened' | 'convened' | 'handoff'>
      | undefined
    if (s !== undefined) {
      /*
        Nobody else, and that is what stops delegation recursing.

        A child job spawned for a second specialist carries `addressed_to`, so
        it arrives here, takes this branch, and convenes nobody further. The
        depth trigger caps it at three anyway; this makes the natural fixed
        point one, which is what §9 wants.
      */
      /*
        A selection he made himself keeps its companions; a bot he opened has
        none (#26).

        The comment below is still true of the single case and would have been
        wrong for the new one: `alsoConvened` is empty when Grant addressed one
        person, and holds the rest when he picked several. The CHILD jobs that
        result carry `addressed_to` and no selection, so they arrive here with
        an empty list and convene nobody further — the chain still terminates
        at one by construction rather than by the depth cap.
      */
      const also = alsoAddressed.filter((x) => x !== '' && x !== s.slug)
      return {
        ...s,
        reason:
          also.length === 0
            ? `addressed directly — ${currentPerson().name} opened this person’s bot`
            : `${currentPerson().name} picked ${String(also.length + 1)} people themselves`,
        alsoConvened: also,
        // Addressing somebody IS convening them, so this one is not empty:
        // Grant picked the specialist himself.
        convened: [s.slug, ...also],
        /*
          And an addressed job never hands on (#128).

          A handoff child carries `addressed_to`, so it arrives here — and if
          this branch could produce one, a two-clause request answered by the
          receiver would hand on again. The chain terminates at one by
          construction, which is what the comment above already claimed about
          `alsoConvened` and now holds for the sequential case too.

          Explicit rather than implied: `rows[0]` is CAST to the Speaker shape
          minus the fields this branch supplies, so a new field left out of the
          cast's Omit list reads as present to the compiler and is undefined at
          runtime. That is exactly how this arrived — `who.handoff.to` threw
          "Cannot read properties of undefined" on the first live run, four
          attempts deep, with tsc green.
        */
        handoff: null,
      }
    }
  }

  // Nobody was named, so the Chief of Staff decides. Deliberately the cheapest
  // possible routing rather than a second classifier: §9's roster ceilings
  // already encode who a kind of request belongs to, and the instruction
  // handler is not the place to re-litigate them.
  const { pickRoster } = await import('../agents/router.ts')
  const classified = classifyIntent(instruction)

  /*
    Who the ROSTER says knows about this (#65).

    `pickRoster` fell back to five regexes in `router.ts` — which worked, and
    which Grant cannot edit. He is building a dashboard to *"look at each
    agent, what their skill sets are, and adjust and add and refine"*, so the
    subject vocabulary lives in `staff.expertise` now and this reads it.

    Failure falls through to the hardcoded list rather than to nobody: a
    routing decision degrading to yesterday's behaviour is recoverable, and one
    degrading to "chief-of-staff answers everything" is the very complaint
    this is fixing.
  */
  /*
    What the request is NOT about, removed before the subject is looked up
    (#237).

    `who_knows_about` is a trigram match, so *"i meant the onboarding not the
    pricing"* matched PRICING and sent the work to the finance director — the
    one specialist Grant had just excluded. Worse than a miss: a miss lands on
    the Chief of Staff, and this lands on somebody confidently answering the
    question he withdrew.

    It also hid the semantic layer, which only runs when the literal matcher
    finds nobody — so a misleading literal hit is exactly the case where the
    meaning-reader is not consulted.

    Only the SUBJECT LOOKUP sees the trimmed text. The instruction below is
    untouched and the model still reads every word, because "not the pricing"
    is information the answer needs; this decides who is asked, not what they
    are told.
  */
  const forLookup = withoutNegated(instruction)

  /*
    One lookup per ASK, not one per message (#231).

    `who_knows_about` is a trigram match over whatever it is given, so a
    whole-message match can only surface the strongest subject in the message.
    *"look at which channel is bringing people in and draft the note we send
    them"* is two asks for two people and came back as the communications
    director alone — "channel" is in the growth director's expertise and lost
    to a sentence that is mostly about writing.

    `clauses.ts` carries the argument. What matters here is the pair of
    consequences: a multi-clause request gets ONE name per clause, because the
    clause is the thing that has one subject; a single-clause request keeps
    three, because a single subject worth hedging about is exactly what the
    old number was for and changing it would move every routing decision this
    office has ever measured.
  */
  /*
    `split` rather than `clauses`, because #128 needs the JOINS.

    "and then" is a sequence and "and" is a list, and that one word is the
    whole difference between handing the first agent's output to the second and
    running them in parallel. Same regex, same boundaries, same clauses — one
    pass that keeps what joined them.
  */
  const parts = split(forLookup)
  const asks = parts.map((c) => c.text)
  const perAsk = asks.length === 1 ? 3 : 1

  // Nothing to look up. `withoutNegated` can empty a message that was entirely
  // a withdrawal, and an empty VALUES list is a syntax error rather than an
  // empty answer.
  const matched =
    asks.length === 0
      ? []
      : await db
          .execute(`
      with ask(i, t) as (values ${asks.map((t, i) => `(${String(i)}, ${lit(t)})`).join(', ')})
      select ask.i as i, w.slug as slug
        from ask cross join lateral app.who_knows_about(ask.t, ${String(perAsk)}) w
       order by ask.i`)
          .then((r) =>
            (r.rows as { i: number; slug: string }[]).map((x) => ({
              i: Number(x.i),
              slug: String(x.slug),
            })),
          )
          .catch(() => undefined)

  /*
    A COLLEAGUE HE NAMED IS THE ONE HE MEANT (ledger R21).

    "Ask Emma to pull together everything on the Holloway Barn booking" went
    to the quality director by subject and Emma was never convened. A clause
    that names a roster member in a delegation frame belongs to that person,
    ahead of any subject match; everything else about routing is unchanged,
    so the per-clause handoff below turns "get Emma to X and then have Daniel
    do Y" into Emma first, Daniel with her result.
  */
  const colleagues = await db
    .execute(`select slug, coalesce(name, '') as name from public.staff where active`)
    .then((r) => r.rows as { slug: string; name: string }[])
    .catch(() => [] as { slug: string; name: string }[])
  const named = asks.map((t) => namedColleague(t, colleagues))
  const found =
    matched === undefined
      ? named.every((n) => n === null)
        ? undefined
        : named.flatMap((slug, i) => (slug === null ? [] : [{ i, slug }]))
      : named.some((n) => n !== null)
        ? asks.flatMap((_t, i) => {
            const n = named[i] ?? null
            return n !== null ? [{ i, slug: n }] : matched.filter((x) => x.i === i)
          })
        : matched

  // Order matters and duplicates do not: `pickRoster`'s contested branch takes
  // the first name, so the first ask has to come first.
  const literal = found === undefined ? undefined : [...new Set(found.map((x) => x.slug))]

  /*
    And when no word in the request names anybody, read it for MEANING (#232).

    `who_knows_about` is a trigram match against `staff.expertise`, so it can
    only find a specialist whose subject Grant happened to name. Measured over
    91 realistic asks it reached the right person 31% of the time, and 0% for
    every phrasing that describes a subject without using its noun — which is
    how he talks, especially into a voice note. His own example, *"Run the
    numbers if we sell it cheaper"*, matches no word in any expertise list.

    Only when the literal matcher found NOTHING. An expertise hit is Grant's
    own vocabulary saying who this belongs to and a model does not get to
    overrule it; this is the else branch, not a second opinion. It also keeps
    the cost where it belongs — no extra call on the requests that already
    route correctly.

    `undefined` from the query above means the lookup FAILED, which is not the
    same as finding nobody, and the distinction is load-bearing exactly as it
    is for `onProject` below: a failed lookup falls through to `TOPIC_ROLES`
    untouched rather than spending a model call to paper over a database
    hiccup.
  */
  /*
    Per ask, for the same reason, and this is the half that was silently
    disabled.

    The old rule — consult the model only when the literal matcher found NOBODY
    — is right, and it was being applied to the message. So one clause the
    trigram could answer silenced the reader on every other clause, which is
    #237's lesson (*"a misleading literal hit is exactly the case where the
    meaning-reader is not consulted"*) in its partial form. *"flag what could go
    wrong if we leave it another month"* names the quality director to any
    reader and matches no expertise word; it was never asked about, because the
    clause beside it matched "process".

    Bounded to two calls. A request with five unanswerable asks is not five
    specialists, and the roster is capped at five anyway, so the sixth lookup
    could not change the answer — only the bill.
  */
  const NAMED_BY_MODEL_AT_MOST = 2
  const unanswered =
    found === undefined
      ? []
      : asks
          .map((t, i) => ({ t, i }))
          .filter((a) => !found.some((f) => f.i === a.i))
          .slice(0, NAMED_BY_MODEL_AT_MOST)

  const semantic =
    literal === undefined || router === null || unanswered.length === 0
      ? []
      : (
          await Promise.all(
            unanswered.map((a) =>
              nameSubjects(db, router, a.t, {}, asks.length === 1 ? 2 : 1).catch(() => []),
            ),
          )
        ).flat()

  const topical = literal === undefined ? undefined : [...new Set([...literal, ...semantic])]

  /*
    Who works on this project (#36, migration 0323).

    Undefined rather than empty on failure, and the distinction is load-bearing
    in the same way the `topical` catch above is: undefined means "no
    restriction", an empty array would mean "nobody works here" and would send
    every piece of work on every project to the Chief of Staff the first time
    the query hiccupped.
  */
  const onProject =
    projectId === null || jobId === null
      ? undefined
      : await db
          .execute(
            `select unnest(app.staff_on_project(app.job_office(${lit(jobId)}::uuid), ${lit(projectId)}::uuid)) as slug`,
          )
          .then((r) => (r.rows as { slug: string }[]).map((x) => String(x.slug)))
          .then((xs) => (xs.length === 0 ? undefined : xs))
          .catch(() => undefined)

  const { roster, reason } = pickRoster(
    classified,
    instruction,
    topical as never,
    onProject as never,
  )
  const chosen = roster[0] ?? 'chief-of-staff'

  /*
    Is the second clause waiting on the first? (#128)

    `found` already says who each clause belongs to, and `parts` now says what
    joined them, so this costs nothing beyond a pure function over data the
    routing already has.

    A handoff REMOVES its receiver from `alsoConvened`. Otherwise the same
    specialist would get a parallel job carrying the whole original instruction
    AND a handoff carrying the first one's output — two jobs for one clause,
    the second of which would be answering a question the first had already
    answered worse.
  */
  const handoff = handoffIn(parts, (i) => found?.find((x) => x.i === i)?.slug, chosen)
  const alsoConvened = roster.slice(1).filter((slug) => slug !== handoff?.to)
  const convened = roster
  const { rows } = await db.execute(`
    select slug, name, title, communication_style, responsibilities
      from public.staff where slug = ${lit(chosen)} and active
  `)
  const s = rows[0] as Omit<Speaker, 'reason' | 'alsoConvened' | 'convened' | 'handoff'> | undefined
  return s === undefined
    ? {
        slug: 'chief-of-staff',
        name: 'Claire',
        title: 'Chief of Staff',
        communication_style: null,
        responsibilities: null,
        reason,
        alsoConvened,
        convened,
        handoff,
      }
    : { ...s, reason, alsoConvened, convened, handoff }
}

/**
 * File a task, and say what happened — never what is about to happen.
 *
 * #237. The reply this replaces was *"Sure, I'll create it"* followed by
 * nothing being created, which is §10's invariant broken in the future tense:
 * a promise of an action is a claim about an action. Either the task exists
 * when this returns or the sentence says exactly what is missing.
 *
 * Through `app.task_add`, which takes the project id the job already holds
 * (0367). The slug door, `hq_task_add`, resolves a name and refuses a fixture
 * project — both right for something a person types and wrong for a job that
 * resolved its project several hundred lines ago.
 */
/**
 * A task NAMED by Grant, looked for on his whole open list (ledger R29).
 *
 * The conversation's own tasks are the referent set, deliberately: "mark it
 * done" must not reach across chats. But the interfaces are entrances to ONE
 * office, and a task made on Telegram and named on Slack - "mark the Hartley
 * one done" - was answered "no task has been added in this conversation"
 * although there is exactly one open task by that name on his list. A NAME is
 * not a pronoun: when it picks exactly one of his open personal tasks, that
 * is the one he means. A bare referent never comes here.
 */
async function hisTaskByName(
  db: SqlExecutor,
  jobId: string,
  name: string,
): Promise<{ id: string; title: string } | null> {
  const r = await db.execute(`
    select app.my_tasks(app.job_office(${lit(jobId)}::uuid), 'all', 200, null, 'smart', app.harness_job(${lit(jobId)}::uuid)) as t`)
  const raw = (r.rows[0] as { t?: unknown })?.t
  const all = ((typeof raw === 'string' ? JSON.parse(raw) : raw) ?? []) as {
    id?: string
    task_id?: string
    title?: string
    state?: string
  }[]
  const open = all
    .filter((t) => t.state !== 'done' && t.state !== 'cancelled')
    .map((t) => ({ id: String(t.id ?? t.task_id ?? ''), title: String(t.title ?? '') }))
    .filter((t) => t.id !== '')
  return pickByName(name, open)
}

async function addTask(
  db: SqlExecutor,
  job: Job,
  asked: TaskRequest,
  said_by = '',
  now: Date = new Date(),
): Promise<string> {
  if (asked.title === null) return NEEDS_A_TITLE

  /*
    The deadline and the owner, where they are DERIVABLE (#253).

    `app.task_add` has taken `p_due_on` and `p_assignee` since it existed and
    nothing filled either, so "chase the roofing quote by Friday" produced a
    task called "chase the roofing quote by Friday" with a null date: the
    deadline was in front of Grant and was not data.

    Both resolvers are deterministic and both refuse rather than guess, which
    is #249's invariant — the semantic layer may infer and may not invent a
    consequential parameter. A task dated the wrong Friday is worse than a task
    with no date, because the wrong date looks correct.

    The words stay in the TITLE either way. An earlier draft subtracted "by
    Friday" from the name, which looked tidier and would have been a loss on
    every phrase the resolver declines — this repository filed that as the
    reason the subtraction was removed, and it is still the reason.
  */
  const when = dueOn(said_by === '' ? asked.title : said_by, now)
  /*
    And then out of the NAME, because it is now in the column.

    The comment above is kept because its argument is still right about an
    unconditional strip. This one is conditional on the resolver having
    actually resolved the phrase, so a deadline #253 declines keeps every
    word he said and one it accepts is not stored twice. Resolved FIRST and
    removed after, because `dueOn` reads the title.
  */
  const titled = withoutTheDate(asked.title, when)
  const owner = assignedTo(said_by === '' ? asked.title : said_by)

  /*
    NAMED arguments, because this signature has eight and CLAUDE.md records
    what positional ones cost here: passing the job seventh set `p_added_by` to
    a uuid, and the reversal keyed on `job_id` then matched nothing and
    reported "all of them" removed.
  */
  const said = await db
    .execute(`
      select app.task_add(
        p_office => app.job_office(${lit(job.jobId)}::uuid),
        p_project => ${job.projectId === null ? 'null' : `${lit(String(job.projectId))}::uuid`},
        p_title => ${lit(titled)},
        p_due_on => ${when === null ? 'null' : `${lit(when.on)}::date`},
        p_assignee => ${owner === null ? 'null' : lit(owner)},
        p_added_by => 'the office',
        p_job => ${lit(job.jobId)}::uuid) as r`)
    .catch((error: unknown) => ({
      rows: [{ r: { error: (error as Error).message.slice(0, 200) } }],
    }))
  const answer = (said.rows[0] as { r?: { error?: string; title?: string } } | undefined)?.r

  /*
    A refusal is reported, never swallowed.

    CLAUDE.md: a swallowed error on a write nobody reads back is
    indistinguishable from a feature that was never built — which is precisely
    how this whole gap survived. The writer returns its reason as data rather
    than raising, so there is a sentence to pass on.
  */
  if (answer?.error !== undefined) {
    return `I could not add that one: ${answer.error}.`
  }
  /*
    Say what was stored, in his own words for the date.

    `when.from` is the phrase he typed rather than a paraphrase of it, so a
    wrong reading is visible to him at the moment it happens — which is the
    only defence a deterministic resolver has against the one case it gets
    wrong.
  */
  const extra = [
    when === null ? null : `due ${when.on} (from “${when.from}”)`,
    owner === null ? null : `for ${owner.replace('-director', '').replace('-', ' ')}`,
  ].filter((x) => x !== null)
  return (
    `Added it: **${answer?.title ?? asked.title}**` +
    (extra.length === 0 ? '.' : ` — ${extra.join(', ')}.`)
  )
}

/**
 * Start the artifacts an instruction asked for, or say why not.
 *
 * Returns null when the instruction asked for none, which hands control back to
 * the prose path. The two are exclusive: an instruction that starts work is
 * answered by the fact that the work started, and following it with a model's
 * essay on the subject would be the original defect wearing a hat.
 */
async function act(
  db: SqlExecutor,
  job: Job,
  kinds: readonly RequestedKind[],
  instructions: string,
): Promise<string | null> {
  if (job.projectId === null) {
    return (
      'Happy to, but this one is not attached to a project, so I have nowhere to put it. ' +
      'Tell me which project and it is done.'
    )
  }

  // Grant anticipated this exact reply: *"maybe he's gonna ask for details
  // based on the configuration of what's required."* A project with no notebook
  // attached is a configuration question, and asking it is better than picking
  // a notebook — ADR-0014's whole point is that "where does this project's
  // output go" has one answer.
  const { rows } = await db.execute(`
    select a.display_name from public.project_attachments a
      join public.projects p on p.project_id = a.project_id and p.office_id = app.job_office(${lit(job.jobId)}::uuid)
     where a.project_id = ${lit(String(job.projectId))}::uuid
       and a.connector = 'notebooklm' and a.enabled
     order by case when a.role = 'home' then 0 else 1 end
     limit 1
  `)
  const notebook = (rows[0] as { display_name?: string } | undefined)?.display_name
  if (notebook === undefined) {
    return (
      'I need a notebook for that one. This project has not got one attached, and I am not ' +
      'about to write into whichever of yours I find first. Send me its NotebookLM link, or ' +
      'attach it on the web front end, and ask me again.'
    )
  }

  const started: string[] = []
  for (const kind of kinds) {
    // announce = true, since 0083. It used to be false because the generate
    // job's output repeated this reply — but now that output is the request for
    // permission, with the buttons on it, and it is the most important message
    // in the exchange. The handler forces it back on anyway if a caller gets
    // this wrong: a gate whose request can be muted is not a gate.
    await db.execute(`
      select app.enqueue_child(
        app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'notebook.generate',
        jsonb_build_object('kind', ${lit(kind)}, 'instructions', ${lit(instructions)}),
        interval '0', true${callerArgs(job)}
      )
    `)
    started.push(KIND_LABEL[kind])
  }

  const list =
    started.length === 1
      ? (started[0] as string)
      : `${started.slice(0, -1).join(', ')} and ${String(started.at(-1))}`
  // What this will cost, said at the moment of asking rather than after.
  // Grant asked to be told the remaining usage "every time I make a request",
  // and the request is the only moment at which knowing changes his mind.
  const meter = await allowance(db, officeOfJob(job.jobId), kinds[0] ?? 'ask')
  const cost = `\n\n${describe(meter)}`

  // Written the way a person writes a one-line acknowledgement, not the way a
  // system writes a status. Grant: *"the messages they're sending are a bit too
  // robotic — try to make them sound a bit more personable."* The LLM path got
  // the roster's `communication_style`; this path cannot, because it is a
  // statement of fact about the queue and putting a model between him and a
  // fact would be a paraphrase of something already true. So it is just written
  // better.
  //
  // And it must not promise the generation. 0083 put a gate in front of every
  // one of them, so the next thing Grant sees is a request for permission — the
  // first version of this said "asking Google now" while the job was in fact
  // asking HIM, which is a small lie that makes the button arriving after it
  // look like a malfunction.
  //
  // In fact it must not be SAID at all when an approval request is following
  // it. Grant: *"there's a lot of repetition going on in the Telegram
  // messages."* This acknowledgement and the request that arrives fifteen
  // seconds later say the same thing, and the second one is the one with the
  // buttons on it. So this job goes quiet and the request speaks for both.
  //
  // The text is still produced and still stored, because it is this job's
  // output and §10 wants an output; it is only not delivered.
  // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
  await db.execute(`update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`)
  return (
    (started.length === 1
      ? `Right — ${list} for "${String(notebook)}". I'll ping you to approve it in a moment, ` +
        "and once you do I'll post the link here and in the project channel."
      : `Right — ${list} for "${String(notebook)}". I'll ping you to approve each one, then ` +
        'post the links here and in the project channel as they land.') + cost
  )
}

/**
 * Turn a voice note into the instruction it was.
 *
 * The bot's own token, resolved from the chat the message arrived in — a
 * recording sent to Ines is fetched with Ines's credential, because a bot may
 * only read files from its own conversations and using the pager's token would
 * simply 400.
 *
 * The transcript is written back to `inbound_commands` before it is acted on.
 * If the job then fails and retries, the words are already there and the audio
 * is not fetched or transcribed twice.
 */
async function listen(db: SqlExecutor, job: Job, payload: Payload): Promise<string> {
  const commandId = String(payload.command_id ?? '')
  const { rows: existing } = await db.execute(
    `select transcript from public.inbound_commands
      where command_id = ${lit(commandId)}::uuid and office_id = app.job_office(${lit(job.jobId)}::uuid)`,
  )
  const already = (existing[0] as { transcript?: string | null } | undefined)?.transcript
  if (already !== undefined && already !== null && already.trim() !== '') return already.trim()

  const { rows } = await db.execute(`
    select app.resolve_secret(t.token_ref) as token, t.bot_id::text as bot_id
      from public.inbound_commands c
      -- The bot it arrived ON, not "a bot with this chat id" (0097). A
      -- Telegram file_id is scoped to the bot that received the file, so the
      -- wrong token here does not fetch the wrong audio — it fetches nothing.
      ${BOT_FOR_INBOUND}
     where c.command_id = ${lit(commandId)}::uuid
       and c.office_id = app.job_office(${lit(job.jobId)}::uuid)
       and t.enabled and t.token_ref is not null
     limit 1
  `)
  const bot = rows[0] as { token?: string | null; bot_id?: string | null } | undefined
  const token = bot?.token
  if (token === undefined || token === null || token === '') {
    throw new Error('a voice note arrived on a bot whose token we cannot resolve')
  }

  // Which route can turn this into words.
  //
  // Two, because the two places a pass runs can do different things: a GitHub
  // runner can spawn faster-whisper, the Edge Function cannot. Since Grant
  // switched Actions off, 'api' is the live one — and it is also the faster
  // one, because it runs where the webhook already kicks rather than waiting
  // for a runner to boot and download a model.
  const vocabulary = await spokenVocabulary(db, job)
  const transcriber = await readTranscriber(db)

  if (transcriber.mode === 'none') {
    // Never a silent park. The webhook says this at the door too (0134); this
    // is the second gate, for a note that got past it because the mode changed
    // between arrival and work.
    throw new VoiceNoteError(
      'nothing is configured to turn voice notes into words — send it as text, ' +
        'or set voice.transcription in Settings',
    )
  }

  const heard =
    transcriber.mode === 'api'
      ? await (async () => {
          const { bytes, filename } = await fetchTelegramAudio(token, String(payload.voice_file_id))
          return transcribeOverApi(
            bytes,
            filename,
            transcriber,
            vocabulary,
            // Telegram's own figure. The local path already used it; the API
            // path dropped it, and every voice note echoed as "(0s)".
            payload.voice_seconds ?? 0,
          )
        })()
      : await transcribeTelegramVoice(token, String(payload.voice_file_id), {
          ...(payload.voice_seconds === null || payload.voice_seconds === undefined
            ? {}
            : { seconds: payload.voice_seconds }),
          vocabulary,
        })

  // Say what was heard, before doing anything with it.
  //
  // Grant: *"I want to see the transcription immediately so I can see what's
  // actually been heard, and then it can give me the interpretation... I want
  // to check if it's simply a transcription problem or if it's just too stupid
  // to understand what I'm saying."*
  //
  // Sent here rather than alongside the answer, because the point is that it
  // arrives FIRST: an echo delivered with the reply tells him what went wrong
  // after he has already read a wrong reply, which is most of the annoyance.
  //
  // Fire-and-forget and never fatal — see `echoTranscript`.
  // `origin_ref` is `chatId:messageId` (src/channels/telegram.ts). Both halves
  // are useful: the chat to send to, and the message to reply UNDER, so the
  // echo threads beneath the voice note it belongs to instead of arriving as a
  // loose line in the conversation.
  //
  // ## Why this is now conditional
  //
  // Grant, 11 September, on receiving a transcript and a say-back as two
  // messages from one voice note: *"I sent a single voice, and I kinda split
  // the message up over two. That's probably not a good idea. Try to have
  // everything self contained and want a message to avoid any confusion."*
  //
  // His earlier instruction still stands and is not being discarded — he asked
  // to see the transcript *"immediately... and then it can give me the
  // interpretation"*, so he can tell a mishearing from a misunderstanding. The
  // two are only in tension about the MESSAGE COUNT, not the content. So when
  // a say-back is coming, the transcript rides on it (`describePlan`) and this
  // stays quiet; when nothing else is coming, this is the only thing he would
  // get and it still fires.
  //
  // Same shape as the fix already in this file for the other duplicate pair:
  // "this job goes quiet and the request speaks for both".
  const sayBackFollows = entitled.plan(asHumanWords(heard.text)) !== null
  if (!sayBackFollows) {
    await echoTranscript(
      db,
      job,
      token,
      String(bot?.bot_id ?? ''),
      String(payload.origin_ref ?? ''),
      heard,
    )
  }

  await db.execute(`
    update public.inbound_commands
       set transcript = ${lit(heard.text)}, instruction = ${lit(heard.text)}
     where command_id = ${lit(commandId)}::uuid
       and office_id = app.job_office(${lit(job.jobId)}::uuid)
  `)
  // Onto the job too, so `pinned_config` still explains the job's behaviour
  // afterwards — §6's whole reason for pinning.
  // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
  await db.execute(`
    update public.jobs
       set pinned_config = pinned_config || jsonb_build_object(
             'instruction', ${lit(heard.text)},
             'heard_by', ${lit(heard.model)},
             'voice_seconds', ${String(heard.seconds)}
           )
     where job_id = ${lit(job.jobId)}::uuid
  `)
  return heard.text
}

/**
 * The words this installation says that a general speech model has never heard.
 *
 * Whisper turned "NotebookLM" into "Not-to-But" and the Chief of Staff answered
 * a question nobody asked. That is not a model-size problem — it is that the
 * decoder had no reason to believe "NotebookLM" was a word. `initial_prompt`
 * fixes exactly this by supplying prior context.
 *
 * Assembled from the database rather than hard-coded, so hiring someone or
 * naming a project makes their name transcribable without a code change. The
 * fixed nouns are the ones no table holds.
 */
async function spokenVocabulary(db: SqlExecutor, job: Job): Promise<string[]> {
  // Ordered most-specific first: the hint has a token budget and the caller
  // truncates, so the words most likely to be mangled must come before the
  // ones a general model already knows.
  const fixed = ['NotebookLM', 'Notion', 'Supabase', 'Slack', 'Telegram', 'OpenRouter', 'Team HQ']
  try {
    const { rows } = await db.execute(`
      select name from public.staff where active
      union
      select name from public.projects
       where office_id = app.job_office(${lit(job.jobId)}::uuid) and status = 'active'
    `)
    return [...fixed, ...rows.map((r) => String(r.name)).filter((n) => n !== '')]
  } catch {
    // A hint is an improvement, not a dependency. If this query fails the
    // transcription still runs, just without the help.
    return fixed
  }
}

/**
 * Tell Grant what was heard, immediately, from the bot he spoke to.
 *
 * Never throws and never blocks the work. The echo is a diagnostic: a voice
 * note that gets answered but not echoed is the old behaviour, and an echo that
 * could fail the job would make a diagnostic aid into a new way to lose a
 * request.
 */
async function echoTranscript(
  db: SqlExecutor,
  job: Job,
  token: string,
  botId: string,
  originRef: string,
  heard: { text: string; seconds: number; hinted: boolean },
): Promise<void> {
  const [chatId, messageId] = originRef.split(':')
  if (chatId === undefined || chatId === '') return
  /*
    Through the delivery layer, like every other message (#378). This was a
    bare sendMessage, so it was the one message a harness voice turn could put
    in front of a real chat with nothing deciding whether it should, and
    nothing recording that it had. Now app.claim_delivery decides, the row
    names the job, and a second attempt of the same job does not echo twice.
  */
  try {
    await new DeliveryService(db, new TelegramTransport(new TelegramClient(token))).deliver({
      dedupeKey: `heard:${job.jobId}`,
      accountRef: botId,
      targetRef: chatId,
      // Threaded under the voice note; a message id that is not a number is not one.
      threadRef: messageId !== undefined && /^\d+$/.test(messageId) ? messageId : null,
      purpose: 'ack',
      correlationId: job.correlationId,
      jobId: job.jobId,
      staffId: null,
      // Quoted, so it is unmistakably a repeat of his words rather than the
      // bot saying something. The seconds are there because a transcript much
      // shorter than the recording is its own kind of wrong.
      body: {
        text:
          `🎧 Heard (${String(Math.round(heard.seconds))}s): “${escapeHtml(heard.text)}”\n\n` +
          'Working on it — if that is not what you said, send it again and ignore ' +
          'what comes back.',
        silent: true,
      },
    })
  } catch {
    // Never fatal: see the comment above. The delivery row says what happened.
  }
}

/** A project the message could be about. */
interface Candidate {
  readonly project_id: string
  readonly slug: string
  readonly name: string
}

/**
 * Which project this is for: one, or a question to ask instead.
 *
 * `job.projectId` is deliberately NOT the fallback. `app.enqueue_inbound` fills
 * it with the most recently updated active project so that every job has one,
 * which is right for answering a question and wrong for filing a source: the
 * cost of guessing is a permanent, silent misfiling rather than one odd reply.
 */
async function whichProject(
  db: SqlExecutor,
  job: Job,
  named: string | null,
): Promise<{ project: Candidate | null; ask: string | null }> {
  const { rows } = await db.execute(`
    select project_id::text as project_id, slug, name
      from public.projects
     where office_id = app.job_office(${lit(job.jobId)}::uuid) and status = 'active' order by updated_at desc
  `)
  const active = rows as unknown as Candidate[]

  if (named !== null) {
    const match = active.find(
      (p) => p.slug.toLowerCase() === named || p.name.toLowerCase() === named,
    )
    if (match !== undefined) return { project: match, ask: null }
    return {
      project: null,
      ask:
        `I do not have a project called “${named}”. ` +
        (active.length === 0
          ? 'There are no active projects yet — give me a name and a notebook and I will start one.'
          : `The active ones are ${active.map((p) => `“${p.name}”`).join(', ')}.`),
    }
  }

  if (active.length === 1) return { project: active[0] as Candidate, ask: null }
  if (active.length === 0) {
    return {
      project: null,
      ask: 'Nothing active to put that in yet. Give me a name and a notebook to hang it on and I will set one up.',
    }
  }
  return {
    project: null,
    ask:
      `Which project is that for? ${active.map((p) => `“${p.name}”`).join(', ')}. ` +
      'Tell me which and send it again — I would rather ask than file it somewhere wrong.',
  }
}

/**
 * Do something with the links in a message, or say why not.
 *
 * Returns null when the message has no links, or when it is asking ABOUT one
 * rather than asking for something to be done with it — both of which hand
 * control back to the prose path.
 */
async function handleLinks(
  db: SqlExecutor,
  job: Job,
  request: LinkRequest,
): Promise<string | null> {
  if (request.intent === 'discuss') return null

  const { project, ask } = await whichProject(db, job, request.namedProject)
  if (project === null) return ask

  const said: string[] = []

  // Places first: a notebook attached in the same message is the destination
  // the sources in that message should go to, and doing it in the other order
  // would refuse the sources for want of the notebook that arrived with them.
  const places = request.links.filter((l) => l.kind === 'notebooklm' || l.kind === 'notion')
  for (const link of places) {
    const { rows } = await db.execute(`
      select app.hq_attach(
        app.job_office(${lit(job.jobId)}::uuid),
        ${lit(project.slug)},
        ${lit(link.kind === 'notebooklm' ? 'notebooklm' : 'notion')},
        ${lit(link.ref)},
        ${link.kind === 'notebooklm' ? "'home'" : "'source'"},
        ${link.kind === 'notebooklm' ? "'artifact'" : 'null'},
        ${lit(project.name)}
      ) as r
    `)
    const r = (rows[0] as { r: { error?: string } }).r
    said.push(
      r.error === undefined
        ? `attached the ${LINK_LABEL[link.kind]} to “${project.name}”`
        : `could not attach the ${LINK_LABEL[link.kind]}: ${r.error}`,
    )
  }

  const content = request.links.filter((l) => l.kind !== 'notebooklm' && l.kind !== 'notion')
  if (content.length > 0) {
    // Content goes to the notebook, not to Notion. ADR-0013 settled the split —
    // Notion stores, NotebookLM generates — and NotebookLM ingests a URL
    // natively, transcribing a video and rendering a PDF, where we would hand
    // Notion the HTML of a consent banner.
    const { rows } = await db.execute(`
      select a.display_name from public.project_attachments a
        join public.projects p on p.project_id = a.project_id and p.office_id = app.job_office(${lit(job.jobId)}::uuid)
       where a.project_id = ${lit(project.project_id)}::uuid
         and a.connector = 'notebooklm' and a.enabled
       limit 1
    `)
    if (rows.length === 0) {
      said.push(
        `could not add ${String(content.length)} source(s): “${project.name}” has no notebook ` +
          'attached. Send me its NotebookLM link and I will hang it on first.',
      )
    } else {
      for (const link of content) {
        await enqueueSource(db, job, project.project_id, link)
        said.push(`adding the ${LINK_LABEL[link.kind]} to “${project.name}”`)
      }
    }
  }

  const list =
    said.length === 1
      ? (said[0] as string)
      : `${said.slice(0, -1).join('; ')}; and ${String(said.at(-1))}`
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`
}

/** One source, as its own job, because Google takes minutes over a video. */
async function enqueueSource(
  db: SqlExecutor,
  job: Job,
  projectId: string,
  link: FoundLink,
): Promise<void> {
  // The child inherits the parent's project, and the parent's project may not
  // be the one the link belongs to — `enqueue_inbound` picks the most recently
  // updated active project for every inbound message. So the job is moved onto
  // the right project after it is created, in the same statement.
  // The project as a parameter (0090). The CTE-then-update this replaced could
  // not see the row it had just inserted, so a source addressed to one project
  // was quietly filed under another.
  await db.execute(`
    select app.enqueue_child(
      app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'notebook.add_source',
      jsonb_build_object('url', ${lit(link.url)}, 'kind', ${lit(link.kind)}),
      interval '0', false, ${lit(projectId)}::uuid${callerArgs(job)}
    )
  `)
}

/**
 * The sentences of his own words that end in a question mark - as sentences, not as fragments (review R2-6): a URL's
 * "?id=5" and an abbreviation end nothing, so a link in a reminder is never "a question you also asked".
 */
export const unansweredQuestions = (said: string): string[] =>
  sentencesOf(said.replace(/https?:\/\/\S+/gi, ' ')).filter((q) => q.endsWith('?') && q.length >= 8)

/**
 * Complete a half-instruction from its neighbour, or leave it alone.
 *
 * Returns the joined text when a pair was found, else null. The pairing is
 * RECORDED on both commands, so a message that was consumed as half of
 * something else is not later re-read as an instruction of its own — which
 * would do the work twice, once wrongly.
 */
async function pairWithNearby(
  db: SqlExecutor,
  job: Job,
  payload: Payload,
  instruction: string,
): Promise<string | null> {
  const half = readFragment(instruction)
  if (!half.isBareLink && !half.needsALink) return null

  const commandId = String(payload.command_id ?? '')
  if (commandId === '') return null

  // Same person, same BOT, inside the window, not already paired, and not this
  // message.
  //
  // The bot, not the chat: a link shared into Emma's chat must not complete an
  // instruction typed into Tom's, and the first version compared the chat id,
  // which is the same number in both (0097). So it paired across the whole
  // team — and `origin_ref`'s first field, which that comparison read, is
  // exactly the field that cannot tell them apart.
  const { rows } = await db.execute(`
    select c.command_id::text as command_id,
           coalesce(c.transcript, c.instruction) as said
      from public.inbound_commands c
      join public.inbound_commands self on self.command_id = ${lit(commandId)}::uuid
     where c.office_id = app.job_office(${lit(job.jobId)}::uuid) and self.office_id = app.job_office(${lit(job.jobId)}::uuid)
       and c.command_id <> self.command_id
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = split_part(self.origin_ref, ':', 1)
       and coalesce(c.addressed_to, '') = coalesce(self.addressed_to, '')
       and coalesce(c.subject, c.actor) = coalesce(self.subject, self.actor)
       and c.paired_with is null
       and c.callback_action is null
       -- Forwarded words are content, not intent: a forwarded sentence never completes his link, and his link never
       -- completes a forwarded sentence (the pairing would hand somebody else's words to a typed job).
       and coalesce((c.context ->> 'forwarded')::boolean, false) = false
       and coalesce((self.context ->> 'forwarded')::boolean, false) = false
       and abs(extract(epoch from (c.received_at - self.received_at)))
             < ${String(PAIRING_WINDOW_MINUTES * 60)}
     order by abs(extract(epoch from (c.received_at - self.received_at))) asc
     limit 4
  `)

  for (const raw of rows) {
    const other = raw as { command_id: string; said: string | null }
    const said = String(other.said ?? '')
    if (said.trim() === '') continue
    const theirs = readFragment(said)

    // Each half must supply what the other lacks. Two bare links are two
    // links; two instructions are two instructions.
    const joined =
      half.isBareLink && theirs.needsALink
        ? join(said, instruction)
        : half.needsALink && theirs.isBareLink
          ? join(instruction, said)
          : null
    if (joined === null) continue

    // Recorded on both, so neither is acted on again alone. The other command
    // may already have produced a job — that one is done and its output stands;
    // this is about not doing it a THIRD time on the next drain.
    await db.execute(`
      update public.inbound_commands
         set paired_with = case
               when command_id = ${lit(commandId)}::uuid then ${lit(other.command_id)}::uuid
               else ${lit(commandId)}::uuid end,
             instruction = case
               when command_id = ${lit(commandId)}::uuid then ${lit(joined)}
               else instruction end
       where office_id = app.job_office(${lit(job.jobId)}::uuid)
         and command_id in (${lit(commandId)}::uuid, ${lit(other.command_id)}::uuid)
    `)
    // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
    await db.execute(`
      update public.jobs
         set pinned_config = pinned_config
               || jsonb_build_object('instruction', ${lit(joined)},
                                     'paired_with', ${lit(other.command_id)})
       where job_id = ${lit(job.jobId)}::uuid
    `)
    return joined
  }

  return null
}

/** Older turns worth quoting, and an honest account of what is out of reach. */
interface Memory {
  readonly recalled: readonly { at: string; minutesAgo: number; said: string; answered: string }[]
  /** One line for the prompt, or null when the whole conversation is in view. */
  readonly boundary: string | null
}

const NOTHING_OLDER: Memory = { recalled: [], boundary: null }

/**
 * What this chat said before the working window, when any of it is relevant.
 *
 * #238. `app.conversation_before` returns the last twelve turns inside the
 * window and nothing else, and until now that was the whole of the office's
 * memory: a reference to something older resolved against a gap, with no
 * signal to Grant that a gap existed.
 *
 * ## Why this is retrieval and not a bigger window
 *
 * The two limits are different kinds of limit. `max_turns` is the token cost —
 * twelve turns go into every prompt and each is paid for. `window_minutes` only
 * decides WHICH twelve and costs nothing, which is why 0371 widened it to a day
 * and left the turn count alone. Past twelve turns the answer has to be
 * retrieval; stuffing a day of transcript into every prompt is what #238
 * explicitly rules out.
 *
 * ## The boundary is stated even when recall finds nothing
 *
 * That is the half Grant asked for. A model told "there are 40 earlier turns
 * and you can see 12" will say so; one told nothing will answer across the gap
 * and sound certain.
 *
 * Never throws. A failed lookup returns no memory and no boundary line, which
 * is exactly the behaviour that existed before this function.
 */
async function recallOlder(
  db: SqlExecutor,
  commandId: string,
  instruction: string,
  jobId: string,
): Promise<Memory> {
  if (commandId === '') return NOTHING_OLDER

  // The conversation is the CLAIMED job's office's (0783), never one found by chat and speaker alone.
  const office = `app.job_office(${lit(jobId)}::uuid)`
  const extent = await db
    .execute(`select app.conversation_extent(${office}, ${lit(commandId)}::uuid) as e`)
    .then(
      (r) =>
        (r.rows[0] as { e?: Record<string, number> } | undefined)?.e ?? {
          turns_total: 0,
          window_turns: 12,
        },
    )
    .catch(() => null)
  if (extent === null) return NOTHING_OLDER

  const total = Number(extent.turns_total ?? 0)
  const windowTurns = Number(extent.window_turns ?? 12)
  /*
    Nothing is out of reach, so there is nothing to say and nothing to fetch.
    The common case, and it costs the one query above.
  */
  if (total <= windowTurns) return NOTHING_OLDER

  const recalled = await db
    .execute(
      `select app.recall_conversation(${office}, ${lit(commandId)}::uuid, ${lit(instruction.slice(0, 500))}, 3) as r`,
    )
    .then((r) => (r.rows[0] as { r?: unknown } | undefined)?.r)
    .then((raw) =>
      Array.isArray(raw)
        ? raw.map((x) => {
            const e = x as Record<string, unknown>
            return {
              at: String(e.at ?? ''),
              minutesAgo: Number(e.minutes_ago ?? 0),
              said: String(e.said ?? ''),
              answered: String(e.answered ?? ''),
            }
          })
        : [],
    )
    .catch(() => [])

  const older = total - windowTurns
  return {
    recalled,
    boundary:
      `This conversation has ${String(total)} turns. You can see the last ` +
      `${String(windowTurns)}; ${String(older)} earlier ${older === 1 ? 'turn is' : 'turns are'} ` +
      'out of view. ' +
      (recalled.length > 0
        ? `${String(recalled.length)} older ${recalled.length === 1 ? 'turn' : 'turns'} matching this ` +
          'question have been retrieved below — quote them if they answer it. '
        : 'Nothing older matched this question. ') +
      'If you are asked about something earlier and cannot establish it from what is ' +
      'here, say plainly that you cannot rather than guessing across the gap.',
  }
}

/**
 * The turns before this one, as the model will see them.
 *
 * Empty for a message with no command id — an MCP-enqueued instruction has no
 * chat behind it — which is correct rather than degraded: there is no
 * conversation to carry.
 */
async function conversationBefore(
  db: SqlExecutor,
  commandId: string,
  jobId: string,
): Promise<
  readonly {
    said: string
    answered: string | null
    colleagues: string[]
    stillGoing: number
    waitingOnYou: number
  }[]
> {
  if (commandId === '') return []
  // Only this office's conversation (0783): the office is the claimed job's, never found from the command alone.
  const { rows } = await db.execute(
    `select app.conversation_before(app.job_office(${lit(jobId)}::uuid), ${lit(commandId)}::uuid) as t`,
  )
  const raw = (rows[0] as { t: unknown } | undefined)?.t
  if (!Array.isArray(raw)) return []
  return raw
    .map(
      (entry) =>
        entry as {
          said?: string
          answered?: string | null
          colleagues?: unknown
          stillGoing?: number
          waitingOnYou?: number
        },
    )
    .filter((entry) => typeof entry.said === 'string' && entry.said.trim() !== '')
    .map((entry) => ({
      said: String(entry.said),
      answered:
        entry.answered === null || entry.answered === undefined ? null : String(entry.answered),
      /*
        WHAT THE SPECIALISTS CAME BACK WITH (0549).

        All 56 real child jobs had written an output and not one could reach
        a later turn, because the reader took only the parent's own. So the
        office asked two specialists, they answered, and it told Grant it had
        nothing.

        A payload gaining a key needs THREE places to learn it — the reader,
        the prompt and the provenance bucket — and the two that are not the
        renderer fail silently, which CLAUDE.md records costing a Governance
        section that read "0 open" over fourteen rows.
      */
      colleagues: Array.isArray(entry.colleagues)
        ? entry.colleagues.map((c) => String(c)).filter((c) => c.trim() !== '')
        : [],
      /*
        AND WHAT HAS NOT COME BACK (0550). A child still running, and one
        paused with an open blocker waiting on him. The office could not
        answer "what are you working on" because nothing told it.
      */
      stillGoing: Number(entry.stillGoing ?? 0),
      waitingOnYou: Number(entry.waitingOnYou ?? 0),
    }))
}

/**
 * Put a drafted standing rule to Grant, and return the sentence that shows it
 * to him — or null if there is nothing to show (#147).
 *
 * Returns null on three quite different outcomes, deliberately collapsed
 * because the answer looks identical from here: the class was already offered
 * once, the rule was refused as empty, or the write failed. Only the last is a
 * fault, and only the last records one — a write allowed to fail without
 * failing the job has to say so somewhere, which this repository has already
 * paid for once in a `consultations` table that never held a row.
 */
async function offerRule(
  db: SqlExecutor,
  correction: Pick<Correction, 'rule' | 'fragment' | 'because'>,
  job: Job,
): Promise<string | null> {
  /*
    The signals, in the shape the page can render.

    `suggestions.because` is read by the Governance page as a row of chips: a
    number in ink beside a label, or a bare label for a signal that simply
    fired. An array or a sentence in here is dropped by that renderer or
    stretches the row, so the reason gets recorded and then cannot be seen —
    which is the whole complaint about a column nothing reads, one layer along.
  */
  const signals: Record<string, boolean | number> = {
    words: correction.fragment.split(/\s+/).filter((w) => w !== '').length,
  }
  for (const signal of correction.because) {
    signals[signal.replace(/^it /, '').replace(/\s+/g, '_')] = true
  }
  const because = JSON.stringify(signals)
  let row: { offered?: boolean; rule?: string; error?: string } | undefined
  try {
    const { rows } = await db.execute(`
      select app.propose_standing_rule(
        app.job_office(${lit(job.jobId)}::uuid),
        ${lit(correction.rule)}, 'global', null, null,
        ${lit(job.jobId)}::uuid, ${lit(because)}::jsonb) as r`)
    row = (rows[0] as { r?: { offered?: boolean; rule?: string; error?: string } } | undefined)?.r
  } catch (error) {
    await db
      .execute(`
        select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
          'standing-rule', 'chief-of-staff',
          ${lit(`could not offer a standing rule: ${String((error as Error)?.message ?? error).slice(0, 160)}`)},
          ${lit(correction.rule.slice(0, 280))})
      `)
      .catch(() => undefined)
    return null
  }
  if (row?.offered !== true) return null
  /*
    The drafted text verbatim, on its own line, because he is approving the
    sentence and not a summary of it. No claim is made here — nothing has been
    stored, and saying otherwise would be the shape of lie every coherence gate
    in this office exists to catch.
  */
  return `I have not changed anything, but I could make that a standing rule:\n\n  "${correction.rule}"\n\nAccept or decline it on the Governance page.`
}

/**
 * Decide, against reality, whether each named project already exists.
 *
 * Grant: *"please don't assume I wish to create a new project. This is a large
 * task and should always be confirmed. In my example I was telling it to work
 * on an existing project."*
 *
 * He was right and the cost was visible: he had a notebook called "AI
 * learning", the planner read "a new project called AI Learning" literally and
 * made a second one beside it. Three notebooks by the end of the session, one
 * intention.
 *
 * ## Our projects first, Google second
 *
 * A project row is free to read and is the thing the rest of the system works
 * against. Listing Grant's notebooks is a network call, so it happens only when
 * nothing local matches — which is exactly the case where being wrong is
 * expensive, and the one case where the answer is worth a round trip.
 *
 * ## Case- and space-insensitive, deliberately
 *
 * "AI Learning" and "AI learning" are the same notebook to a person, and a
 * matcher that disagreed would recreate the exact defect this exists to close.
 */
async function resolveProjects(db: SqlExecutor, plan: Plan, jobId: string): Promise<Plan> {
  const named = plan.steps.filter((s) => s.kind === 'project')
  if (named.length === 0) return plan

  const normalise = (v: string): string => v.toLowerCase().replace(/\s+/g, ' ').trim()

  /*
    Ours, resolved by NAME rather than by exact string equality.

    This used to be a `Map` keyed on the lowercased, space-collapsed project
    name, and a lookup that missed became `create_project`. That is a defensible
    rule right up until the words are slightly different from the name — "the
    wellness project" against a project called "Wellness & Health" — at which
    point every near miss silently becomes a new project. It is how
    `ai-learning-2` got made, and how three notebooks called some version of
    "AI Learning" got made.

    `app.resolve_project_by_name` (0153) does the same exact match first, then
    aliases Grant has taught it, then trigram similarity, and returns SCORED
    candidates rather than a yes or no. The thresholds below are this caller's
    to choose, and they are deliberately not the same as the ones the dashboard
    uses: filing work against the wrong project is worse than asking.
  */
  const CERTAIN = 0.9
  const WORTH_ASKING = 0.55

  const candidatesFor = async (
    name: string,
  ): Promise<{ project_id: string; slug: string; name: string; confidence: number }[]> => {
    /*
      The second argument is not a mode this handler is in. It is a question
      the DATABASE answers about the job that is asking.

      `app.harness_job` is the same canonical fact that already decides
      whether a delivery may reach a destination (0523) and whether a task
      appears on Grant's own list (0530). It is false for every message a
      person sends, so this resolves against exactly the rows it always did;
      for harness traffic it also admits fixture projects, which is what lets
      the simulated world be asked about at all without a real project being
      created for it (#295, 0534).

      Computed in SQL rather than fetched first, so there is no extra round
      trip and no moment where this code holds a boolean it could get wrong.
    */
    const { rows } = await db.execute(`
      select r.project_id::text, r.slug, r.name, r.confidence::float8 as confidence
        from app.resolve_project_by_name(
               app.job_office(${lit(jobId)}::uuid),
               ${lit(name)},
               app.harness_job(${lit(jobId)}::uuid)) r
       order by r.confidence desc
       limit 5
    `)
    return rows as { project_id: string; slug: string; name: string; confidence: number }[]
  }

  /** The notebook attached to a project we already run, if it has one. */
  const notebookFor = async (projectId: string): Promise<string | null> => {
    const { rows } = await db.execute(`
      select a.external_ref
        from public.project_attachments a
        join public.projects p
          on p.project_id = a.project_id and p.office_id = app.job_office(${lit(jobId)}::uuid)
       where a.project_id = ${lit(projectId)}::uuid
         and a.connector = 'notebooklm' and a.enabled
       limit 1
    `)
    const ref = (rows[0] as { external_ref?: string } | undefined)?.external_ref
    return ref === undefined ? null : String(ref)
  }

  // Grant's, when ours does not have it. One network call, only when needed.
  let theirs: Map<string, string> | null = null
  const google = async (): Promise<Map<string, string>> => {
    if (theirs !== null) return theirs
    const actions = await NotebookActions.fromVault(db)
    if (actions === null) {
      theirs = new Map()
      return theirs
    }
    try {
      theirs = new Map((await actions.notebooks()).map((n) => [normalise(n.title), n.id] as const))
    } catch {
      // A failed listing must not turn into "so I will make a new one". An
      // unknown answer resolves to `project`, which the description renders as
      // a question rather than as a decision.
      theirs = new Map()
    }
    return theirs
  }

  const steps: Step[] = []
  for (const step of plan.steps) {
    if (step.kind !== 'project') {
      steps.push(step)
      continue
    }
    const found = await candidatesFor(step.name)
    const certain = found.filter((c) => c.confidence >= CERTAIN)

    // Exactly one confident match is the ordinary case, and it resolves.
    if (certain.length === 1 && certain[0] !== undefined) {
      const ref = await notebookFor(certain[0].project_id)
      if (ref !== null) {
        steps.push({ kind: 'use_project', name: certain[0].name, notebookRef: ref })
        continue
      }
    }

    // Two confident matches, or one that is only close, is a question. Note
    // that this fires BEFORE the round trip to Google: if we already have
    // something plausibly by that name, whether Grant also has a stray notebook
    // called it is not the question that needs answering.
    const worth = found.filter((c) => c.confidence >= WORTH_ASKING)
    if (certain.length > 1 || (certain.length === 0 && worth.length > 0)) {
      steps.push({
        kind: 'ambiguous_project',
        name: step.name,
        candidates: worth.slice(0, 3).map((c) => ({ name: c.name, slug: c.slug })),
      })
      continue
    }

    const theirs = (await google()).get(normalise(step.name))
    steps.push(
      theirs === undefined
        ? { kind: 'create_project', name: step.name }
        : { kind: 'use_project', name: step.name, notebookRef: theirs },
    )
  }

  return { ...plan, steps }
}

export function instructionHandler(deps: InstructionDeps): Handler {
  return {
    kind: 'office.instruction',
    handle: async (job: Job): Promise<HandlerOutput> => {
      // raw-sql[2]: keyed by the claimed job; it reads the payload of the job the worker holds.
      const { rows } = await deps.db.execute(
        `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
      )
      const payload = ((rows[0] as { pinned_config?: Payload } | undefined)?.pinned_config ??
        {}) as Payload
      let instruction = String(payload.instruction ?? '').trim()
      /*
        The transcript, quoted, when this arrived as a voice note.

        It rides on the say-back rather than arriving as its own message —
        Grant, 11 September: *"I sent a single voice, and I kinda split the
        message up over two... Try to have everything self contained."* Null for
        a typed instruction, where quoting his own text back is just noise.
      */
      let heardText: string | null = null
      if (instruction === '' && (payload.voice_file_id ?? null) !== null) {
        instruction = await listen(deps.db, job, payload)
        heardText = `🎧 Heard: “${instruction}”`
      }
      if (instruction === '') throw new Error('the command carried no instruction')
      /*
        Without the noise speech puts into it (ledger R27): fillers, a word
        said twice, a date or time corrected in place. "Heard:" above still
        quotes the transcript exactly; this is what the readers are given.
      */
      const saidWords = asHumanWords(instruction)
      instruction = cleanDictation(instruction)

      // Two messages that are one instruction. Grant shares a video and then
      // says what to do with it, or the reverse; both halves are correct alone
      // and wrong apart. See `src/agents/pairing.ts`.
      const paired = await pairWithNearby(deps.db, job, payload, instruction)
      if (paired !== null) instruction = paired

      /*
        WHAT HE SAID, FIXED HERE AND NEVER REBOUND (run 1, `src/agents/turn.ts`).

        Everything from this line to the resolver reads `cleanedWords`; the
        resolver reads `keptOf(...)`; and after it `turn` says which text is
        which for good. `instruction` used to be reassigned at each of these
        steps - cleaned, then kept, then a model's rewrite - so what it held
        depended on where in the file you were, and each reader chose by luck.

        The retraction is READ here (a pure function) and its record written
        where it always was, below. Reading it early is what lets the gates
        below ask "was that a yes?" of the words he actually meant.
      */
      const isBranch = String(payload.handed_off_by ?? '') !== ''
      const cleanedWords = asHumanWords(instruction)
      const retractionRead = retractionOf(cleanedWords)
      const keptBeforePeel = asHumanWords(retractionRead?.kept ?? cleanedWords)
      let previous: Promise<
        Awaited<ReturnType<typeof conversationBefore>>[number] | undefined
      > | null = null
      /** The turn before this one, read at most once and only when a gate needs it. */
      const previousTurn = () =>
        (previous ??= conversationBefore(deps.db, String(payload.command_id ?? ''), job.jobId)
          .catch(() => [])
          .then((turns) => turns.at(-1)))
      const rejects = rejectsWithoutSaying(cleanedWords)
      const closes = closesWithoutAsking(cleanedWords)
      let heardAnswer: AnswerClause | null = null
      let early: EarlyGate = null
      /*
        The database is asked only when a gate could speak. Reading the
        previous turn in front of every message to serve the short ones would
        put a query where there was none.
      */
      if (!isBranch && (rejects || closes || answerClause(keptBeforePeel) !== null)) {
        const last = await previousTurn()
        const questionWaiting = last !== undefined && Number(last.waitingOnYou ?? 0) > 0
        heardAnswer = questionWaiting ? answerClause(keptBeforePeel) : null
        early = decideEarlyGate({
          answer: heardAnswer?.reading ?? null,
          rejects,
          closes,
          questionWaiting,
          // A question of ours in prose, with no blocker behind it, is answered by
          // "yes, thanks" too; only a turn that asked him nothing may be closed.
          weAsked: String(last?.answered ?? '')
            .trim()
            .endsWith('?'),
        })
      }

      /*
        What "it" refers to (#63).

        Grant: *"seems to have problems recalling what we talked about
        before."* Until now every message was handled with only its own text,
        so "make the audio one long" arrived with no subject — and the plan
        parser was handed a sentence missing its noun and blamed for missing
        half of it (#60).

        AFTER pairing, deliberately: pairing joins a link to its caption and
        produces the fuller sentence, which is the better thing to resolve
        against a history. Before it, the resolver would be handed a fragment.

        Most messages never reach a model — `needsResolving` is a cheap test
        and self-contained sentences are returned untouched.
      */
      /*
        A rejection with nothing in it, answered BEFORE the resolver sees it
        (#231).

          Grant: "That is not what I meant at all."

        The office replied *"Routed to Ruby. You asked for Ruby's input on the
        margin impact, so I'm passing this to them"* — the previous turn
        happening again, at the moment he said it was wrong. Twice on the same
        build, so not a coin flip.

        `resolveAgainstThread` is doing exactly what it is for: a message with
        no content of its own resolves into the last instruction in the
        conversation. But the last instruction is the thing being rejected, so
        the better the resolver gets, the more confidently it reconstructs the
        misunderstanding — and then the hand-off path fires on it and looks,
        to Grant, like not being listened to.

        Before the resolver, therefore, and not after: by the time resolution
        has happened the contentless message is gone and there is nothing left
        to recognise. Answered in code because there is exactly one honest
        answer and a model is not needed to find it — the same argument as the
        empty-history reply above it.
      */
      /*
        AN OPEN QUESTION OUTRANKS GENERIC REJECTION (audit B3).

        "No." is two things at once: the shortest refusal of a question the
        office asked and the shortest rejection of its last answer. The
        precedence is stated in `src/agents/gates.ts` and decided above, by
        STATE and not by phrase: a question waiting and a yes or a no in his
        words is an answer, and the spoken-answer path further down owns it.
      */
      if (early === 'reject') {
        const last = await previousTurn()
        /*
          Attributed, because #65's whole finding was 499 jobs with a NULL
          `recipient_agent` and Grant reasonably concluding nothing was being
          delegated. This path returns before `speaker()` runs, so the row
          would be nobody's — and an empty roster already means the Chief of
          Staff everywhere else in this system, which is exactly who asks a
          clarifying question.
        */
        // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
        await deps.db
          .execute(`
            update public.jobs set recipient_agent = 'chief-of-staff'
             where job_id = ${lit(job.jobId)}::uuid`)
          .catch(() => undefined)
        return {
          body:
            'Sorry — let me not guess at that. ' +
            (last === undefined || last.answered === null
              ? 'What were you after?'
              : `What did I get wrong about ${
                  last.said.length > 80 ? `${last.said.slice(0, 77)}...` : last.said
                }?`),
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: await howComposed(deps.db, job.jobId),
          model: null,
        } satisfies HandlerOutput
      }

      /*
        A close that asks for nothing (ledger R43), answered before the
        resolver turns it back into the previous request — unless the last
        turn left a question of ours waiting on him, when it is an answer.
      */
      if (closes) {
        const last = await previousTurn()
        if (early === 'close') {
          // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
          await deps.db
            .execute(`
              update public.jobs set recipient_agent = 'chief-of-staff'
               where job_id = ${lit(job.jobId)}::uuid`)
            .catch(() => undefined)
          return {
            body:
              last !== undefined && Number(last.stillGoing ?? 0) > 0
                ? 'Right. I will come back to you when what is still going on has finished.'
                : 'Right — nothing else from me.',
            confidence: 'high',
            evidence: 'verified',
            sources: [`job:${job.jobId}`],
            contradictions: null,
            path: await howComposed(deps.db, job.jobId),
            model: null,
          } satisfies HandlerOutput
        }
      }

      /*
        His words, before the resolver rewrites them (#147).

        `resolveAgainstThread` expands a fragment into the instruction it
        refers to, which is exactly what the answering path needs and exactly
        what a correction reader must not see: "no, at the end" resolves into
        the whole of the previous request, and a standing rule drafted from
        THAT would be a rule saying what he was already asking for rather than
        what he wanted changed. Same reason `rejectsWithoutSaying` is checked
        above the resolver and not below it.
      */
      /*
        A clause he took back in the same breath never reaches the planner.

        #291 and its escalation: three live runs had the office CREATE a task
        from a half of the message the person had already withdrawn, and one
        of them raised a blocker too. A wrong answer can be argued with; a
        task, a message or a blocker is left behind in the world.

        Applied here, above the resolver, for the reason the paragraph above
        gives about corrections: resolveAgainstThread expands a fragment into
        the instruction it refers to, so by the time it has run the pivot is
        gone and the withdrawn half has been rewritten into something that
        reads like a request.

        The withdrawn words are kept, not discarded, because the office has
        to SAY what it set aside - that clause is the whole reason erring
        towards withdrawal is defensible rather than merely convenient.
      */
      const retraction = retractionRead
      if (retraction !== null) {
        await deps.db
          .execute(`
            select app.understood(${lit(job.jobId)}::uuid,
              ${lit(`withdrawn in the same message, after "${retraction.pivot}": ${retraction.withdrawn}`.slice(0, 400))})
          `)
          .catch(() => undefined)
      }

      const resolved = await resolveAgainstThread(
        deps.db,
        deps.router,
        String(payload.command_id ?? ''),
        keptOf(cleanedWords, retraction, heardAnswer),
        { correlationId: job.correlationId, jobId: job.jobId },
      )
      const turn = buildTurn({
        said: saidWords,
        cleaned: cleanedWords,
        retraction,
        answer: heardAnswer,
        resolved,
        addressedTo: payload.addressed_to ?? null,
        isBranch,
      })
      /*
        From here `instruction` is the ROUTING text: what the resolver made of
        what he kept, good for choosing who answers and for what a model reads,
        and never for deciding what he asked for. That is `turn.kept`.
      */
      instruction = turn.resolved

      /*
        FORWARDED WORDS ARE CONTENT, NOT INTENT - the class, not three writers (0624, final audit review). Asked once,
        here, from the durable record of how the turn arrived, before any reader runs; every consequence-bearing reader
        below is reached through `entitled`, which for a forwarded turn is the one in which nobody asked for anything.
        A failed ask reads as forwarded (a permitting guard must fail closed); only a schema without the function
        (an older database) reads as not.
      */
      const forwarded = await deps.db
        .execute(`select app.job_forwarded(${lit(job.jobId)}::uuid) as f`)
        .then((r) => (r.rows[0] as { f?: unknown } | undefined)?.f === true)
        .catch((error: unknown) => !/42883|does not exist/i.test(String((error as Error).message)))
      const entitled = forwarded ? noneEntitled : allEntitled

      const who = await speaker(
        deps.db,
        payload.addressed_to ?? null,
        instruction,
        deps.router,
        job.projectId ?? null,
        payload.addressed_also ?? [],
        job.jobId,
      )

      /*
        A request addressed TO the person answering is a request for the work, not for an introduction (#408).

        "Ask the finance specialist to summarise the budget assumptions" reached the finance director as is, and she answered
        "let me know which finance specialist you want to handle this". Only a leading "ask|have|get <her> to" is removed, only
        when she is the one named, and only from the text a model reads: every reader that decides to DO something reads his own
        words (`turn.kept`), so this can improve an answer and cannot start work. See own-task.ts.
      */
      instruction = ownTask(instruction, who)

      /*
        Write down who it went to (#65).

        `jobs.recipient_agent` has existed since the job engine and was NULL on
        all 499 real jobs — the routing decision was made, recorded in
        `routing_decisions`, and then thrown away. So "did Emma do this?" had
        no answer, and Grant reasonably concluded nothing was being delegated.

        This is the whole of the cheap half of the fix: the decision already
        existed, it just never reached the row anyone would look at.
      */
      // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
      await deps.db
        .execute(`
          update public.jobs set recipient_agent = ${lit(who.slug)}
           where job_id = ${lit(job.jobId)}::uuid
        `)
        .catch(() => undefined)

      /*
        Convene the REST of the roster, for real (#233).

        `pickRoster` may name up to five people and this handler used one. The
        others were recorded in `routing_decisions.roster` and then discarded,
        so the office could show Grant a decision it had never acted on:
        across every real job in its history `delegation_depth` was 0 and no
        agent had ever handed work to another. #65's shape one layer out — the
        decision existed and never reached the thing that acts.

        Each additional specialist gets a CHILD JOB, which is the mechanism the
        schema already provides: `app.enqueue_child` inherits the correlation
        id, the project and the requester, and `enforce_delegation_depth` caps
        the chain at `agents.max_delegation_depth` so that delegation cannot
        spawn delegation without a person saying so.

        Three properties make this safe rather than a job multiplier:

        - `p_announce => false`. Grant hears from the Chief of Staff and
          nobody else (`telegram.only_chief_speaks`), and a hand-off that
          messaged him would break that in the loudest possible way. The work
          still appears on the dashboard, attributed to whoever did it, which
          is where he asked to see it.
        - `addressed_to` names the specialist, so the child takes the
          addressed-directly branch of `speaker` and convenes nobody further.
          The chain terminates at one by construction, not merely by the cap.
        - Bookkeeping may never fail Grant's actual work. A refusal is recorded
          as an impediment and the primary answer goes out regardless — the
          same rule as the consultation write below, and for the reason
          CLAUDE.md gives: a swallowed error on a write nobody reads back is
          indistinguishable from a feature that was never built.
      */
      /*
        IS THIS ALREADY BEING PURSUED? ONE DECISION, MADE ONCE (#316).

        The first version of this fix asked inside `planAndPursue`, which runs
        AFTER the roster hand-off below — so on a repeated request the office
        convened a specialist AND then said "I have not started it a second
        time". Both halves right alone, only their disagreement wrong, which
        CLAUDE.md records as the hardest kind to see. The decision belongs
        here, above everything that starts work.

        Grounded in canonical state: the candidates are the jobs this
        conversation actually handed on, excluding this turn's own (0558).
        Nothing is compared against a corpus or a similarity threshold —
        suppressing "draft the pricing deck" as a duplicate of "draft the
        pricing email" is the silent direction and the worse one.

        `wantsAnotherGo` is the clause #316 names: unless he clearly asks for
        another independent attempt. It is deterministic because it is the
        only thing that AUTHORISES duplication.
      */
      /*
        AND IT READS WHAT HE SAID, NOT WHAT THE RESOLVER MADE OF IT.

        Fourth instance of the class #322 and #327 name. `instruction` was
        replaced by `resolveAgainstThread` eighty lines up, and every pattern
        in `again.ts` is anchored to a whole short sentence -- which is what
        an elliptical follow-up is, and precisely what the resolver expands.
        Driven against the live resolver on a real thread, both directions
        happen:

            he said : try it again
            resolved: try the view on what the venue change does to the
                      budget again
            -> DECLINED (the referent is 50 characters; `IT` caps at 40)

            he said : give it another go
            resolved: Ask them again.
            -> 'retry', which he never authorised

        The first loses a deliberate retry and tells him it is already
        running. The second is the expensive one this file warns about: a
        paraphrase MANUFACTURING the only clause that authorises duplication.

        `resolved.from` is his pre-rewrite text when there is one, and when
        there is not, `instruction` is untouched -- so this is always his own
        words, never the disjunction #327 could afford. A guard that PERMITS
        may not read a paraphrase.
      */
      const askedForAnother = entitled.anotherGo(turn.kept)
      const alreadyRunning =
        String(payload.handed_off_by ?? '') !== '' ||
        askedForAnother !== null ||
        asksWhoIsOnIt(turn.kept) !== null
          ? null
          : await deps.db
              .execute(`
                select app.conversation_work(
                  app.job_office(${lit(job.jobId)}::uuid),
                  ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid,
                  interval '24 hours',
                  ${lit(job.jobId)}::uuid) as r`)
              .then(async (r) => {
                const raw = (r.rows[0] as { r?: unknown })?.r
                const work = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
                  in_flight?: { job?: string; about?: string; who?: string }[]
                  recently_done?: {
                    job?: string
                    about?: string
                    who?: string
                    answer?: string
                    hit_trouble?: boolean
                  }[]
                } | null
                /*
                  RUNNING AND JUST-FINISHED, TOGETHER (0559).

                  On v741 a request repeated 54 seconds later duplicated,
                  correctly by the letter of the earlier fix: the first
                  attempt had COMPLETED, and only stoppable work was offered
                  as a candidate. #316's eighth case is exactly this, and it
                  is the real-traffic shape — Grant's two identical PDF
                  requests were 190 seconds apart.
                */
                return alreadyPursuing(
                  instruction,
                  [
                    ...(work?.in_flight ?? []).map((w) => ({
                      job: String(w.job ?? ''),
                      about: String(w.about ?? ''),
                      who: String(w.who ?? 'someone'),
                    })),
                    /*
                      A FINISHED JOB THAT RECORDED AN IMPEDIMENT IS NOT AN
                      ANSWER (0560).

                      On v743 the office relayed "here is what Grace found: I
                      have not done this" and suppressed the retry — telling
                      him his repeat was unnecessary at the exact moment it
                      was the only thing that could still get him an answer.
                      #316's ninth case: previous work failed, retry.

                      Read from `job_impediments`, never from the wording: the
                      coherence gate phrases its refusals half a dozen ways
                      and a literal-string check is a wording lock.
                    */
                    ...(work?.recently_done ?? [])
                      .filter((w) => w.hit_trouble !== true)
                      .map((w) => ({
                        job: String(w.job ?? ''),
                        about: String(w.about ?? ''),
                        who: String(w.who ?? 'someone'),
                        answer: String(w.answer ?? ''),
                      })),
                  ],
                  deps.router,
                  { jobId: job.jobId, correlationId: job.correlationId },
                )
              })
              .catch(() => null)

      /*
        TWO DIFFERENT TRUTHS, TWO DIFFERENT SENTENCES.

        Still running: say who has it, and do not start a second one.
        Just finished: give him the ANSWER, because that is what he was
        asking for — he repeated himself because nothing had arrived, and
        replying "that is already done" without the result would be the
        office being right and useless in the same breath.

        Both end by naming the way to get another go, because refusing to
        duplicate is only safe if asking for a duplicate is easy.
      */
      const alreadyOn =
        alreadyRunning === null
          ? null
          : (alreadyRunning.answer ?? '').trim() !== ''
            ? `You asked me that a moment ago and it came back — here is what ` +
              `${alreadyRunning.who === 'someone' ? 'it' : alreadyRunning.who} found:\n\n` +
              `${(alreadyRunning.answer ?? '').trim().slice(0, 600)}\n\n` +
              'Say the word if you want it done again from scratch.'
            : `${alreadyRunning.who === 'someone' ? 'Somebody' : alreadyRunning.who} is already on that — ` +
              `"${alreadyRunning.about.trim().slice(0, 120)}" is running now, so I have not started it ` +
              'a second time. Say the word if you want somebody else to take a separate look.'

      /*
        AND IF HE ASKED FOR ANOTHER PERSON, PUT ANOTHER PERSON ON IT (0561).

        On v745 "get another person to look at that as well" produced NOTHING.
        The authorisation was honoured — nothing was suppressed — and then the
        ordinary routing convened nobody, because the sentence names no
        subject: "that" is a pro-form and `who_knows_about` has nothing to
        match.

        So every duplicate-suppressing reply ended "say the word if you want
        somebody else to take a separate look", and the word did nothing —
        the offer-that-cannot-be-performed defect, manufactured by the fix
        that added the offer.

        The work comes from canonical state (the conversation's most recent
        obligation) rather than from the words, and the person is somebody not
        already carrying it.
      */
      const secondOpinion =
        askedForAnother !== 'another_person' || String(payload.handed_off_by ?? '') !== ''
          ? null
          : await deps.db
              .execute(`
                select app.another_pair_of_eyes(
                  app.job_office(${lit(job.jobId)}::uuid),
                  ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid,
                  ${lit(job.jobId)}::uuid) as r`)
              .then(async (r) => {
                const raw = (r.rows[0] as { r?: unknown })?.r
                const pick = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
                  ok?: boolean
                  slug?: string
                  about?: string
                  why?: string
                } | null
                if (pick?.ok !== true) {
                  /*
                    Said out loud. "There is nothing to look at again" is a
                    real answer; going quiet would be the same defect one
                    layer further in.
                  */
                  return pick?.why === 'everybody is already on it'
                    ? 'Everyone I could put on that is already on it.'
                    : 'There is nothing of mine running or just finished that I could put somebody else on.'
                }
                const started = await deps.db
                  .execute(`
                    select app.enqueue_child_once(
                      app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'office.instruction',
                      ${lit(`${String(pick.slug ?? '')}: ${String(pick.about ?? '').slice(0, 2_000)}`)},
                      jsonb_build_object(
                        'instruction', ${lit(String(pick.about ?? '').slice(0, 4_000))},
                        'addressed_to', ${lit(String(pick.slug ?? ''))},
                        'origin_channel', ${lit(String(payload.origin_channel ?? 'teamhq'))},
                        'command_id', ${lit(String(payload.command_id ?? ''))},
                        'handed_off_by', ${lit(who.slug)}
                      ),
                      false${callerArgs(job)}
                    ) ->> 'created' as made`)
                  .then((x) => String((x.rows[0] as { made?: string })?.made ?? 'false'))
                return started === 'true'
                  ? `Asked ${String(pick.slug ?? 'somebody')} to take a separate look at ` +
                      `"${String(pick.about ?? '')
                        .trim()
                        .slice(0, 120)}". I will come back with what they make of it.`
                  : `${String(pick.slug ?? 'They')} already has that one.`
              })
              /*
                RECORDED, NOT SWALLOWED.

                The first version of this ended `.catch(() => null)` and the
                path silently did nothing — indistinguishable from a feature
                that was never built, which is the exact defect CLAUDE.md
                records about `consultations` sitting empty for weeks behind
                one silent catch. He asked for a second opinion; if the office
                cannot arrange one it has to say so somewhere he looks.
              */
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'put a second person on this', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return 'I could not arrange a second look at that just now. Ask me again and I will retry.'
              })

      const branchesStarted: { agent: string; jobId: string }[] = []
      /*
        A QUESTION ABOUT THE WORK IS NOT WORK (#316).

        "how many people are on that?" convened a specialist on v737 — the
        office put somebody on answering a question canonical state answers
        outright, and that child then looked like a duplicate of the thing it
        was asking about. Read from the instruction rather than from the
        clause split, because this runs before `understand` and the shape is
        a whole short sentence by construction.
      */
      /*
        HIS OWN WORDS, because the rewrite is never the short sentence this
        reads for (#327, and #322's rule one reader further out).

        The comment above says "the shape is a whole short sentence by
        construction". That is true of what Grant typed and false of what
        reaches here: `instruction` was replaced by `resolveAgainstThread` two
        hundred lines up, and an elliptical follow-up is exactly what the
        resolver EXPANDS. Measured on a live turn —

            he said : who have you got on that
            resolved: Who have you got on the task of providing Grant with a
                      view of the budget impact of the venue change and a view
                      on sponsor participation?

        — and `asksWhoIsOnIt` correctly declines the second, because it is
        anchored to a sentence ending in a referent. So the guard declined, the
        hand-off ran, and asking who was on the work CONVENED TWO MORE PEOPLE
        and spent two more model calls on an answer the rows already held.

        It cannot use `firstOfHis`: that is built from `understood`, three
        hundred lines below, and this deliberately runs before it. `resolved.from`
        is his pre-rewrite text and is what the pattern was written against.
      */
      const aboutTheWork =
        asksWhoIsOnIt(resolved.from ?? instruction) !== null || asksWhoIsOnIt(instruction) !== null
      for (const other of aboutTheWork || alreadyOn !== null ? [] : who.alsoConvened) {
        /*
          ONCE PER SPECIALIST PER OBLIGATION (#316, 0556).

          This is the fan-out that actually happens in this office — driving
          the fix found that `office.pursue` is the rarer one and that every
          duplicated child in the reproduction came from here. Grant asked
          for the same thing twice, 190 seconds apart, on his real Telegram,
          and got two of these.

          The specialist is part of the key: two people on one request are
          two legitimate obligations, and the same person on the same request
          twice is the duplicate. The payload keeps its own `instruction`, so
          `enqueue_child_once` leaves it alone.
        */
        const spawned = await deps.db
          .execute(`
            select app.enqueue_child_once(
              app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'office.instruction',
              ${lit(`${other}: ${instruction.slice(0, 2_000)}`)},
              jsonb_build_object(
                'instruction', ${lit(instruction.slice(0, 4_000))},
                'addressed_to', ${lit(other)},
                'origin_channel', ${lit(String(payload.origin_channel ?? 'teamhq'))},
                'command_id', ${lit(String(payload.command_id ?? ''))},
                'handed_off_by', ${lit(who.slug)}
              ),
              false${callerArgs(job)}
            ) ->> 'job_id' as id
          `)
          .catch((error: unknown) => ({ rows: [{ id: null, e: (error as Error).message }] }))
        const row = spawned.rows[0] as { id?: string | null; e?: string } | undefined
        if (row?.id === null || row?.id === undefined) {
          await deps.db
            .execute(`
              select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                'hand-off', ${lit(who.slug)},
                ${lit(`could not hand part of this to ${other}: ${(row?.e ?? 'unknown').slice(0, 160)}`)},
                ${lit(instruction.slice(0, 280))})
            `)
            .catch(() => undefined)
          continue
        }
        /*
          And record the hand-off itself.

          `requested_by` is the SPECIALIST here, not the Chief of Staff — that
          is the whole difference between this row and the one written below
          it, and the only way §9's economics question can distinguish "Claire
          picked somebody" from "a specialist reached for another specialist".
          The RPC refuses a self-consultation, which is the guard that keeps
          that distinction honest.

          The last argument is `p_requests` — provider requests, not depth.
          Zero, because none have been spent yet; whatever judges the child's
          output fills the rest in.
        */
        await deps.db
          .execute(`
            select app.record_consultation(app.job_office(${lit(job.jobId)}::uuid),
              ${lit(job.jobId)}::uuid, ${lit(other)},
              ${lit(who.slug)},
              ${lit(`convened alongside ${who.slug}: ${who.reason}`.slice(0, 400))}, 0)
          `)
          .catch(() => undefined)
        branchesStarted.push({ agent: other, jobId: row.id })
      }

      /*
        And something that WAITS for them and answers (#262).

        The office has fanned out for weeks — the loop above is real
        concurrency, one child job each, each answering in their own name. What
        it has never had is the other half: nothing waited for those children
        and nothing drew them together, so Claire answered from her own reading
        while three specialists were still working and their findings landed on
        the dashboard separately.

        Registered rather than re-created: `app.fan_in_over` takes the jobs that
        already exist, which is why the loop above is untouched. Two or more,
        because a fan-in over one branch is just that branch.

        Never fatal. A group that could not be registered costs the synthesis
        and leaves every specialist's own answer exactly where it already was.
      */
      /*
        ONE IS ENOUGH (0562).

        This read `>= 2`, and the comment above explains why: a fan-in over
        one branch is just that branch. True about the WORK and wrong about
        the ownership — canonical traffic says 5138 real turns convened
        nobody, 2 convened one, and **none has ever convened two**, so the
        gate stood one above the only shape that happens and a single
        specialist's answer had nothing responsible for delivering it. It
        finished after the Chief had answered, `only_chief_speaks` kept it off
        his phone, and it disappeared.

        `office.synthesise` relays a single branch verbatim rather than
        drawing it together, so this costs no model call and invents nothing.
      */
      if (branchesStarted.length >= 1) {
        await deps.db
          .execute(`
            select app.fan_in_over(
              app.job_office(${lit(job.jobId)}::uuid),
              ${lit(job.jobId)}::uuid,
              ${lit(instruction.slice(0, 1_000))},
              ${lit(
                JSON.stringify(
                  branchesStarted.map((b) => ({
                    agent: b.agent,
                    job_id: b.jobId,
                    purpose: `what ${b.agent} makes of it`,
                  })),
                ),
              )}::jsonb,
              'office.synthesise',
              app.now_utc() + interval '20 minutes'${callerArgs(job)})
          `)
          /*
            A REFUSAL IS NOT A THROW, AND THIS ONLY CAUGHT THROWS (0563).

            `app.fan_in_over` returns `{error: …}` rather than raising, so
            when it refused every call for months — its own `v_count < 2`
            matching this gate exactly — nothing threw, nothing was recorded,
            and the fan-in simply did not happen. Lowering the gate here
            alone changed nothing and said nothing.

            CLAUDE.md's own rule: a swallowed error on a write nobody reads
            back is indistinguishable from a feature that was never built.
            The returned object is read now, and a refusal is recorded in the
            same place a throw would be.
          */
          .then(async (r) => {
            const raw = (r.rows[0] as { fan_in_over?: unknown } | undefined) ?? {}
            const got = Object.values(raw)[0]
            const answer = (typeof got === 'string' ? JSON.parse(got) : got) as {
              error?: string
            } | null
            if (typeof answer?.error === 'string' && answer.error !== '') {
              await deps.db
                .execute(`
                  select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                    'draw several answers together', ${lit(who.slug)},
                    ${lit(`the fan-in was refused: ${String(answer.error).slice(0, 140)}`)},
                    ${lit(instruction.slice(0, 280))})`)
                .catch(() => undefined)
            }
            return undefined
          })
          .catch(async (error: unknown) => {
            await deps.db
              .execute(`
                select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                  'draw several answers together', ${lit(who.slug)},
                  ${lit(`could not set up the fan-in: ${String((error as Error).message).slice(0, 140)}`)},
                  ${lit(instruction.slice(0, 280))})`)
              .catch(() => undefined)
            return undefined
          })
      }

      /*
        And record it as a consultation when it is genuinely a hand-off.

        §9's consultation economics table has never held a row, so there has
        been no way to ask whether specialists are worth convening.
        `changed_outcome` is left null here and filled by whatever judges the
        output — recording the consult is not the same as claiming it helped,
        and a table that assumed it did would answer its own question.

        Not recorded when Claire keeps the work: the chief of staff handling
        something herself is not a consultation, and counting it would make the
        rate look healthy while nothing was delegated at all.
      */
      if (who.slug !== 'chief-of-staff' && (payload.addressed_to ?? '') === '') {
        /*
          Through `app.record_consultation`, which takes SLUGS.

          The previous version wrote the INSERT by hand and had never once
          succeeded: `consulted_staff` and `requested_by` are uuids, and it
          passed a `text[]` and the string 'chief-of-staff'. Every hand-off
          since the code landed raised, and the `.catch(() => undefined)`
          below swallowed it — so §9's consultation table stayed empty while
          the code read as finished, and #65's box stayed red for a reason
          nobody could see.

          A swallowed error on a write nobody reads back is indistinguishable
          from a feature that was never built. So the RPC does the resolution
          (one place, impossible to get wrong from here), and a refusal is
          recorded as an impediment rather than discarded — it is still not
          allowed to fail the job, because Grant's actual work must not stop
          because bookkeeping did.
        */
        const said = await deps.db
          .execute(`
            select app.record_consultation(app.job_office(${lit(job.jobId)}::uuid),
              ${lit(job.jobId)}::uuid, ${lit(who.slug)},
              'chief-of-staff', ${lit(who.reason)}, 0) as r
          `)
          .catch((error: unknown) => ({
            rows: [{ r: { error: (error as Error).message.slice(0, 200) } }],
          }))
        const answer = (said.rows[0] as { r?: { error?: string } } | undefined)?.r
        if (answer?.error !== undefined) {
          await deps.db
            .execute(`
              select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                'record-consultation', 'chief-of-staff',
                ${lit(`could not record the hand-off to ${who.slug}: ${answer.error}`)},
                ${lit(instruction.slice(0, 280))})
            `)
            .catch(() => undefined)
        }
      }

      // Is this several things at once? If so, say it back and hold it.
      //
      // Grant: *"probably a good idea that he confirms he understands and spits
      // back what I want before going ahead."* A one-step instruction is
      // better served by doing it — a permission slip for one thing is
      // friction — so `readPlan` returns null below two substantive steps and
      // the single-step paths below take over.
      /*
        What the office believes it was asked (#47, migration 0296).

        Written BEFORE anything acts, which is the whole value: an output built
        on a misreading looks like a perfectly good output, and the restatement
        is the one place the misunderstanding shows while it is still cheap.

        The resolved instruction, not the raw one — after #63's thread has put
        the pronouns back — because that is the sentence everything downstream
        actually works from, and a restatement of a sentence nobody acts on
        would check the wrong thing.

        Deterministic, and therefore free: no model call. A model asked to
        paraphrase would introduce a second reading, and then a wrong
        restatement could come from the paraphrase rather than from the
        misunderstanding it is supposed to expose.
      */
      await deps.db
        .execute(`
          select app.understood(${lit(job.jobId)}::uuid,
            ${lit(instruction.slice(0, 400))})
        `)
        .catch(() => undefined)

      const unresolved = entitled.plan(turn.kept)
      const plan =
        unresolved === null ? null : await resolveProjects(deps.db, unresolved, job.jobId)
      if (plan !== null) {
        /*
          A clause we could not plan is a typed impediment, not just an apology.

          #47 and #60 together. Saying "I could not work out how to research
          that" once is honest; saying it eleven times and nobody counting is
          how a missing capability stays missing. `needed` is the countable
          handle, so four agents hitting the same wall GROUP BY together and
          `impediments_tally` can turn a repeated one into a proposal (#49).

          Deliberately not fatal and deliberately not announced — the say-back
          already tells Grant. This is for the office's own record.
        */
        for (const missing of plan.unread ?? []) {
          const handle = missing.split(' ').slice(0, 3).join('-').toLowerCase()
          await deps.db
            .execute(`
              select app.cannot(${lit(job.jobId)}::uuid, 'missing_skill',
                ${lit(handle)}, 'chief-of-staff', ${lit(missing)},
                ${lit(instruction.slice(0, 280))})
            `)
            .catch(() => undefined)
        }
        // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
        await deps.db.execute(`
          update public.jobs
             set pinned_config = pinned_config
                   || jsonb_build_object('plan_steps', ${lit(JSON.stringify(plan.steps))}::jsonb)
           where job_id = ${lit(job.jobId)}::uuid
        `)
        await deps.db.execute(`
          select app.request_approval(
            app.job_office(${lit(job.jobId)}::uuid),
            ${lit(job.jobId)}::uuid,
            ${lit(`Carry out ${String(plan.steps.length)} steps: ${plan.instruction.slice(0, 160)}`)},
            ${lit(
              needsGrantToChoose(plan)
                ? // Asked first, because it is the one that cannot be answered by
                  // approving. A plan that does not know which project it is for
                  // has nowhere to put the work.
                  'One of these names matches something you already have. Tell me which ' +
                    'project you meant and I will carry on — approving this as it stands ' +
                    'would file the work against a guess.'
                : createsSomething(plan)
                  ? 'This CREATES a new project and a new notebook in your Google account. ' +
                    'Nothing by that name exists — say so if you meant an existing one.'
                  : 'Several steps, so I would rather check I have understood before starting any of them.',
            )},
            'office.execute_plan'
          )
        `)
        return {
          /*
            One message, not two.

            The transcript leads so he can still tell a mishearing from a
            misunderstanding at a glance — which is what he asked for when the
            echo was added — and then the say-back and the buttons follow in
            the same bubble. `heardText` is null when the instruction was
            typed, in which case quoting it back would just be repetition.
          */
          /*
            One message: what was heard, what it was taken to mean, the plan.

            The resolution line only appears when a rewrite happened. It is
            there because a resolution is a GUESS about what he meant — caught
            in the say-back it costs one message, acted on silently it costs
            the work.
          */
          body: [
            heardText,
            resolved.changed ? `↳ Taking that as: “${resolved.instruction}”` : null,
            /*
              Who it went to, and why (#65).

              Grant: *"I still don't really fully understand the role of the
              individual agents when I send Claire to do something."* The
              routing decision was being made and never said, so from the
              outside there was one bot with eight names.

              ONLY when the work actually left Claire. #65 is explicit that
              more delegation is not automatically better — *"a team that
              visibly passes his request around three times before answering is
              worse than one bot"* — and the chief of staff handling something
              herself is the ordinary case. Narrating that would be noise on
              every single message, and noise is how a line stops being read.

              The test the Issue sets is not how many agents touched it. It is
              whether Grant can tell the right person did it, which is one
              sentence when it is true and silence when it is not.
            */
            who.slug === 'chief-of-staff' ? null : `↳ Giving this to ${who.name} — ${who.reason}.`,
            describePlan(plan),
          ]
            .filter((part) => part !== null)
            .join('\n\n'),
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: await howComposed(deps.db, job.jobId),
          model: null,
        } satisfies HandlerOutput
      }

      // Does this carry a link? A link is the more specific reading and is
      // checked first: "add this video and make an audio overview" is two
      // instructions, and the link half must not be lost to the artifact half.
      /*
        "Wire this up to Notion."

        Checked before the link and artifact paths because it is the most
        specific reading: a message that says connect/attach/use AND names
        Notion is asking for a configuration change, and the alternative
        readings would answer it with prose. Grant said "just work with what you
        have for now" and got a paragraph, because nothing could act on it.

        Only when a project is known. Wiring up "whichever project this chat is
        about" when the chat is about nothing in particular is how a project
        gets attached to the wrong workspace.
      */
      /*
        "Populate the Notion teamspace from the course."

        Not a separate branch, because the brief that asked for it reads as
        BOTH: it says "use ... Notion", so `connectRequest` catches it, and it
        says "fully populate", so `populateRequest` does too. Both readings are
        right — he is asking for a workspace to be connected and then filled —
        and treating them as rival matches is how the first version would have
        attached three databases and left them empty, which is exactly the
        thing he complained about.

        So it is a sequence, not a choice. Adopt runs first because attaching is
        the precondition; the import follows a minute later so it finds the
        attachments waiting rather than racing them.
      */
      const fill = entitled.populate(turn.kept)
      const wire = entitled.connect(turn.kept)
      if ((wire !== null || fill) && job.projectId !== null && job.projectId !== undefined) {
        // A child of this job, so it inherits the correlation id, the priority
        // and — the part that matters — the project this instruction resolved
        // to. `enqueue_job` does not exist; `enqueue_child` is how the office
        // hangs follow-up work off the thing that asked for it.
        if (wire !== null) {
          await deps.db.execute(`
            select app.enqueue_child(
              app.job_office(${lit(job.jobId)}::uuid),
              ${lit(job.jobId)}::uuid,
              'office.notion_adopt',
              '{}'::jsonb,
              interval '0',
              true,
              ${lit(job.projectId)}::uuid${callerArgs(job)}
            )
          `)
        }
        if (fill) {
          await deps.db.execute(`
            select app.enqueue_child(
              app.job_office(${lit(job.jobId)}::uuid),
              ${lit(job.jobId)}::uuid,
              'office.notion_import',
              '{}'::jsonb,
              interval ${wire === null ? "'0'" : "'1 minute'"},
              true,
              ${lit(job.projectId)}::uuid${callerArgs(job)}
            )
          `)
        }
        const said = fill
          ? 'On it — putting the material we hold into Notion as Projects, Docs and Tasks. ' +
            'I will come back with what I created and the links.'
          : wire?.named === null || wire?.named === undefined
            ? 'Right — wiring this project up to the Notion databases we already have. ' +
              'I will say what I attached.'
            : `Right — wiring this project up to ${wire.named} in Notion. I will say what I attached.`
        return {
          body: said,
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: await howComposed(deps.db, job.jobId),
          model: null,
        } satisfies HandlerOutput
      }

      /*
        A BRANCH CONTRIBUTES PROSE. IT NEVER PERFORMS THE REQUEST AGAIN.

        #233's fan-out gives every additional convened specialist a child
        `office.instruction` carrying **the same instruction verbatim**, so
        every deterministic action below runs once per person convened. #258
        found that as two near-identical PDFs from one sentence and fixed it
        for `wantsFile`; #135 inherited the guard for `pageRequest`. Neither
        carried it to the rest, and the independent acceptance pass found the
        next instance: "Call it Review the onboarding copy" convened three
        people and put THREE tasks on Grant's list, from one reply.

        CLAUDE.md's #249/#254 pair is the reason this is one guard rather than
        a third copy of the same two lines — three defects filed separately
        were one defective abstraction, and the fix for it repeated the
        mistake a layer deeper. The abstraction is: an action belongs to the
        REQUEST, and a branch is a second reading of the request, not a second
        request. Every path below either answers (safe to do twice, the second
        answer is another voice) or acts (never safe to do twice).

        `handed_off_by` is set only by the two child enqueues that make a
        branch, so a request Grant ADDRESSES to a specialist directly carries
        `addressed_to` without it and is untouched — which is the case that
        matters, because that one is still his request.

        HOISTED above the semantic read as well as above the actions (#282): a
        branch performs nothing, so asking a model what the sentence means is
        several seconds spent to be told something this line already knows.
      */

      /*
        WHAT HE MEANS, BEFORE ANYTHING DECIDES WHAT TO DO (#282).

        Every recogniser below is a regex over the WHOLE message, and two
        production sentences show what that costs:

          > "I've told you to always give your information in the form of clear
          > bullet points. Also, I want you to tell me what my current tasks
          > are."

        The preference was stored and the turn RETURNED. The question vanished.

          > "Create a task for me and the um... No actually, you know what?
          > Scan the entirety of the Legacy Coaching Project and create
          > appropriate tasks for me to review."

        One task, titled with the remainder of the transcript — the abandoned
        fragment and the filler included.

        `clauses.split` already returned the right clauses for both. Nothing
        downstream read them. So this is not a missing phrase, it is the
        architecture: the splitter was right and its answer was thrown away.

        `understand` rewrites the utterance into N clean standalone requests
        and says which were abandoned. It DECIDES NOTHING. Each surviving
        request then goes through the same deterministic cascade, carrying
        every permission, capability, provenance, idempotency and approval
        guard the office has. A reading that says "Grant wants a task" is a
        description of an utterance, never a right to write a row.

        Every failure path — no provider, invalid JSON, an ungrounded rewrite —
        returns the whole utterance as one reading, which is exactly today's
        behaviour. The change cannot be worse than the status quo.
      */
      const understood = isBranch
        ? oneReading(turn.kept)
        : await understand(turn.kept, deps.router, {
            correlationId: job.correlationId,
            jobId: job.jobId,
          })

      /*
        WHICH READINGS MAY REACH AN ACTION, and why this filter only ever
        SUBTRACTS.

        The model's `kind` is not authorization and must not become it. It is
        used here in one direction only: to keep a clause the model read as a
        standing instruction or as a question away from the writers. A clause
        it read as a request still has to satisfy the same recogniser it
        satisfies today before anything is written.

        So the worst this filter can do is decline to act, which is the cheap
        direction — `mine.ts` already argues it: a miss costs a to-do Grant
        adds himself and the office still answers; a false positive costs him
        the WORK.
      */
      const MAY_ACT: ReadonlySet<ReadingKind> = new Set([
        'task_create',
        'task_change',
        'delegate',
        'other',
      ])
      const requests = understood.surviving.filter((r) => MAY_ACT.has(r.kind)).map((r) => r.text)

      /*
        Run one recogniser over each surviving request, in the order he said
        them, and take the first that claims one.

        The cascade is demonstrably good at ONE clear request and demonstrably
        bad at a paragraph of speech, so this hands it the former. Where the
        semantic layer fell back, `requests` is `[instruction]` and every call
        below is byte-for-byte what it is today.
      */
      /*
        FORWARDED WORDS ARE CONTENT, NOT INTENT - the readers below are the OTHER half of the class (final audit).
        `entitled` closes the ten permitting readers; these two closures are the door the task writers, the file
        request and the extraction reader go through, and a forwarded turn was still reading through them: a
        forwarded "mark the call Kevin one done" ticked a task, "cancel it" cancelled one, "add a task to wire the
        deposit" created one. So the door itself is silent for a forwarded turn, and a reader cannot be added behind
        it without being silent too.
      */
      const firstOf = <T>(read: (text: string) => T | null): T | null => {
        if (forwarded) return null
        for (const text of requests) {
          const got = read(text)
          if (got !== null) return got
        }
        return null
      }

      /*
        A DELEGATION IS NOT A TO-DO, and the difference is who performs it.

        Anchor B's surviving clause — "Scan the entirety of the X and create
        appropriate tasks for me to review" — is work for the office whose
        RESULT is several tasks. Split out of the transcript it still reached
        `taskRequest`, which filed one personal task called "appropriate tasks
        for me to review": the delegation performed as its own title. The
        abandoned fragment was gone and the remaining half was still wrong.

        `extract.ts` now recognises the shape, which is the deterministic half
        and the one that authorizes anything. This is the other half, and it
        only ever SUBTRACTS: a clause the model read as work for the office may
        not be written onto Grant's own list. If the recogniser declines it too
        the turn answers in prose, which is today's behaviour for anything
        nobody recognised.
      */
      const HIS_OWN: ReadonlySet<ReadingKind> = new Set(['task_create', 'task_change', 'other'])
      /*
        WHAT HE SAID COMES FIRST, AND THE REWRITE COMES SECOND (#313).

        `instruction` was replaced by `resolveAgainstThread` above, so every
        reader here sees a paraphrase rather than his words. That is right for
        the MODEL — a fragment has to stand alone before anything can answer
        it — and it is exactly wrong for these recognisers, which key on the
        elliptical shape BECAUSE the elliptical shape is what a follow-up
        looks like.

        Measured, in process, with the debug line this replaced:

            Grant : Make that urgent
            read as: Make the 'Ring the caterers …' task urgent
            change=null
            office: Added it: the 'Ring the caterers …' task urgent

        The rewrite turned a follow-up CHANGE into a fresh imperative CREATE:
        it put a junk row on his own list AND left the task he meant
        untouched. Both halves of the expensive direction in one turn.

        So his own words are tried first and the rewrite is kept as a
        fallback, because the resolution genuinely helps where his words carry
        no title of their own. This can only ever ADD a reading his own
        sentence supports; it never invents one from a paraphrase.
      */
      /*
        The turn before, read only for an elliptical "also one to…" (R7): the
        main thread read is far below and hoisting it would put a query in
        front of every message to serve this one.
      */
      const hisLastTurn = wantsAntecedent(turn.kept)
        ? // His last three turns, so "and another for the caterers" after "also one
          // to book the minibus" still reaches the turn that said "task".
          (
            await conversationBefore(deps.db, String(payload.command_id ?? ''), job.jobId).catch(
              () => [],
            )
          )
            .slice(-3)
            .map((t) => t.said)
            .join(' ')
        : ''
      /*
        "Also one to book the minibus" resolved against his OWN previous turn
        (R7). The model's reading of a thanks-plus-fragment surfaced no task
        clause at all, so no reader below was ever shown it; this is his
        sentence with "one" replaced by the noun his last message used, so it
        is grounded in his words by construction and can only add a reading.
      */
      const hisElliptical = resolveElliptical(turn.kept, `${turn.kept} ${hisLastTurn}`)
      const hisRequests = [
        ...(hisElliptical !== turn.kept ? [hisElliptical] : []),
        ...(resolved.changed && resolved.from !== null ? [resolved.from] : []),
        ...understood.surviving.filter((r) => HIS_OWN.has(r.kind)).map((r) => r.text),
      ]
      const firstOfHis = <T>(read: (text: string) => T | null): T | null => {
        if (forwarded) return null
        for (const text of hisRequests) {
          const got = read(text)
          if (got !== null) return got
        }
        return null
      }

      /*
        AND ONE CLAUSE IS EITHER A CHANGE OR A NEW THING, NEVER BOTH.

        Recognised here rather than where it is acted on, because the two
        create readers below run first and had no way to know. On one live
        turn the office both changed the task and created a second one from
        the same four words, and narrated both — "Added it: …" above
        "Changed — …". `personalTaskChange` and `personalTaskRequest` do not
        overlap on any create sentence in the corpus, so this only ever
        subtracts, which is the cheap direction `mine.ts` argues for.
      */
      const changesHis = isBranch ? null : firstOfHis(personalTaskChange)

      /*
        HE CALLED IT OFF (#315, 0555).

        Measured on v733: "stop that, I do not need it any more" stopped
        nothing, and the next turn was answered "there's no record of anyone
        having started work on it" over two children the conversation had made
        itself, one of them paused and still in flight.

        `retraction.ts` reads a withdrawal INSIDE one message and correctly
        declines a turn that is nothing but a withdrawal — which is how he
        actually changes his mind. `callsItOff` is that turn.

        Grounded exactly as #313 grounds a rename: what is acted on is the
        work THIS CONVERSATION handed on, never the newest thing anywhere.
        `app.stop_conversation_work` reports what it stopped, what refused,
        and what had already finished, and the sentence is composed from those
        rows rather than from having asked.

        A finished child is NOT claimed as stopped — taking back what it did
        is `app.hq_undo`'s question — and saying so is the difference between
        this and the answer that caused the Issue.
      */
      /*
        WHO IS ON IT, ANSWERED FROM THE ROWS (#316, 0557).

        Measured on v733 with two children of that very conversation in
        flight: "how many people are on that?" was answered with an offer to
        create a task. The true answer was two, one query away. The question
        reached document retrieval, which cannot answer it, and the model
        filled the gap.

        Checked here, BEFORE the readers that cannot answer it, and
        deliberately narrow: only the who / how-many class short-circuits.
        "what is happening with that?" keeps going down the ordinary path,
        because it may legitimately want a document.
      */
      const headCount = isBranch ? null : firstOfHis(asksWhoIsOnIt)

      /*
        AND WHAT DID THEY FIND? (#317)

        On v733, with one specialist blocked and one refusing:

            Grant : where exactly do they differ?
            office: I don't have any record of the team's actual comments, so
                    I can't point to exact phrasing where they diverge.
                    Generally, the "numbers" view flags the revenue hit
                    (X % lost ARR, churn risk)…

        The first clause is true; the second supplies exactly what the first
        said was unavailable, down to a literal `X %`. Every coherence gate
        passes it — no claim verb, and the hedge reads as care.

        Answered from the rows rather than gated. A gate makes the office
        quieter, and CLAUDE.md records what that cost the last time: two turns
        of an ordinary conversation refused and Grant receiving nothing. The
        rows have the answer, including the part he most needs — that one of
        them is waiting on HIM.
      */
      const wantsTheirAnswers = isBranch
        ? false
        : firstOfHis((t) => (asksWhatTheyFound(t) ? true : null)) === true
      const whoIsOn =
        headCount === null && !wantsTheirAnswers
          ? null
          : await deps.db
              .execute(
                /*
                  A LONGER WINDOW FOR "WHAT DID THEY FIND?".

                  The default thirty minutes is for spotting a repeat — a
                  person asking again because nothing arrived. Asking what
                  came back is a different question and its answer does not
                  go stale in half an hour, so the window follows the
                  question rather than the other way round.
                */
                `select app.conversation_work(
                   app.job_office(${lit(job.jobId)}::uuid),
                   ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid,
                   interval '24 hours', null,
                   ${wantsTheirAnswers ? "interval '24 hours'" : "interval '30 minutes'"}) as r`,
              )
              .then((r) => {
                const raw = (r.rows[0] as { r?: unknown })?.r
                const work = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
                  obligation?: string | null
                  in_flight?: { who?: string; about?: string }[]
                  recently_done?: {
                    who?: string
                    about?: string
                    answer?: string
                    hit_trouble?: boolean
                  }[]
                  finished?: number
                  waiting_on_you?: number
                } | null
                const live = work?.in_flight ?? []
                const finished = Number(work?.finished ?? 0)
                const waiting = Number(work?.waiting_on_you ?? 0)
                const back = work?.recently_done ?? []

                /*
                  "WHAT DID THEY COME BACK WITH?" IS A DIFFERENT QUESTION FROM
                  "WHO IS ON IT?" (#317).

                  It is answered with what actually came back, and when
                  nothing has, with WHY — which is the part he most needs,
                  because one of them may be waiting on him and he has no
                  other way to know.
                */
                if (wantsTheirAnswers) {
                  const said = back
                    .filter((w) => w.hit_trouble !== true && String(w.answer ?? '').trim() !== '')
                    .slice(0, 3)
                    .map(
                      (w) =>
                        `**${String(w.who ?? 'Someone')}**: ${String(w.answer ?? '')
                          .trim()
                          .slice(0, 700)}`,
                    )
                  if (said.length > 0) {
                    const rest =
                      live.length === 0
                        ? ''
                        : `\n\n${String(live.length)} other ${live.length === 1 ? 'piece' : 'pieces'} of that work ${live.length === 1 ? 'is' : 'are'} still running.`
                    return `${said.join('\n\n')}${rest}`
                  }
                  /*
                    NOTHING CAME BACK, AND THAT IS THE ANSWER.

                    The defect was answering this from general knowledge after
                    correctly saying there was no record. There is no
                    invention available here: every clause below is a count
                    from the rows.
                  */
                  const troubled = back.filter((w) => w.hit_trouble === true).length
                  const parts = ['Nothing has come back on that yet.']
                  if (waiting > 0) {
                    parts.push(
                      `${String(waiting)} of it is waiting on YOUR answer before it can go further — that is the thing holding it up.`,
                    )
                  }
                  if (live.length > 0) {
                    parts.push(
                      `${String(live.length)} ${live.length === 1 ? 'piece is' : 'pieces are'} still running.`,
                    )
                  }
                  if (troubled > 0) {
                    parts.push(
                      `${String(troubled)} came back unable to do it, so there is nothing from ${troubled === 1 ? 'that one' : 'those'}.`,
                    )
                  }
                  if (live.length === 0 && waiting === 0 && troubled === 0) {
                    parts.push('There is nothing of mine running on it either.')
                  }
                  return parts.join(' ')
                }
                /*
                  Nothing running is a real answer and it is said plainly.
                  What must never happen again is the office reporting this
                  from retrieval — "there's no record of anyone having started
                  work on it" over two children it made itself (#315).
                */
                if (live.length === 0) {
                  return finished === 0
                    ? 'Nobody is on it at the moment — there is nothing of mine still running on that.'
                    : `Nobody is still on it — ${String(finished)} ${finished === 1 ? 'piece' : 'pieces'} of that work ${finished === 1 ? 'has' : 'have'} already finished.`
                }
                const names = [...new Set(live.map((w) => String(w.who ?? 'someone')))]
                const who =
                  names.length === 1 && names[0] === 'someone'
                    ? ''
                    : ` — ${names.slice(0, 4).join(', ')}`
                /*
                  NAMED, NOT COUNTED (0562, 0564).

                  `jobs.state` says one job stopped executing; the obligation
                  state says what became of what he asked for. Counting live
                  children was the closest the office could get before the
                  distinction existed, and it cannot tell "two people are on
                  it" from "two people are on it and one of them needs you".
                */
                const named =
                  work?.obligation === 'waiting_on_user'
                    ? 'It is waiting on you'
                    : work?.obligation === 'partially_complete'
                      ? 'Part of that landed and part did not'
                      : null
                const head =
                  live.length === 1
                    ? `${named ?? 'One piece of work is running on that'}${named === null ? who : ''}.`
                    : `${named ?? `${String(live.length)} pieces of work are running on that`}${named === null ? who : ''}.`
                /*
                  #317's half, and it belongs in the same sentence: a blocker
                  he has not been told about is the office waiting on him
                  without his knowing. `waiting_on_you` existed canonically
                  and reached him nowhere.
                */
                const stuck =
                  waiting === 0
                    ? ''
                    : ` ${String(waiting)} of ${live.length === 1 ? 'it' : 'them'} ${waiting === 1 ? 'is' : 'are'} waiting on your answer before it can go further.`
                const done = finished === 0 ? '' : ` ${String(finished)} has already finished.`
                const about = live
                  .map((w) => String(w.about ?? '').trim())
                  .filter((a) => a !== '')
                  .slice(0, 2)
                  .map((a) => `\n  · ${a.slice(0, 120)}`)
                  .join('')
                return `${head}${stuck}${done}${about}`
              })
              .catch(() => null)

      /*
        And his literal words, when nothing survived the reading (ledger R26).
        hisRequests holds the pre-rewrite text only when the resolver CHANGED
        it, plus the model's surviving intents - and a pure withdrawal has no
        surviving intent, because the model rightly files it as abandoned. So
        "Actually forget it, don't bother with that." never reached this
        reader and prose asked him again for what he had withdrawn.
        callsItOff is anchored to the whole message, so the literal text is
        exactly what it was written for.
      */
      const calledOff =
        isBranch || changesHis !== null || answerOutranks(turn, 'call_off')
          ? null
          : (firstOfHis((text) => entitled.callsItOff(asHumanWords(text))) ??
            entitled.callsItOff(turn.kept))
      const stopped =
        calledOff === null
          ? null
          : await deps.db
              .execute(
                `select app.stop_conversation_work(
                   app.job_office(${lit(job.jobId)}::uuid),
                   ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid,
                   ${lit(`you asked me to stop: ${instruction.slice(0, 120)}`)}) as r`,
              )
              .then((r) => {
                const raw = (r.rows[0] as { r?: unknown })?.r
                const got = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
                  stopped?: number
                  could_not?: number
                  already_finished?: number
                } | null
                const n = Number(got?.stopped ?? 0)
                const finished = Number(got?.already_finished ?? 0)
                const refused = Number(got?.could_not ?? 0)
                /*
                  Nothing to stop is SAID, not glossed over. The office having
                  nothing in flight is a perfectly good answer and the honest
                  one; claiming to have stopped something would be the
                  claim-with-no-row this repository keeps paying for.
                */
                if (n === 0 && finished === 0 && refused === 0) {
                  return NOTHING_TO_STOP
                }
                const parts: string[] = []
                if (n > 0) {
                  parts.push(
                    n === 1
                      ? 'Stopped — one piece of work was still running and it is off now.'
                      : `Stopped — ${String(n)} pieces of work were still running and they are off now.`,
                  )
                }
                if (refused > 0) {
                  parts.push(
                    `${String(refused)} could not be stopped because ${refused === 1 ? 'it is' : 'they are'} already being written up.`,
                  )
                }
                if (finished > 0) {
                  parts.push(
                    n === 0
                      ? `Nothing was still running — ${String(finished)} had already finished. Recent activity on the dashboard has an Undo for what ${finished === 1 ? 'it' : 'they'} produced, if you want that taken back.`
                      : `${String(finished)} had already finished, so that part stands. Recent activity on the dashboard has an Undo for it, if you want that taken back.`,
                  )
                }
                return parts.join(' ')
              })
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'stop work this conversation started', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              })

      /*
        Is he teaching us something? (#48, #50)

        Grant: *"all behaviours, skills, what I want them to do, it can all just
        be told to them directly via Telegram or Slack."* Before this, both
        tables could only be written by Claude in a coding session — which makes
        the office's memory Claude's memory, not the office's.

        Checked BEFORE the link and artifact readers, because "from now on,
        always attach the notebook link" is a rule about attaching links and
        would otherwise be executed as a request to attach one.

        Only from Grant. An agent authoring its own procedures is the design
        (ADR-0017) but it is not this path: this path is a person in a chat
        window, and it stores what he says at high confidence because he said
        it.
      */
      /*
        THE CLAUSE THAT IS THE RULE, not the message that contains one (#282).

        Production anchor A, verbatim:

          > "I've told you to always give your information in the form of clear
          > bullet points. Also, I want you to tell me what my current tasks
          > are."

        `readTeaching` correctly recognised a rule and the turn RETURNED. The
        question was never answered and nothing anywhere recorded that half a
        message had been dropped.

        Two changes, and they are separable on purpose. This one narrows WHAT
        is stored to the preference clause, so the rule kept is the rule he
        stated rather than the rule plus a task query. The whole instruction is
        still read when the semantic layer named no preference — a union, never
        a substitution, so this can only ever store a rule it would have stored
        anyway.
      */
      const asRules = understood.surviving.filter((r) => r.kind === 'preference').map((r) => r.text)
      const teaching =
        /*
          A clause the meaning-reader already called a preference is passed
          as one (#290). The whole instruction is still read WITHOUT that
          flag, so the union can only ever store a rule it would have
          stored anyway.
        */
        /*
          His words, never the resolver's paraphrase (completion pass; #322's
          class). `instruction` is `resolved.instruction` by here, and a
          rewrite keeps the request and drops the marker: five plausible
          rewrites of anchor A, five nulls from `readTeaching`. And reading a
          paraphrase is the dangerous direction as well: one that adds an
          "always" would store a rule he never gave.

          And a MARKED reading wins (`strongestTeaching`). This was the defect
          actually observed: the meaning reader's own wording of the clause
          dropped the "always" ("Give your information in clear bullet
          points."), and as the first reading it turned a rule he stated into
          an OFFER on the Governance page — one door of four in one
          `verify:anchors` run and two of four in the next.
        */
        strongestTeaching([
          ...asRules.map((text) => entitled.teaching(asHumanWords(text), true)),
          entitled.teaching(turn.kept),
        ])

      /*
        AND STORING IT DOES NOT END THE TURN.

        The second change, and the one anchor A actually needed. An early
        return here is right when the rule is ALL he said — a bare "from now on
        use bullet points" wants exactly one sentence back. It is wrong the
        moment he said something else too, because the something else is then
        silently discarded.

        So the return is conditional on there being nothing else to do, and
        otherwise the confirmation joins the others at the bottom of this
        block, in the order he spoke. `requests` is the same list the actions
        run over, so the two cannot disagree about whether a second intent
        exists.
      */
      /*
        WHO TAUGHT IT, rather than an assumption that it was Grant.

        `remember` was called with the literal `'grant'`, so every lesson in
        `public.lessons` claims him as its author whoever sent the message —
        and `lessons.is_fixture` is GENERATED from that column, which means a
        suite driving this path stores a REAL standing preference on the
        Governance page that can never be removed (the table refuses DELETE and
        UPDATE by trigger). `verify:anchors` put thirteen copies of one rule
        there in an afternoon before this was noticed.

        `jobs.requested_by` is composed as `<origin_channel>:<subject>`, so the
        subject half is who sent it — the same field #65 and 0342 both turn on.
        `grant` remains the fallback, because a job with nothing recorded is
        one from before this existed.

        One query, on a path that fires only when he is actually teaching
        something.
      */
      // raw-sql[2]: keyed by the claimed job; it reads who requested the job the worker holds.
      const learnedBy = await deps.db
        .execute(`
          select coalesce(
                   nullif(split_part(coalesce(requested_by, ''), ':', 2), ''),
                   'grant') as v
            from public.jobs where job_id = ${lit(job.jobId)}::uuid`)
        .then((r) => String((r.rows[0] as { v?: string } | undefined)?.v ?? 'grant'))
        .catch(() => 'grant')

      /*
        MARKED IS STORED. UNMARKED IS OFFERED.

        #290's answer to "is explicit confirmation always necessary". It is
        not, and the line is what the PERSON said rather than what a reader
        inferred:

          "from now on keep it short"   they said it lasts  -> stored
          "keep it short"               they did not        -> offered

        The second is genuinely ambiguous between this answer and every
        answer, and two measurements say the office cannot tell: the prompt
        rewritten to a functional definition recognised 0 of 8 unseen manner
        statements, and a deterministic recogniser built from the domain
        scored 12/12 on the set it was tuned against and 2 OF 12 on a fresh
        one written afterwards.

        So recognition is unreliable, and #147's route already exists for
        exactly this: `app.propose_standing_rule` puts the drafted sentence
        on the Governance page and `app.decide_suggestion` is the only path
        by which it becomes a lesson. An unreliable reader that OFFERS costs
        one row with a decline button; the same reader storing silently is
        what put 34 junk lessons into every prompt (#297).

        Nothing about the marked path changes, so this is backward
        compatible by construction.
      */
      const ruleOffered =
        teaching !== null && teaching.kind === 'lesson' && (!teaching.marked || forwarded)
          ? await offerRule(
              deps.db,
              {
                rule: teaching.body,
                fragment: teaching.body,
                because: [
                  'a reader recognised it as a preference',
                  'it did not say it was lasting',
                ],
              },
              job,
            )
          : null

      const taught =
        teaching === null || ruleOffered !== null
          ? null
          : await remember(
              deps.db,
              { jobId: job.jobId },
              teaching,
              learnedBy,
              // Addressed to one person, or to the office. Getting this backwards
              // means a rule for Ruby quietly governing Daniel.
              (payload.addressed_to ?? '') === '' ? null : who.slug,
              job.jobId,
              /*
                And the PROJECT, when the message carried one (#310).

                Until now this argument did not exist and the scope could only
                be global or staff, so "on the bid, never put a due date on
                anything" became a rule for every project for ever. Where the
                message carried no project it stays null and the rule is
                global, which is #308's territory and is left visible rather
                than guessed: inventing the scope from the last project
                mentioned would put a rule on one he was not talking about.
              */
              job.projectId === null ? null : String(job.projectId),
            )
      /*
        NOTHING ELSE SURVIVED, which is not the same as nothing else to WRITE.

        The first version of this asked `requests.length === 0`, and `requests`
        excludes `task_query` on purpose — reading his list writes nothing. So
        anchor A, whose second clause is precisely a `task_query`, still
        returned on the rule and the question still vanished: the fix was
        present, compiled, unit-tested and inert, and only driving the real
        sentence found it. The question is whether he said anything ELSE, not
        whether that something else was an action.
      */
      const ruleWasAllHeSaid = understood.surviving.every((r) => r.kind === 'preference')
      /*
        An OFFER is also a complete turn when the rule was all he said. The
        sentence says nothing was changed, which is true, and names where to
        accept it.
      */
      if (ruleOffered !== null && ruleWasAllHeSaid) {
        return {
          body: ruleOffered,
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: await howComposed(deps.db, job.jobId),
          model: null,
        } satisfies HandlerOutput
      }
      if (taught !== null && ruleWasAllHeSaid) {
        return {
          body: taught.said,
          confidence: 'high',
          // The write either happened or the sentence says it did not.
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: await howComposed(deps.db, job.jobId),
          model: null,
        } satisfies HandlerOutput
      }
      // A link inside a FORWARDED message is material, never an instruction to attach it or file it (#393): attaching a
      // notebook or database is what later authorizes writes there.
      const sent = isBranch || forwarded ? null : entitled.link(turn.kept)
      const linked = sent === null ? null : await handleLinks(deps.db, job, sent)

      // Does this ask for something to be MADE? If so, make it, and let the
      // confirmation be the reply.
      // Both, independently. "Add this video and make an audio overview" is
      // two instructions in one sentence, and the first version answered only
      // the half it noticed first.
      const wanted = isBranch ? null : firstOf(notebookRequest)
      const made =
        wanted === null ? null : await act(deps.db, job, wanted.kinds, wanted.instructions)

      /*
        And a task, which until #237 the office could not create at all.

        `task.create` was in `tool_permissions`, enabled, granted to all eight
        agents and printed in every capability brief, while the nine actions an
        agent could actually request were all NotebookLM artefacts. A session
        found it in one turn: *"Yes, do it. Create the task."* produced *"Sure,
        I'll create it. I need a few details first: 1. Title 2. Due date
        3. Owner 4. Parent task"* — and `public.tasks` stayed empty. A promise
        it could not keep, asking for three optional fields and one that is not
        a parameter of the writer.

        `taskRequest` keys off the CLASSIFICATION, not off the word "task", and
        that is what keeps the four-way distinction the same session proved
        holds: a thought, a question and an explicit hold all wrote nothing.
        Only a confident command or assignment reaches the writer.
      */
      /*
        "Pull the tasks out of the pricing brief" — many tasks, none of them
        stated, inside something the office has to go and read (#130).

        Checked BEFORE `taskRequest`, and the order is the whole point: "make
        tasks from the workshop notes" satisfies both readings and only one of
        them is what he meant. Reading it as a single task would file one
        called "tasks from the workshop notes" and read nothing.

        A CHILD JOB rather than work done here, for the same reason the
        hand-off is: this turn is a conversation and that one is a model call
        over up to fourteen thousand characters. It appears in Active Jobs, is
        cancellable, and is traced like everything else.
      */
      /*
        Asking what the notebook HAS (#260).

        Checked before the extraction and the task, and after the generation
        matcher — `artifactListing` returns null for anything `notebookRequest`
        claimed, so the two can never both fire and the order here only decides
        which guard reads the sentence first.

        A CHILD JOB, for the reason the extraction is one: this turn is a
        conversation and that one is a round trip to NotebookLM plus a poll per
        finished artifact. It appears in Active Jobs, is cancellable, and is
        traced like everything else. This turn goes quiet about it and the
        child speaks, so Grant gets one message rather than two.
      */
      const listing = job.projectId === null || isBranch ? null : firstOf(artifactListing)
      const enumerating =
        listing === null
          ? null
          : await deps.db
              .execute(`
                select app.enqueue_child(
                  app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'notebook.list_artifacts',
                  jsonb_build_object(
                    'kinds', ${lit(JSON.stringify(listing.kinds))}::jsonb,
                    'origin_channel', ${lit(String(payload.origin_channel ?? 'teamhq'))},
                    'command_id', ${lit(String(payload.command_id ?? ''))}
                  ),
                  interval '0', true${callerArgs(job)}
                )::text as id`)
              .then(() =>
                listing.kinds.length === 0
                  ? 'Looking through the notebook to see what it has made — back shortly.'
                  : `Looking through the notebook for ${listing.kinds
                      .map((k) => KIND_LABEL[k] ?? k)
                      .join(' and ')} — back shortly.`,
              )
              // Same rule as the hand-off and the extraction: bookkeeping may
              // never fail Grant's actual work, and a swallowed write is
              // indistinguishable from a feature nobody built.
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'list what the notebook has made', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))}, null)`)
                  .catch(() => undefined)
                return null
              })

      /*
        A request for a FILE, not for a paragraph (#258).

        Grant asked for a researched PDF back through Telegram and was told the
        office had no means. This is where the means is reached, and it goes
        before the extraction and the task path deliberately: "write me a
        report on what needs doing" is a report, not twelve tasks, and whichever
        of the three claims the sentence first decides what he gets.

        A child job rather than this turn, because writing a report takes a
        model call over eight documents and this turn has to answer him now.
        The child's answer carries the file.
      */
      /*
        AND NOT ON A BRANCH (#258).

        `alsoConvened` hands each additional specialist a CHILD carrying the
        instruction verbatim, so a second reader of "write me a PDF report"
        starts a second `artifact.report` — and the first live Slack round trip
        produced exactly that: two near-identical PDFs in one project from one
        sentence, finishing seconds apart. CLAUDE.md names the cost by name: an
        answer citing two of them as separate sources is the provenance defect
        this office keeps paying for, manufactured here.

        A file is ONE deliverable for one request. A branch is a contribution to
        it, not a second copy of it, so a branch answers in prose and the lead's
        report is the artifact. `handed_off_by` is set only by the hand-off
        enqueue, so it is the exact thing that distinguishes the two — and a
        request Grant ADDRESSES to a specialist directly carries `addressed_to`
        without it and is untouched.

        The same guard, in the same shape, as `pullOut` two paragraphs below:
        whichever of the three claims the sentence first decides what he gets.
      */
      /*
        ASKING TO BE REMINDED TO MAKE SOMETHING IS NOT ASKING FOR IT NOW (#325).

        "Remind me to write the one-pager for the venue change" fires BOTH
        `artifactRequest` and `personalTaskRequest` on his own words -- and the
        artifact reading is taken first, so the office produced a PDF and never
        added the reminder. Performing it now is the one response that defeats
        the request: he said when he wanted to do it, and it was not now.

        The mood of a sentence is set by its main clause, which this repository
        has already paid for three times -- a complement clause read as a
        condition, a delegation's span read as three intents, "suggest when we
        should decide" filed as a standing procedure. Here the making is the
        OBJECT of the reminder.

        Read from his words, because a deferral is his to make: the veto that
        follows at `forGrant` reads `firstOfHis` and this read the clause
        list, so the two could disagree about the same sentence. Narrow by
        construction -- `personalTaskRequest` needs "remind me", "add a task
        for me", "on my list" or "I must", none of which a bare "write me a
        one-pager" carries.
      */
      const deferred = isBranch
        ? null
        : firstOfHis((text) => {
            // Grounded in his words, for the reason given at the project-task reader.
            const got = personalTaskRequest(resolveElliptical(text, `${turn.kept} ${hisLastTurn}`))
            if (got === null || !groundedIn(got.title, turn.kept)) return null
            /*
              And a change of mind inside the sentence names the task by what
              SURVIVED it (ledger R27): "add a task to chase kevin, no
              actually, email kevin about the quote" was titled with the whole
              sentence. The project reader already consults the retraction
              reader when it composes a title; this one never did.
            */
            const kept = readRetraction(text)?.kept?.trim() ?? ''
            if (kept === '') return got
            const named = taskTitle(kept) ?? kept
            return { ...got, title: named.charAt(0).toUpperCase() + named.slice(1) }
          })
      /*
        AND IT DOES NOT MAKE A SECOND ONE WHILE SAYING IT HAS NOT.

        `alreadyOn`'s own comment two thousand lines up is unambiguous --
        *"Still running: say who has it, and do not start a second one"* -- and
        the artifact branch had never been told. Driven live, one reply said
        all of this:

            You asked me that a moment ago and it came back -- here is what it
            found: ... Say the word if you want it done again from scratch.
            Writing that up as a PDF from what this project holds.

        It offered him the choice and then took it for him in the next
        sentence. Two PDFs into the project, which is the provenance harm this
        repository keeps paying for: an answer citing two copies of one thing
        as two sources.

        The structural door cannot cover it. `jobs_one_live_per_idempotency_key`
        is partial on LIVE jobs, deliberately, so once the first report
        completes a second is permitted -- and #316's measured shape is two
        identical requests three minutes apart, by which time the first has
        finished. The decision has to be the one already made above.

        Suppression is safe here for the reason `already.ts` gives about
        itself: every failure of that judgement returns null, so the only way
        this fires is the model positively identifying the new sentence as
        real work already done. And asking for it again is one word, which the
        reply he is reading has just told him.
      */
      const wantsFile =
        job.projectId === null || isBranch || deferred !== null || alreadyOn !== null
          ? null
          : firstOf(artifactRequest)

      /*
        A request to READ A PAGE (#135, #16).

        The browser tier had no door. `browser.gather` is a registered handler
        with an adapter behind it, an append-only ledger, a project surface,
        sessions in the Vault, a ten-minute budget and a Stop — and NOTHING
        ever enqueued one, so none of it was reachable from any sentence Grant
        could say. #72's defect at the top of the stack, and invisible to the
        check written for #72: `check:callers` walks database functions, and a
        job kind nobody enqueues is not a function.

        After `wantsFile` and guarded on it, for the reason #258 states in
        capitals two paragraphs up: whichever of the claims the sentence makes
        first decides what he gets, and asking for a document about a page is
        asking for a document. `pageRequest` declines that sentence on its own
        anyway — it carries no reading verb — so this guard is belt and braces
        rather than the thing doing the work, and the unit test asserts both
        halves so the next change cannot quietly make them disagree.

        Not on a branch, for #258's reason exactly: a branch carrying the
        instruction verbatim would open the same page a second time, spend the
        budget twice and file two documents for one request.
      */
      /*
        Only when he ASKED for it to be read.

        `pageRequest` also matches a BARE link, and a bare link has meant "add
        this to the project's notebook" since `linkRequest` was written --
        people paste a link at a colleague meaning "deal with this". That
        default is good and nobody asked to change it, so the gather fires only
        on `why: 'asked'`, which is the same field `linkRequest` now consults,
        so the two paths cannot both claim one sentence.
      */
      const askedForPage =
        job.projectId === null || isBranch || wantsFile !== null || alreadyOn !== null
          ? null
          : entitled.page(turn.kept)
      const wantsPage = askedForPage?.why === 'asked' ? askedForPage : null
      const reading =
        wantsPage === null
          ? null
          : await deps.db
              .execute(`
                select app.enqueue_child(
                  app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'browser.gather',
                  jsonb_build_object(
                    'url', ${lit(wantsPage.url.slice(0, 2_000))},
                    'because', ${lit(wantsPage.because.slice(0, 500))},
                    'by', ${lit(who.slug)},
                    'origin_channel', ${lit(String(payload.origin_channel ?? 'teamhq'))},
                    'command_id', ${lit(String(payload.command_id ?? ''))}
                  ),
                  interval '0', true${callerArgs(job)}
                )::text as id`)
              .then(
                () =>
                  `Opening ${hostForSaying(wantsPage.url)} now — I will read it and keep what ` +
                  'it says with this project. I only read; I do not press anything.',
              )
              .catch(async (error: unknown) => {
                /*
                  Recorded rather than swallowed. A write allowed to fail
                  without failing the job has to say so somewhere, or it is
                  indistinguishable from a feature nobody built — which is the
                  defect this whole block exists to undo.
                */
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'open a web page', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))}, null)`)
                  .catch(() => undefined)
                return null
              })
      const writingFile =
        wantsFile === null
          ? null
          : await deps.db
              .execute(`
                select app.enqueue_child(
                  app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'artifact.report',
                  jsonb_build_object(
                    'brief', ${lit(wantsFile.brief.slice(0, 2_000))},
                    'by', ${lit(who.slug)},
                    'origin_channel', ${lit(String(payload.origin_channel ?? 'teamhq'))},
                    'command_id', ${lit(String(payload.command_id ?? ''))}
                  ),
                  interval '0', true${callerArgs(job)}
                )::text as id`)
              .then(
                () =>
                  'Writing that up as a PDF from what this project holds \u2014 I will send you ' +
                  'the file when it is done.',
              )
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'write a report as a file', ${lit(who.slug)},
                      ${lit(`could not start it: ${String((error as Error).message).slice(0, 140)}`)},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              })

      const pullOut =
        job.projectId === null || wantsFile !== null || isBranch || alreadyOn !== null
          ? null
          : firstOf(extractionRequest)
      const extracting =
        pullOut === null
          ? null
          : await deps.db
              .execute(`
                select app.enqueue_child(
                  app.job_office(${lit(job.jobId)}::uuid), ${lit(job.jobId)}::uuid, 'office.extract_tasks',
                  jsonb_build_object(
                    'from', ${lit(pullOut.from ?? '')},
                    'origin_channel', ${lit(String(payload.origin_channel ?? 'teamhq'))},
                    'command_id', ${lit(String(payload.command_id ?? ''))}
                  ),
                  interval '0', true${callerArgs(job)}
                )::text as id`)
              .then(() =>
                pullOut.from === null
                  ? 'Reading what this project holds and pulling out what needs doing — back shortly.'
                  : `Reading ${pullOut.from} and pulling out what needs doing — back shortly.`,
              )
              /*
                A refusal is recorded and the turn still answers. Same rule as
                the hand-off: bookkeeping may never fail Grant's actual work,
                and a swallowed error on a write nobody reads back is
                indistinguishable from a feature that was never built.
              */
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'extract-tasks', ${lit(who.slug)},
                      ${lit(`could not start the extraction: ${String((error as Error).message).slice(0, 140)}`)},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              })

      /*
        WHOSE WORK IS IT (#259, ADR-0041).

        Before the task path and before the extraction, because it is the same
        precedence question those two already answer between themselves:
        whichever reading claims the sentence first decides what Grant gets,
        and "remind me on Friday to ring the venue" is not a job for the office
        however many verbs it contains.

        `personalTaskRequest` is grammatical rather than lexical — it asks who
        performs the verb — and it is deliberately narrow, because the two
        errors are not comparable. A miss costs a to-do he adds himself and the
        office still answers. A false positive costs him the WORK: he asked for
        something, it went on his own list, and nothing happened. The one
        overlap, "I need you to…", is excluded by name and has its own test.

        The task is written here rather than as a child job: there is nothing
        to think about, the row is one insert, and a child job would mean he
        gets "I will add that" now and the task some seconds later.
      */
      // A request for a FILE is not a to-do, and it is decided above.
      /*
        ONE READING, TWO CALLERS. `deferred` is the same `firstOfHis` reading
        the artifact veto above consults; assembling it twice is how the
        command bar's renderer and its keyboard picker came to disagree.
      */
      /*
        A SUBTASK IS NOT A NEW TASK (ledger R6). Read first, from his words,
        so "add checking the figures as a subtask under it" can veto both
        flat-task readers - which otherwise filed his whole sentence as the
        title of a task with no parent.
      */
      const subOf =
        isBranch || forwarded ? null : (firstOfHis(subtaskRequest) ?? subtaskRequest(turn.kept))
      const forGrant =
        wantsFile !== null || isBranch || changesHis !== null || subOf !== null || forwarded
          ? null
          : deferred
      const noted =
        forGrant === null
          ? null
          : await deps.db
              .execute(`
                select app.my_task_add(
                  p_office => app.job_office(${lit(job.jobId)}::uuid),
                  p_title => ${lit(forGrant.title.slice(0, 200))},
                  p_due_on => ${forGrant.due === null ? 'null' : `${lit(forGrant.due)}::date`},
                  /*
                    The time he said, so the reminders duty sends it (ledger
                    R24). Nothing in the conversation set remind_at before, so
                    "remind me at 3pm" was a to-do nothing would ever raise.
                  */
                  p_remind_at => ${forGrant.remindAt == null ? 'null' : `${lit(forGrant.remindAt)}::timestamptz`},
                  /*
                    The project he is IN, if any. #259: a personal task may
                    belong to an Agentic Team project, and one added from a
                    project's chat plainly does. Looked up here rather than
                    carried in TypeScript because the writer takes a slug and
                    the job carries a uuid, and a second argument on the writer
                    for the convenience of one caller is how a function ends up
                    with eight.
                  */
                  p_project => ${
                    job.projectId === null
                      ? 'null'
                      : `(select slug from public.projects
                          where office_id = app.job_office(${lit(job.jobId)}::uuid)
                            and project_id = ${lit(job.projectId)}::uuid)`
                  },
                  /*
                    WHICH JOB MADE IT.

                    my_task_add has taken p_job since it existed and this
                    caller never passed it, so every task the office put on
                    Grant's own list carried no link to the turn that created
                    it: 33 of 41 rows. Three things depend on that link and
                    all three were blind.

                    app.harness_task(is_fixture, job_id) is ADR-0041's
                    boundary, the one place that keeps the office's own work
                    off his personal list - and with a null job it cannot
                    tell. Thirty tasks from simulated messages were sitting on
                    his list, indistinguishable from his own, reading
                    added_by = 'grant' because that is who the office
                    believed it was acting for.

                    app.undo_tasks_from_job is the reversal a person gets
                    when they say "take that back", and it matches on job_id,
                    so none of those thirty could be undone.

                    And check:leaks counts harness tasks the same way, so it
                    reported a clean list while they were on it.

                    One argument. It is not a harness accommodation: a task
                    with no provenance is one nobody can undo, attribute or
                    explain, and that is worth having for his own work too.
                  */
                  p_job => ${lit(job.jobId)}::uuid
                ) as t`)
              .then((r) => {
                const answer = (r.rows[0] as { t?: unknown })?.t
                const got = (typeof answer === 'string' ? JSON.parse(answer) : answer) as {
                  ok?: boolean
                  repeated?: boolean
                }
                /*
                  An offer may only promise what the press can perform. If the
                  insert was refused, say nothing about a task — the sentence
                  below would be a claim with no row behind it, which is the
                  fabrication the coherence gate exists to catch and which is
                  cheaper to simply not make.
                */
                if (got?.ok !== true) return null
                /*
                  The same message twice (ledger R18, 0592): the writer
                  returned the task this conversation made moments ago, so
                  saying "that is on your list" again would read as a second
                  one. Said plainly instead.
                */
                if (got.repeated === true) {
                  return `That is already on your list from a moment ago — "${forGrant.title}". I have not added it twice.`
                }
                /*
                  Said as the time it will arrive, in his zone, and "around"
                  because the reminders duty runs every fifteen minutes: a
                  promise to the minute would be one it cannot keep.
                */
                if (forGrant.remindAt != null) {
                  const at = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Europe/Athens',
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23',
                  }).format(new Date(forGrant.remindAt))
                  return `That is on your list for ${String(forGrant.due)} — "${forGrant.title}". I will remind you around ${at}.`
                }
                return forGrant.due === null
                  ? `That is on your list — "${forGrant.title}", no date on it yet.`
                  : `That is on your list for ${forGrant.due} — "${forGrant.title}".`
              })
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'add a personal task', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              })

      /*
        CHANGING ONE, which the conversation could never do (#259, 0516).

        "Remind me Friday to ring the venue" worked and *"Actually make that
        Monday"* did nothing at all — a task could be created by talking and
        only ever changed on the screen. Grant's brief names it: follow-ups
        changing due date, priority, project or wording.

        Only when nothing NEW was filed: a sentence that is itself a task is
        not a change to the last one, and `personalTaskChange` refuses those
        for the same reason one layer down.

        The subject is `app.my_task_referent` — the ONE task this conversation
        made — and never a title match, because a fuzzy match is one bad guess
        away from editing a row he did not mean. The confirmation NAMES what
        changed, which is the honest alternative to guessing well.

        It used to be `app.my_task_recent`: the newest open personal task in
        the last half hour, anywhere in the office. That is proximity rather
        than reference, and #259's own control caught what it costs — one
        "Call it X" renamed an unrelated task Grant had never mentioned
        (#313, 0551).
      */
      // A plural extraction is not a single task. `pullOut` having claimed the
      // sentence, `taskRequest` must not also file one from the same words —
      // and neither must it file one the personal-task path has already taken.
      const asked =
        pullOut !== null || noted !== null || isBranch || subOf !== null
          ? null
          : changesHis !== null
            ? null
            : firstOfHis((text) => {
                /*
                  A title from a REWRITE must be grounded in his words (ledger
                  R4b): "And put it down as mine." became a creation in the
                  paraphrase and filed the task he had just made a second
                  time. His literal reading comes first in hisRequests, so a
                  request he made himself is unaffected.
                */
                // His whole message is the antecedent for an elliptical "add one to…",
                // and his previous turn when this one does not name a task (R7).
                const got = taskRequest(text, classifyIntent(text), `${turn.kept} ${hisLastTurn}`)
                return got === null || got.title === null || groundedIn(got.title, turn.kept)
                  ? got
                  : null
              })

      /*
        And the ANSWER to "what should it be called?", which is the other half.

        The first version of the task path asked that question and then could
        not accept the reply: *"Call it Review the onboarding copy."* matched no
        task shape, fell through to prose, and the task was never created. A
        question whose answer is dead is worse than not asking — Grant has typed
        the same intention twice and has nothing to show for it.

        The lookup is only paid for when this could plausibly BE an answer:
        `taskRequest` did not already match, the message is short, and there is
        a conversation behind it. An explicit "call it X" needs no lookup at all.
      */
      const namedLater =
        asked !== null || isBranch || forwarded || instruction.trim().length > 90
          ? null
          : await deps.db
              .execute(`
                select coalesce(
                  (select left(o.body, 500) from public.outputs o
                     join public.inbound_commands c
                       on c.job_id = o.job_id and c.office_id = app.job_office(${lit(job.jobId)}::uuid)
                    where c.origin_channel = 'teamhq'
                      and c.command_id <> ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid
                      and split_part(c.origin_ref, ':', 1) = (
                        select split_part(origin_ref, ':', 1) from public.inbound_commands
                         where office_id = app.job_office(${lit(job.jobId)}::uuid)
                           and command_id = ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid)
                    order by c.received_at desc limit 1), '') as said`)
              .then((r) => String((r.rows[0] as { said?: string } | undefined)?.said ?? ''))
              /*
                HIS OWN WORDS, AND THE REWRITE ONLY AS A FALLBACK (#322).

                The third argument is what stops a request becoming a title
                (#255): a turn that asks for something of its own is never the
                answer to a question about something else.

                The text it reads matters more. `instruction` was replaced by
                `resolveAgainstThread` two thousand lines up, so this veto was
                reading a MODEL PARAPHRASE while the thing it vetoes --
                `changesHis` -- reads Grant's own words through `firstOfHis`.
                An action grounded in his text, guarded by a veto grounded in a
                rewrite, is a guard that can vanish for reasons that have
                nothing to do with what he said.

                Reproduced without a model at all, by putting plausible
                rewrites of "Call it Review the onboarding copy" through
                `titleReply`: *"The task should be called X"* and *"Set the
                title of the new task to X"* both return null, the veto
                disappears, the rename path runs and the office answers "I am
                not sure which task you mean". Three more rewrites keep the
                veto and corrupt the TITLE -- "the task you are adding X" --
                which is the same cause with a smaller bill.

                #313 already established this rule for the personal-task
                readers and `namedLater` was never brought across.
              */
              .then((prev) => {
                const said = prev === '' ? null : prev
                const read = (text: string): string | null =>
                  titleReply(text, said, notebookRequest(text) !== null)
                return firstOfHis(read) ?? read(instruction)
              })
              .catch(() => null)

      /*
        AND THE ANSWER TO A QUESTION IS NOT A FOLLOW-UP CHANGE.

        "Call it Review the onboarding copy" is both: `RENAME` recognises it,
        and so does `titleReply` when the previous turn asked for a name. With
        the change path running first and unconditionally, that one sentence
        created the new task AND renamed whatever personal task happened to be
        the most recent one — a row he had made twenty minutes earlier, silently
        given somebody else's name.

        `namedLater` is the narrower reading: it is only non-null when the
        office ITSELF asked the question in the previous turn, so preferring it
        cannot swallow an ordinary rename. Found in the independent acceptance
        pass by reading the two paths against each other rather than by running
        one of them.
      */
      /*
        FINISHED OR CALLED OFF (ledger R3, 0593).

        The conversation could rename and re-date a task and had no way to
        complete or cancel one, so "Mark the Hartley one done" was answered
        "...is now marked as done" over a row still reading todo. Read from HIS
        words, never the rewrite, for #322's reason. Resolved below against the
        tasks THIS conversation made, and acted on only when exactly one fits.
      */
      const settles =
        noted !== null || wantsFile !== null || isBranch || forwarded
          ? null
          : // His literal words too: a withdrawal has no surviving intent (R26, R42).
            (firstOfHis(taskStateChange) ?? taskStateChange(turn.kept))
      const change =
        noted !== null || wantsFile !== null || namedLater !== null || isBranch || settles !== null
          ? null
          : changesHis
      const changed =
        change === null
          ? null
          : await deps.db
              /*
                THE REFERENT, NOT THE NEWEST ROW (#313, 0551).

                This asked `app.my_task_recent()` — the newest open personal
                task in the last half hour, ANYWHERE in the office — and
                renamed it. That is proximity standing in for reference, and
                the task Grant meant and the newest task are the same row
                only by luck.

                Caught by #259's own control on v729: one "Call it X" renamed
                "Chase the printers" to "Review the onboarding copy for the
                task labeled …". The comment below already said "never claim
                a task was changed unless canonical state proves it", and the
                only thing proved was that SOMETHING recent existed.

                `app.my_task_referent` answers the narrower question: the one
                task THIS CONVERSATION made. One candidate is a referent;
                several are ambiguous and get asked about; none gets asked
                about too. A fresh conversation therefore inherits nothing,
                which is the boundary a clock cannot express.
              */
              .execute(
                `select app.my_task_referent(app.job_office(${lit(job.jobId)}::uuid), ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid) as t`,
              )
              .then(async (r) => {
                const raw = (r.rows[0] as { t?: unknown })?.t
                const pointed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
                  id?: string
                  title?: string
                  ambiguous?: number
                  titles?: string[]
                } | null
                /*
                  A task NAMED ("move the Hartley one to Monday") is found by
                  its name on his list, never by proximity (ledger R29). A name
                  that picks nothing, or several, is asked about below exactly
                  as an empty referent is.
                */
                const byName =
                  change.name == null
                    ? null
                    : await hisTaskByName(deps.db, job.jobId, change.name).catch(() => null)
                const subject =
                  change.name == null
                    ? pointed
                    : byName === null
                      ? null
                      : { id: byName.id, title: byName.title }
                if (change.name != null && byName === null) {
                  return `I have not changed anything — I could not find one open task matching "the ${change.name} one". Say its name as it is on the list.`
                }
                /*
                  SEVERAL things it could mean, so it asks which — and names
                  them, because "which one?" with no list is a question he
                  cannot answer either.
                */
                if (typeof subject?.ambiguous === 'number') {
                  const names = (subject.titles ?? []).slice(0, 4).map((t) => `"${t}"`)
                  return (
                    `There is more than one thing that could be — ${names.join(', ')}. ` +
                    'Say which and I will change it.'
                  )
                }
                /*
                  Nothing to point at is said out loud rather than guessed.
                  #259: never claim a task was changed unless canonical state
                  proves it — and there is no state here to prove anything.
                */
                if (subject?.id === undefined) {
                  return (
                    'I am not sure which task you mean — nothing has gone on your list ' +
                    'in this conversation. Tell me the name and I will change it.'
                  )
                }
                const set = await deps.db.execute(`
                  select app.my_task_set(
                    app.job_office(${lit(job.jobId)}::uuid),
                    ${lit(subject.id)},
                    ${change.title === null ? 'p_title => null' : `p_title => ${lit(change.title.slice(0, 200))}`},
                    p_due_on => ${change.due === null ? 'null' : `${lit(change.due)}::date`},
                    p_priority => ${change.priority === null ? 'null' : String(change.priority)}
                  ) as r`)
                const out = (set.rows[0] as { r?: unknown })?.r
                const got = (typeof out === 'string' ? JSON.parse(out) : out) as { ok?: boolean }
                if (got?.ok !== true) return null
                const name = change.title ?? String(subject.title ?? 'that task')
                return change.due === null
                  ? `Changed — "${name}", ${change.matched.join(' and ')}.`
                  : `Changed — "${name}" is now due ${change.due}.`
              })
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'change a personal task', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              })

      /*
        The press for settles, above. Its answer says what canonical state now
        holds and nothing else: a task is only called finished when
        app.hq_task_state returned it in that state, and a name that fits no
        task, or several, is asked about with the candidates named, never
        guessed.
      */
      const settledTask: { text: string; did: boolean } | null =
        settles === null
          ? null
          : await referentCandidates(deps.db, String(payload.command_id ?? ''), job.jobId)
              .then(async (r) => {
                const raw = (r.rows[0] as { t?: unknown })?.t
                const subject = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
                  candidates?: { id: string; title: string }[]
                } | null
                const candidates = subject?.candidates ?? []
                const verb = settles.state === 'done' ? 'tick off' : 'take off the list'
                // A named task can be found on his whole list (ledger R29).
                const acrossChats =
                  settles.name !== null && pickByName(settles.name, candidates) === null
                    ? await hisTaskByName(deps.db, job.jobId, settles.name).catch(() => null)
                    : null
                if (candidates.length === 0 && acrossChats === null) {
                  return {
                    did: false,
                    text:
                      'I have not changed anything — no task has been added in this ' +
                      `conversation for me to ${verb}. Tell me which one, or tick it ` +
                      'off on the dashboard task list.',
                  }
                }
                const target =
                  acrossChats ??
                  (settles.name === null
                    ? candidates.length === 1
                      ? (candidates[0] ?? null)
                      : null
                    : pickByName(settles.name, candidates))
                if (target === null) {
                  const names = candidates
                    .slice(0, 4)
                    .map((c) => `"${c.title}"`)
                    .join(', ')
                  return {
                    did: false,
                    text: `I have not changed anything yet. Which one should I ${verb} — ${names}?`,
                  }
                }
                const set = await deps.db.execute(
                  `select app.hq_task_state(app.job_office(${lit(job.jobId)}::uuid), ${lit(target.id)}, ${lit(settles.state)}, null,
                     app.command_principal(app.job_office(${lit(job.jobId)}::uuid), ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid)) as r`,
                )
                const out = (set.rows[0] as { r?: unknown })?.r
                const got = (typeof out === 'string' ? JSON.parse(out) : out) as {
                  state?: string
                  error?: string
                } | null
                if (got?.state !== settles.state) {
                  return {
                    did: false,
                    text: `I could not ${verb} "${target.title}"${got?.error === undefined ? '' : `: ${got.error}`}.`,
                  }
                }
                return {
                  did: true,
                  text:
                    settles.state === 'done'
                      ? `Done — "${target.title}" is ticked off.`
                      : `Taken off the list — "${target.title}" is cancelled.`,
                }
              })
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'finish or cancel a task', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              })

      /*
        The press for subOf: the parent is resolved among the tasks THIS
        conversation made, as a completion is, and the child written through
        app.my_task_add with p_parent, which checks the parent is one a task
        may sit under. Nothing is created when the parent is not exactly one.
      */
      const subbed: { text: string; did: boolean } | null =
        subOf === null
          ? null
          : await referentCandidates(deps.db, String(payload.command_id ?? ''), job.jobId)
              .then(async (r) => {
                const raw = (r.rows[0] as { t?: unknown })?.t
                const subject = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
                  candidates?: { id: string; title: string }[]
                } | null
                const candidates = subject?.candidates ?? []
                const parent =
                  subOf.parentName === null
                    ? candidates.length === 1
                      ? (candidates[0] ?? null)
                      : null
                    : (pickByName(subOf.parentName, candidates) ??
                      (await hisTaskByName(deps.db, job.jobId, subOf.parentName).catch(() => null)))
                if (parent === null) {
                  return {
                    did: false,
                    text:
                      candidates.length === 0
                        ? `I have not added it — there is no task in this conversation to put "${subOf.title}" under. Which task is it part of?`
                        : `I have not added it yet. Which one should "${subOf.title}" go under — ${candidates
                            .slice(0, 4)
                            .map((c) => `"${c.title}"`)
                            .join(', ')}?`,
                  }
                }
                const made = await deps.db.execute(`
                  select app.my_task_add(
                    p_office => app.job_office(${lit(job.jobId)}::uuid),
                    p_title => ${lit(subOf.title.slice(0, 200))},
                    p_parent => ${lit(parent.id)},
                    p_job => ${lit(job.jobId)}::uuid) as r`)
                const out = (made.rows[0] as { r?: unknown })?.r
                const got = (typeof out === 'string' ? JSON.parse(out) : out) as {
                  ok?: boolean
                  error?: string
                } | null
                return got?.ok === true
                  ? { did: true, text: `Added "${subOf.title}" under "${parent.title}".` }
                  : {
                      did: false,
                      text: `I could not put "${subOf.title}" under "${parent.title}"${got?.error === undefined ? '' : `: ${got.error}`}.`,
                    }
              })
              .catch(async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'add a subtask', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              })

      /*
        HIS YES OR NO TO THE QUESTION THIS CONVERSATION ASKED (ledger R33).

        Only for a short, unambiguous yes or no, only when this conversation's
        own work - its jobs and everything they started - has exactly ONE open
        question, and only onto that question's own option by its first word.
        Several open questions are named and asked about; none, and this does
        nothing. Answered through app.hq_answer_blocker, the same door the
        dashboard button uses, so what answering performs is identical.
      */
      const spoken = isBranch ? null : (turn.answer?.reading ?? entitled.answer(turn.kept))
      const answeredQuestion: { text: string; did: boolean } | null =
        spoken === null
          ? null
          : await deps.db
              .execute(
                // One assembly, asked here and by the test: the previous turn's tree, only a question he was
                // SHOWN on a channel that delivers (0622, #394), or the one it said it was still waiting on.
                `select * from app.open_questions_for_reply(app.job_office(${lit(job.jobId)}::uuid), ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid)`,
              )
              .then(async (r) => {
                const rows = r.rows as {
                  id: string
                  what: string
                  options: string[]
                  bindable?: boolean
                }[]
                if (rows.length === 0) return null
                /*
                  WHAT HE WAS SHOWN, BY NAME (#396, 0623). A question binds only when the office can say which
                  message asked it: he replied to it, or it is the one open question shown in this chat and the last
                  thing sent there. Otherwise the questions are NAMED and nothing is answered - the dashboard chat
                  and voice have no message to point at, so their waiting questions are answered by the buttons, by
                  id. An old schema returns no `bindable` column and behaves as before (undefined counts as bound).
                */
                const open = rows.filter((o) => o.bindable !== false)
                if (open.length === 0) {
                  return {
                    did: false,
                    text: `I have not answered anything — ${rows
                      .map((o) => `"${o.what}"`)
                      .join(
                        ', ',
                      )} ${rows.length > 1 ? 'are' : 'is'} waiting, and I cannot tell which of my messages you are answering. Reply to the message that asks it, or press its button.`,
                  }
                }
                if (open.length > 1) {
                  return {
                    did: false,
                    text: `I have not answered anything yet — there is more than one question waiting: ${open
                      .map((o) => `"${o.what}"`)
                      .join(', ')}. Which one is that for?`,
                  }
                }
                const q = open[0]
                /*
                  ACKNOWLEDGED, NOT AUTHORISED (#374). "ok thanks" or a thumbs
                  up while a question is waiting answers nothing: the question
                  stays open and he is asked, rather than it being approved
                  or read as new work.
                */
                if (q !== undefined && spoken === 'unclear') {
                  // Bind this turn to the question it is asking about again.
                  // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
                  await deps.db.execute(`
                    update public.jobs
                       set pinned_config = coalesce(pinned_config, '{}'::jsonb)
                                           || jsonb_build_object('awaiting_answer', ${lit(q.id)}::text)
                     where job_id = ${lit(job.jobId)}::uuid`)
                  return {
                    did: false,
                    text: `I have not acted on "${q.what}" — I read that as an acknowledgement, not a go-ahead. Say yes to go ahead, or no to leave it.`,
                  }
                }
                const option =
                  q === undefined || spoken === 'unclear' ? null : optionFor(spoken, q.options)
                if (q === undefined || option === null) return null
                /*
                  Answered AS whoever this turn came from (0608): the
                  principal the door recorded on the command, never a name
                  this handler supplies. A sender the office does not know
                  gets a refusal back, which the line below reports.
                */
                const res = await deps.db.execute(
                  `select app.hq_answer_blocker(app.job_office(${lit(job.jobId)}::uuid), ${lit(q.id)}::uuid, ${lit(option)},
                     app.command_principal(app.job_office(${lit(job.jobId)}::uuid), ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid)) as r`,
                )
                const out = (res.rows[0] as { r?: unknown })?.r
                const got = (typeof out === 'string' ? JSON.parse(out) : out) as {
                  ok?: boolean
                  error?: string
                } | null
                return got?.ok === true
                  ? {
                      did: true,
                      text:
                        spoken === 'yes'
                          ? `Taken as a yes to "${q.what}" — it is going ahead now.`
                          : `Taken as a no to "${q.what}" — I have left it.`,
                    }
                  : {
                      did: false,
                      text: `I could not record that answer to "${q.what}"${got?.error === undefined ? '' : `: ${got.error}`}.`,
                    }
              })
              .catch(() => null)

      const filed =
        asked !== null
          ? await addTask(deps.db, job, asked, instruction, deps.now?.() ?? new Date())
          : namedLater === null
            ? null
            : await addTask(
                deps.db,
                job,
                { title: namedLater, matched: 'answered the title question' },
                /*
                  The TITLE only, not the instruction. This branch is Grant
                  answering "what should I call it?", so the sentence in front
                  of us is a name — a date in the earlier turn belonged to the
                  earlier turn and reading it here would date a task from a
                  different question.
                */
                namedLater,
                deps.now?.() ?? new Date(),
              )

      /*
        NOTHING ABOVE CLAIMED THE TURN, SO ASK WHAT THE GOAL ACTUALLY NEEDS.

        The gate is the whole safety argument: where any recogniser acted, this
        does not run, so no existing behaviour moves. `planFor` has its own fast
        path for a short single-clause sentence, so an ordinary question never
        reaches the model, and `planAndPursue` starts nothing it cannot perform.

        Planning may never fail Grant's turn. A failure is recorded where the
        office counts them and the turn answers as it would have anyway — a
        swallowed write is indistinguishable from a feature nobody built, which
        is why the catch writes rather than merely returning null.
      */
      /*
        THE PLANNER GETS WHAT GRANT SAID, NOT A TIDIED VERSION OF IT.

        `Reading.text` is *"the request as a single clean sentence, in Grant's
        own words wherever possible"*, and the cascade below WANTS that — #282
        measured the win, because a recogniser is good at one clear request and
        bad at a paragraph of speech.

        The planner has the opposite need, and giving it the same text was a
        real defect rather than a preference. Over eight runs of one sentence
        the cleaned reading came back at 148, 142 and 91 characters, and the
        91-character version had silently dropped *"so that I have something
        concrete to pick up later"* — **the purpose clause**. Purpose is
        precisely what decides whether a goal needs a second step, so the
        planner was composing one-step plans from a paraphrase that had removed
        the reason for the second one. That is what the three consecutive
        `verify:composes` failures were; twelve direct calls of `planFor` on the
        WHOLE sentence composed 12/12.

        So: his sentence, verbatim, whenever it is safe to use it.

        It is not safe when he corrected himself mid-message. #282's anchor B
        is *"Create a task for me and the um... No actually, scan the entirety
        of the project"* — the raw instruction still contains the fragment he
        replaced, and a planner reading it would plan the thing he withdrew.
        `abandoned` is non-empty exactly then, and the readings are the only
        reconstruction available, so that branch keeps them. Verbatim in the
        common case, safe in the other, and neither pretends to be the other.
      */
      const goalAsHeSaidIt =
        understood.abandoned.length === 0 ? instruction.trim() : requests.join(' ')

      const restOfAnswered =
        answeredQuestion?.did === true && (turn.answer?.remainder.trim() ?? '') !== ''
      const actedAlready = [
        linked,
        made,
        filed,
        noted,
        changed,
        settledTask?.text ?? null,
        subbed?.text ?? null,
        /*
          An answer that also carried a request does not use up the turn: the
          remainder still gets its chance to be planned (a mixed turn keeps
          every clause).
        */
        restOfAnswered ? null : (answeredQuestion?.text ?? null),
        stopped,
        whoIsOn,
        alreadyOn,
        secondOpinion,
        extracting,
        enumerating,
        writingFile,
        reading,
      ].some((x) => x !== null)
      const pursuing =
        actedAlready || isBranch || requests.length === 0
          ? null
          : await planAndPursue(deps.db, deps.router, job, goalAsHeSaidIt, askedForAnother).catch(
              async (error: unknown) => {
                await deps.db
                  .execute(`
                    select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
                      'work out a plan for this', ${lit(who.slug)},
                      ${lit(String((error as Error).message).slice(0, 400))},
                      ${lit(instruction.slice(0, 280))})`)
                  .catch(() => undefined)
                return null
              },
            )

      /*
        The rule he taught goes FIRST, because he said it first (#282, anchor
        A). `taught` is non-null here only when something else survived the
        message as well — the rule-only case returned above.
      */
      const restHandled = [
        linked,
        made,
        filed,
        noted,
        changed,
        settledTask?.text ?? null,
        subbed?.text ?? null,
        stopped,
        whoIsOn,
        alreadyOn,
        secondOpinion,
        extracting,
        enumerating,
        writingFile,
        reading,
        pursuing,
        taught?.said ?? null,
      ].some((x) => x !== null)
      /*
        A QUESTION THE WRITERS DID NOT TAKE IS NOT A QUESTION ANSWERED (final audit, invariant 4).

        With the model unavailable `understood.surviving` is empty, so nothing marks "what is the status of the venue?"
        as a question, the confirmation of the rule or the reminder short-circuits the answering path, and the question
        simply vanished - neither answered nor said to be dropped. When a model reading did mark a question the
        answering path owns it; when none did and a writer acted, any sentence of his own that ends in a question mark
        is named back, so nothing he asked is lost in silence. Model-free on purpose: this is the turn on which the
        model was not there to do it.
      */
      const modelOwnsTheQuestion = understood.surviving.some(
        (r) => r.kind === 'question' || r.kind === 'task_query',
      )
      const leftUnasked = (
        modelOwnsTheQuestion || isBranch ? [] : unansweredQuestions(turn.kept)
      ).filter(
        (q) =>
          ![taught?.said, noted, changed, made, filed].some(
            (x) => typeof x === 'string' && x.toLowerCase().includes(q.toLowerCase().slice(0, 30)),
          ),
      )
      const confirmation =
        [
          taught?.said ?? null,
          linked,
          made,
          filed,
          noted,
          changed,
          settledTask?.text ?? null,
          subbed?.text ?? null,
          answeredQuestion?.text ?? null,
          leftUnasked.length > 0 && restHandled
            ? `You also asked "${leftUnasked[0]?.slice(0, 120) ?? ''}" — I have not answered that part; ask it again on its own.`
            : null,
          restOfAnswered && !restHandled
            ? `You also said "${(turn.answer?.remainder ?? '').trim().slice(0, 120)}" — I have not acted on that part; say it again with what it is for.`
            : null,
          /*
            "Forget the printers one" is a task he has, not work in flight
            (ledger R42): when it settled a named task, the call-off that
            found nothing running is noise beside it.
          */
          settledTask?.did === true && stopped === NOTHING_TO_STOP ? null : stopped,
          whoIsOn,
          alreadyOn,
          secondOpinion,
          extracting,
          enumerating,
          writingFile,
          reading,
          pursuing,
        ]
          .filter((x) => x !== null)
          .join('\n\n') || null

      /*
        AN ACTION TAKEN MUST NOT SWALLOW A QUESTION ASKED (#282, anchor A).

        `confirmation !== null` short-circuits the whole answering path — no
        retrieval, no mail, no capability sheet, no model call — and returns
        the confirmation as the entire reply. That is right for a turn that is
        only an action: "that is on your list" needs no research.

        It is exactly wrong for a turn that is an action AND a question, which
        is what anchor A is. Splitting the clauses was not enough on its own:
        the rule was stored, the confirmation was composed, and the SECOND
        clause was discarded one layer further down than the early return that
        had been fixed for it. Two guards, one defect, and only driving the
        real sentence found the second — the first fix was present, compiled,
        unit-tested and inert.

        `task_query` and `question` are the two readings that owe him an
        answer. Neither writes anything, so consulting the model's reading here
        is not authorization: the worst it can do is pay for a retrieval on a
        turn that did not need one.
      */
      /*
        Work handed to the office that nothing on this turn picked up (ledger
        R43). "I need to call the council on Thursday and can you also ask
        Emma what the venue said about accessibility" filed the task, and
        because a task was filed `pursuing` never ran and the answering path
        short-circuited: Emma was chosen as the speaker and never said
        anything. A delegation is owed an answer as much as a question is,
        unless something here already started it. Named, because a delegation
        answered on the turn is also not work that failed to land (`wanted`).
      */
      const delegations = understood.surviving.filter((r) => r.kind === 'delegate').length
      const answersDelegation =
        delegations > 0 &&
        pursuing === null &&
        extracting === null &&
        writingFile === null &&
        reading === null &&
        enumerating === null &&
        who.handoff === null &&
        who.alsoConvened.length === 0
      const alsoAsked =
        understood.surviving.some((r) => r.kind === 'question' || r.kind === 'task_query') ||
        answersDelegation
      /*
        One name for "this turn owes him an answer", so the fourteen gates
        below cannot drift apart. CLAUDE.md records the cost of a list
        assembled twice.
      */
      const answering = confirmation === null || alsoAsked

      /*
        How many things this turn actually DID (#248).

        `OutputMetadata.acted` has existed for months, is documented as
        "supplied by the worker, which is the only caller that can count them",
        and NOTHING HAS EVER SET IT. So the check that reads it could never
        fire, and the office reporting "Task created for you, due Friday" with
        `public.tasks` untouched passed every gate — which is exactly what the
        hostile corpus caught once #246 stopped it narrating instead.

        Third instance of this shape in the repository: a defaulted field, no
        caller, and a column or check that can only ever say one thing.
        `delegation_depth` was the last one.

        Counted from the three things this handler can actually perform: a
        notebook action, a task, and the specialists it convened. Zero is a
        real answer and is the one that matters — an absent count never
        accuses anybody, and a wrong-but-present count would be worse than
        none.
      */
      const acted =
        (made === null ? 0 : 1) +
        (filed === null ? 0 : 1) +
        (extracting === null ? 0 : 1) +
        // Looking through the notebook is a thing this turn started (#260).
        (enumerating === null ? 0 : 1) +
        // And starting a report is a thing it did, not a thing it described (#258).
        (writingFile === null ? 0 : 1) +
        // So is opening a page: the office spent a browser-minute and filed
        // what the page said (#135).
        (reading === null ? 0 : 1) +
        /*
          A task on Grant's own list is a thing this turn DID (#259).

          Counted for the reason the comment above gives: `acted` had existed
          for months with nothing setting it, so the check that reads it could
          never fire and "Task created for you, due Friday" passed every gate
          with `public.tasks` untouched. A personal task that is not counted
          would reopen exactly that hole.
        */
        (noted === null ? 0 : 1) +
        /*
          And changing one is a thing this turn DID, for exactly the reason
          above: a confirmation the office writes about a row it moved has to
          be counted, or the gate that checks "did this turn act" cannot see
          it and the sentence becomes unbacked narration (0516).
        */
        (changed === null ? 0 : 1) +
        (settledTask?.did === true ? 1 : 0) +
        (subbed?.did === true ? 1 : 0) +
        (answeredQuestion?.did === true ? 1 : 0) +
        who.alsoConvened.length

      /*
        Counted from `MAY_ACT` - the same signal the handler already trusts
        to decide whether to PLAN.

        The first version counted only the explicit task_create, task_change
        and delegate readings, reasoning that the `other` catch-all would put
        "I have not done this" onto ordinary remarks. Fresh unseen material
        overturned that within the hour:

            "get someone onto the insurance renewal before it slips"
              -> 0 tasks, 0 child jobs, 1 impediment, and the office said
                 "I'll create a task titled Insurance renewal - follow-up"

        which is #302's second failure mode exactly, arriving under a label
        the strict list did not cover. A narrower count did not reduce noise;
        it reopened the defect.

        `requests.length` is the honest line because it is already the
        handler's own actionability judgement - `planAndPursue` runs on
        exactly this condition. If the turn is worth planning for it is worth
        telling the truth about. And the sentence appears only when NOTHING
        was done and NOTHING was planned, so the remaining exposure is a
        clause read as `other`, acted on by nobody and planned by nobody,
        about which "I have not done this" is true.
      */
      const wantedWork = requests.length

      /*
        And the OTHER question, which the first wiring answered with the same
        number: did he ask for work at all?

        `other` is both a real reading - "understood as a request, none of
        the above" - and what every non-model path returns for the whole
        utterance. So "did you do it?" counted as wanting work, and the
        office opened its answer to a question about its own state with "I
        have not done this... say it again in a sentence and I will." 22 of
        34 live turns led with that clause; 8 of them were questions.

        The grammar can tell them apart and is already trusted to, all over
        this handler. A clause of the request in the `ask` mood means he
        asked; a question or a remark means the reading is the fallback
        speaking rather than a request the office failed.

        Used ONLY to decide whether the office volunteers a state sentence.
        `wanted` is unchanged, so nothing here widens what an answer may
        claim - which is what keeps the insurance-renewal escape closed.
      */
      const askedForWork = requests.some((text) => asksForWork(text, clauses))

      /*
        What this turn actually put in the world, from the tables.

        Asked once, here, after every writer has run. `acted` above is what
        the handler ATTEMPTED; this is what survived.
      */
      const counted = await deps.db
        .execute(`
          select (select count(*) from public.tasks t
                   where t.office_id = app.job_office(${lit(job.jobId)}::uuid) and t.job_id = ${lit(job.jobId)}::uuid)
               + (select count(*) from public.documents d
                   where d.office_id = app.job_office(${lit(job.jobId)}::uuid) and d.produced_by_job = ${lit(job.jobId)}::uuid) as n,
                 (select count(*) from public.jobs c
                   where c.office_id = app.job_office(${lit(job.jobId)}::uuid) and c.parent_job_id = ${lit(job.jobId)}::uuid) as kids,
                 (select count(*) from public.blockers b
                   where b.office_id = app.job_office(${lit(job.jobId)}::uuid) and b.state = 'open'
                     and (b.job_id = ${lit(job.jobId)}::uuid
                          or b.job_id in (select c.job_id from public.jobs c
                                           where c.office_id = app.job_office(${lit(job.jobId)}::uuid)
                                             and c.parent_job_id = ${lit(job.jobId)}::uuid))) as asking`)
        .then((r) => r.rows[0] as { n?: number; kids?: number; asking?: number } | undefined)
        .catch(() => undefined)
      const landedRows = counted === undefined ? acted : Number(counted.n ?? 0)
      /*
        AND THE CHILDREN, COUNTED THE SAME WAY (#312's second half).

        `pendingActions` was `pursuing === null ? 0 : 1` — a variable the
        handler set, which is precisely what the field's own comment in
        `outcome.ts` forbids for `landed` and for the same reason. It is
        wrong twice over: it cannot see a child enqueued by any path other
        than `pursuing`, and it says ONE when the office fanned out to four.

        Measured live on v721, with the #312 fix already deployed: a turn
        that created ONE child job and TWO consultations said "I have not
        done this… I have no record of the three competitors' pricing" and
        mentioned neither. The contract could not see the child, so the
        sentence it exists to compose was never owed.

        One extra count in a query that was already being made.
      */
      const pendingChildren =
        (counted === undefined ? (pursuing === null ? 0 : 1) : Number(counted.kids ?? 0)) +
        /*
          A HANDOFF IS PENDING WORK TOO (ledger R23). It is enqueued AFTER
          this output is written, because it carries the output, so no count
          of children can see it yet - and "get Emma to find X, and then have
          Daniel work out Y" was answered "I have not done this yet" in front
          of Emma's correct figure while Daniel's half sat queued.
        */
        (who.handoff === null ? 0 : 1)

      const outcome: CanonicalOutcome = {
        /*
          A call-off the office handled is not work that failed to land
          (ledger R42): "don't bother with the florist, but remind me Friday
          to chase the printers" filed the task, found nothing running on the
          florist, said so — and opened with "partly done, 1 of 2, the rest
          did not go through", because stopping writes no task row. `stopped`
          is its own confirmation, so that clause leaves the count.
        */
        wanted: Math.max(
          0,
          wantedWork - (stopped === null ? 0 : 1) - (answersDelegation ? delegations : 0),
        ),
        /*
          Counted from ROWS, not from what the handler attempted.

          `outcome.ts` says this in its own field comment - "counted from
          rows the turn produced, never from what the handler decided to
          attempt, which is why it cannot see a my_task_add that was called
          and refused" - and the first wiring passed `acted` anyway, which
          is that warning ignored one file away.

          The durability sweep found what it costs. A turn that asked to
          MOVE a task counted `changed` as one thing done, so `landed` was
          1, the class came out `completed`, `mayClaimCompletion` was true,
          the backstop was never consulted, and the office told Grant it had
          "Added book venue and moved write welcome pack" against zero rows.
          One turn later it correctly said it had created nothing.

          One extra count, after the writers have run, against the job's own
          id. Failing open to `acted` rather than throwing: a reading that
          cannot be taken must not cost the answer, and the worse direction
          is the one that loses a reply.
        */
        landed: landedRows,
        // The only thing that licenses a commitment to the future, and the
        // office's one way of making one here is to hand work on.
        pendingActions: pendingChildren,
        /*
          WAITING ON HIM, INCLUDING WHEN A CHILD IS THE ONE WAITING.

          This was hardcoded `false`, so the one branch of `sayWhatHappened`
          that says "it is waiting on your word" could never fire — a
          permission on the contract with nothing able to reach it, which is
          the defaulted-parameter defect this repository records four times.

          And the blocker is usually not on THIS job. Measured live on v723:
          a turn fanned out, one child completed and the other PAUSED with an
          open blocker asking Grant to approve the next step — and the
          conversation told him "I have handed this on and will come back
          with what comes of it." Each side waiting for the other, and only
          one of them knows.

          Descendants as well as this job, because the office asking through
          a specialist is still the office asking.
        */
        awaitingApproval: Number(counted?.asking ?? 0) > 0,
        /*
          Named only where it is KNOWN. Claiming to know what is missing when
          we do not is the same defect as claiming to have done the work, so
          the generic ask is the honest sentence rather than a worse one.
        */
        missing: job.projectId === null && wantedWork > 0 ? ['which project this is for'] : [],
        capabilityRefused: false,
        attempt: job.attempt,
        maxAttempts: 4,
        /*
          Still running, always: this is asked while the answer is being
          composed, so the turn cannot have failed after retries. Passing the
          attempt count alone made the class fire on the LAST attempt, which
          is when the office is most likely to answer well.
        */
        settled: false,
        asked: askedForWork,
      }

      // The same retrieval the office uses, so an instruction answered in
      // Telegram cites the same corpus as one answered in Slack. §22's rule
      // that the source interface must not change the organisation's
      // behaviour applies to the answer as much as to the routing.
      // What was said before this. Grant sent six messages in forty-three
      // seconds — a correction, a fact, an instruction, a check that we had
      // followed — and each was answered as a standalone sentence because
      // nothing carried the exchange (0089).
      /*
        The gate's reason from a previous attempt, if there was one (#237).

        `pinned_config` is where the worker leaves it, which is also where this
        handler's own payload comes from — so it arrives with the job rather
        than needing a second read.
      */
      const coherenceNote =
        typeof (payload as { coherence_note?: unknown }).coherence_note === 'string'
          ? String((payload as { coherence_note?: unknown }).coherence_note).slice(0, 600)
          : null

      const turnsBefore = await conversationBefore(
        deps.db,
        String(payload.command_id ?? ''),
        job.jobId,
      )
      const turns = turnsBefore

      /*
        Is he correcting the last answer, and is there a standing rule in it?
        (#147)

        Below the teaching branch on purpose, and the division between the two
        is the whole point of this feature. `readTeaching` handles a rule he
        states AS a rule — "from now on, always put the summary last" — and
        stores it outright, because he has already said it is standing. What
        falls through to here is the other 90%: a correction that fixes THIS
        answer and says nothing about the next one. Grant's words for the gap
        are *"when a reply is wrong Grant says so and the next reply is better.
        NOTHING GENERALISES."*

        Nothing is stored here. An offer is written, he reads the drafted text,
        and `app.decide_suggestion` is the only path by which it becomes a
        rule — because a correction inferred from a short message is exactly
        the kind of thing that must not silently change how the office behaves
        for ever.
      */
      const correction = entitled.correction(
        turn.kept,
        (turnsBefore.at(-1)?.answered ?? null) !== null,
      )

      /*
        What this chat holds beyond the working window, and what of it matters
        here (#238).

        The turns were never lost — `inbound_commands` and `outputs` keep every
        word — they were merely unreachable, so this is a retrieval gap rather
        than a memory system that needed building. `recall_conversation`
        searches THIS chat's older turns for the ones that match what is being
        asked; `conversation_extent` says how far back the chat goes, which is
        the half that makes the answer honest.

        Both are skipped when the chat has nothing older than the window, which
        is the overwhelmingly common case and costs one cheap query to
        establish.
      */
      const commandId = String(payload.command_id ?? '')
      const memory = await recallOlder(deps.db, commandId, instruction, job.jobId)

      /*
        Asked what was said earlier, in a conversation with nothing earlier
        (#231, Campaign Three).

        Answered by the office rather than by a model, because there is exactly
        one honest answer and a model asked this question from an empty context
        invents one. Measured, not assumed: the control chat produced "The
        middle tier is £42 a month - measured" and, on a second attempt, "You
        asked what price you told me... I checked our notes" — a figure and a
        lookup, both from nothing.

        The provenance guards catch the CLAIMS around such an answer one
        phrasing at a time, and that is whack-a-mole: no check can tell an
        invented number from a real one. What can be decided without a model is
        the SHAPE of the question, and whether the conversation has anything in
        it — both of which are facts the office already holds.

        Deliberately narrow. It fires only when the question asks for the
        content of an earlier turn AND the working window is empty AND recall
        found nothing AND the office knows the chat is genuinely new. Any one of
        those failing hands the turn back to the ordinary path.
      */
      if (
        asksWhatWasSaid(instruction) &&
        turnsBefore.length === 0 &&
        memory.recalled.length === 0 &&
        memory.boundary === null
      ) {
        return {
          body:
            'I have nothing from earlier in this conversation — this is the first thing ' +
            'you have said to me here, so there is nothing for me to look back at. If it ' +
            'was in another chat or on another day, tell me roughly when and I will find ' +
            'it; otherwise tell me again and I will keep it this time.',
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: 'inference',
          model: null,
        } satisfies HandlerOutput
      }

      /*
        A SHORT FOLLOW-UP SEARCHES WITH WHAT IT FOLLOWS (ledger R32).

        "Yes, go ahead." retrieves nothing, so the answer to it had no
        documents behind it, and the date the office had just read out of the
        venue terms ("2 Oct") was refused four times as invented - the job
        failed. A short message also searches with the words of the message
        before it, which is what it is about; a long one stands on its own.
        Only the SEARCH widens: the office's own earlier answer is still not
        evidence, but the documents that answer came from are.
      */
      const lastSaid = turnsBefore.at(-1)?.said ?? ''
      const searchFor =
        instruction.split(/\s+/).length <= 8 && lastSaid !== ''
          ? `${lastSaid} ${instruction}`
          : instruction
      const hits = !answering
        ? []
        : await retrieveAcrossOffice(deps.db, { jobId: job.jobId }, searchFor, job.projectId)
      const context = contextBlock(hits)

      /*
        The correspondence, alongside the documents (#172, ADR-0037).

        A separate block rather than more rows in `context`, because the two
        are different kinds of evidence: a document is material the project was
        given and a message is correspondence that mentions it, and a model
        handed them in one undifferentiated list will cite a subject line the
        way it cites a contract.

        Project-scoped and unconditional. There is no "should I check the mail"
        decision here on purpose — #257's non-goal is teaching the model a list
        of connectors to try in turn, so the office brings what belongs to the
        project and the model reads it or does not. It is empty for a job with
        no project, and empty is the common case today because nothing matches
        an inbox of travel and clinic mail.
      */
      const mail = !answering
        ? []
        : await correspondence(deps.db, { jobId: job.jobId }, job.projectId, instruction)
      /*
        And WHY it is empty, when it is (#172, #257).

        `mailBlock` used to return nothing at all for no hits, so the model was
        told nothing about mail and any "there is nothing in your email" it
        produced was a claim about a search it had never been shown. Every one
        of Grant's projects associates zero of 206 cached messages today,
        because `public.contacts` is empty and the contact tier is the strong
        one — so this is the common case rather than an edge.
      */
      const mailCover =
        job.projectId === null || !answering
          ? null
          : (((
              await deps.db
                .execute(
                  `select app.mail_coverage(app.job_office(${lit(job.jobId)}::uuid), ${lit(job.projectId)}::uuid) as c`,
                )
                .catch(() => ({ rows: [] as Record<string, unknown>[] }))
            ).rows[0]?.c as MailCoverage | undefined) ?? null)
      const mailContext = mailBlock(mail, mailCover)

      /*
        And what has gone quiet on this project (#172).

        Grant's hardest question — *"are there outstanding commitments I have
        forgotten?"* — cannot be answered from bodies this office does not
        fetch. What it CAN answer is which threads nobody has spoken in, and
        which way round, which is the thing a person usually means when they
        ask. Same derivation as the correspondence above, so it inherits
        ADR-0037's isolation rather than restating it.

        Unconditional and usually empty, for #257's reason: no "should I check
        whether anything is outstanding" decision, because that is teaching
        the model a list of things to try. The office brings what belongs to
        the project and the model reads it or does not.
      */
      const quiet = !answering ? [] : await awaiting(deps.db, { jobId: job.jobId }, job.projectId)
      const waitingContext = waitingBlock(quiet)

      /*
        And what the index cannot speak for (#257).

        Grant asked about a document in the project's linked Google Notebook
        and was told it could not be found. A search that finds nothing is
        legitimate evidence for "there is nothing in our documents" — that is
        what `consultedDomains` is for and it is right whenever the index
        covers what is attached. It stops being right the moment a connector is
        attached and unindexed, and nothing anywhere could tell the difference.

        The note is EMPTY when coverage is complete, which is the common case:
        a sentence saying "I searched all of it" on every turn is noise that
        teaches a model to skim the block it sits in.
      */
      const coverage = !answering
        ? null
        : await coverageOf(deps.db, { jobId: job.jobId }, job.projectId)
      const gapNote = coverage === null ? '' : coverageNote(coverage)

      /*
        What the office has already settled (#129).

        Across EVERY project, deliberately: `retrieve()` searches within a
        dashboard project because that is right for documents, and the whole
        point of the decision log is that a question settled three weeks ago on
        another project is still settled. ADR-0036 states it — this is the one
        retrieval surface where a project boundary is not a privacy boundary.

        Never fatal and never noisy: at most four, and an empty answer is the
        common case.
      */
      const settledAlready = !answering
        ? []
        : (((
            await deps.db
              .execute(
                `select app.decisions_about(app.job_office(${lit(job.jobId)}::uuid), ${lit(instruction.slice(0, 500))}, 4) as d`,
              )
              .catch(() => ({ rows: [{ d: '[]' }] }))
          ).rows[0]?.d as Decided[] | string | undefined) ?? [])

      const settled: Decided[] = Array.isArray(settledAlready)
        ? settledAlready
        : (JSON.parse(String(settledAlready)) as Decided[])

      /*
        Split by WHO decided, because that decides how it may be used.

        A decision Grant made is a record of what he said, which
        `provenance.ts` counts as evidence. One the office reached on its own
        is the office's prose, which it does not — the same asymmetry that
        keeps `answeredBefore` out of `established()`, applied to a row instead
        of a turn. Folding both into one list would let a conclusion the office
        drew become a fact it may cite.
      */
      const hisDecisions = settled.filter((d) => d.by === 'grant')
      const oursDecisions = settled.filter((d) => d.by !== 'grant')

      const decidedBlock =
        settled.length === 0
          ? ''
          : `Things already settled. Do not re-derive these, and do not propose ` +
            `something that was ruled out without saying it was:\n\n${settled
              .map(
                (d) =>
                  `· ${d.question} → ${d.chose}${
                    d.ruled_out.length === 0 ? '' : ` (not: ${d.ruled_out.join(', ')})`
                  } — ${d.because} [${d.by === 'grant' ? `${currentPerson().name} decided` : `${d.by} decided`}${
                    d.project === null ? '' : `, on ${d.project}`
                  }]`,
              )
              .join('\n')}`

      /*
        What a colleague handed over, if this job is the second half of one
        (#128).

        The critical decision is WHERE this goes, and it is not `retrieved`. A
        colleague's answer is the office's own prose, and `provenance.ts` is
        explicit that an assistant turn is a record of what was SAID and never
        of what is TRUE. Putting Emma's research into Oliver's `retrieved`
        would make her figures grounded for him — one fabrication laundering
        itself through a second agent, which is the defect that whole module
        exists to prevent, with a colleague added to the chain.

        So it goes in the PROMPT, labelled as a colleague's draft, and into
        `answeredBefore`, which `established()` deliberately excludes. Oliver
        can write it up; he cannot cite it as a source.
      */
      const handedOver =
        typeof payload.from_output !== 'string' || payload.from_output === ''
          ? null
          : (((
              await deps.db
                .execute(`
                  select o.body as body, coalesce(s.name, o.staff_id::text) as who
                    from public.outputs o
                    join public.jobs oj on oj.job_id = o.job_id and oj.office_id = app.job_office(${lit(job.jobId)}::uuid)
                    left join public.staff s on s.staff_id = o.staff_id
                   where o.output_id = ${lit(payload.from_output)}::uuid
                `)
                .catch(() => ({ rows: [] }))
            ).rows[0] as { body?: string; who?: string } | undefined) ?? null)

      const handedOverBlock =
        handedOver?.body === undefined || handedOver.body.trim() === ''
          ? ''
          : `${String(handedOver.who ?? 'A colleague')} has already done the first part of ` +
            `this and handed it to you${
              typeof payload.handed_off_because === 'string' && payload.handed_off_because !== ''
                ? ` — ${payload.handed_off_because}`
                : ''
            }. This is THEIR draft, not a source: use it, and do not present ` +
            `anything in it as a fact you have checked.\n\n${handedOver.body.slice(0, 6_000)}`

      /*
        The dashboard projects, as canonical state rather than as recollection
        (#231).

        Provenance has four legitimate sources and the first of them is
        current persisted state. Until now this handler had none of it: it
        retrieved documents and nothing else, so *"what projects do we have
        open?"* — a question about the office's own spine, answerable by one
        cheap query — could only be answered from memory. Two real answers in
        the last 146 confidently stated the project count with nothing
        consulted, and one of them (#185's) named five projects that did not
        exist.

        Enforcing the invariant without this would have made a reasonable
        question unanswerable, which is the failure mode the brief names: do
        not solve fabrication by making the office incapable. Supplying the
        list makes the honest answer and the useful answer the same sentence.

        Names and slugs only, ordered and capped — this is a spine, not a
        briefing, and `localBrief` already carries what Grant has said about
        the project in hand.
      */
      /*
        A RESERVED project is not one of Grant's projects.

        Asked *"what projects do we have open at the moment?"* the office
        answered *"Here are the five open projects: 1. Unnamed, 2. AI Team HQ
        Test, …"*. He has four. The fifth is `unnamed`, the reserved bucket
        ADR-0024 created so that a Telegram message naming no project lands
        somewhere instead of nowhere — he confirmed that one project and
        nothing else.

        `projects.reserved_reason` exists precisely to mark it, is correctly
        set on that row, and **was read by nothing anywhere in the product**.
        A column that records a distinction no reader honours is the
        dial-with-no-reader defect, and here it produced a wrong count in a
        sentence about the office's own spine.

        Not excluded, because "what is sitting in the unnamed bucket" is a
        fair question and an answer that cannot see the row cannot field it.
        Named instead, so the model can say four and a catch-all rather than
        five.
      */
      const openNow = await deps.db
        .execute(`
          select slug, name, reserved_reason is not null as reserved
            from public.projects
           where office_id = app.job_office(${lit(job.jobId)}::uuid)
             and status = 'active'
             /*
               The same question the resolver asks, asked of the same fact.
               No backticks in here: this comment sits inside a template
               literal, and one backtick ends the string.

               #295: the spine is what the model recites when asked what is
               open, and it is the reader that kept the simulated world
               invisible even after the resolver could see it. The office
               resolved nothing and then listed Grant's real projects, which
               is CLAUDE.md's "a payload gains a key and THREE places have to
               learn it" with the third place being the prompt.

               app.harness_job is false for every message a person sends, so
               this is byte-identical to the old filter for Grant.
             */
             and (app.harness_job(${lit(job.jobId)}::uuid) or not is_fixture)
           order by reserved, updated_at desc limit 25`)
        .then((r) => r.rows as { slug: string; name: string; reserved: boolean }[])
        .catch(() => [] as { slug: string; name: string; reserved: boolean }[])
      const projectList = projectSpine(openNow)

      /*
        HIS OWN LIST, and only when he asked about it (#282, anchor A).

        Four reads, so it is not paid for on every message — most turns are not
        about his to-dos, and `projectSpine` is cheap enough to be
        unconditional while this is four calls into a function that walks
        subtasks.

        `task_query` is the semantic layer saying he asked; it is not
        authorization for anything, because reading his own list writes
        nothing. The fallback path never sets it, so a turn where the model was
        unavailable behaves exactly as it does today.
      */
      const asksAboutHisList =
        understood.surviving.some((r) => r.kind === 'task_query') ||
        // His words, whatever the model labelled them (ledger R38).
        asksAboutHisOwnList(turn.kept)
      const hisList = !asksAboutHisList
        ? ''
        : await deps.db
            .execute(`
              select app.my_tasks(h.office, 'overdue', 15, null, 'smart', h.harness) as overdue,
                     app.my_tasks(h.office, 'today', 15, null, 'smart', h.harness) as today,
                     app.my_tasks(h.office, 'upcoming', 10, null, 'smart', h.harness) as upcoming,
                     app.my_tasks(h.office, 'unscheduled', 15, null, 'smart', h.harness) as unscheduled,
                     app.my_tasks_counts(h.office) as counts
                /*
                  A harness turn sees its own world (ledger R8), the rule the
                  project spine above already follows: without it every test
                  of "what is on my list" answered "nothing" about the task
                  the same session had just made. False for every message a
                  person sends, so byte-identical for Grant.
                */
                from (select app.harness_job(${lit(job.jobId)}::uuid) as harness,
                             app.job_office(${lit(job.jobId)}::uuid) as office) h`)
            .then((r) => {
              /*
                The executor hands a jsonb column back as an OBJECT, and
                CLAUDE.md records `JSON.parse(String(x))` on one producing
                `"[object Object]" is not valid JSON` — a guessed shape that
                reads like a corrupt payload.
              */
              const read = <T>(v: unknown, fallback: T): T =>
                v === null || v === undefined
                  ? fallback
                  : ((typeof v === 'string' ? JSON.parse(v) : v) as T)
              const row = r.rows[0] as Record<string, unknown> | undefined
              if (row === undefined) return ''
              return taskSpine(
                read(row.overdue, [] as HisTask[]),
                read(row.today, [] as HisTask[]),
                read(row.upcoming, [] as HisTask[]),
                read(row.counts, {} as { overdue?: number; today?: number; all?: number }),
                read(row.unscheduled, [] as HisTask[]),
              )
            })
            /*
              An empty list is not the same as a list nobody could read, and
              CLAUDE.md records the UI getting this wrong in the direction that
              lies. Returning '' here means the office was NOT shown his tasks,
              so `consultedDomains` cannot claim it looked — which is the
              honest outcome of a failed read.
            */
            .catch(() => '')

      /*
        THE WORK IN THE PROJECT, and in a project the question names (#408).

        Documents were retrieved per project and a project's tasks were read by
        nothing, so "what is overdue on the trip" was answered, truthfully, with
        "I don't see any". The projects are the ones this turn is about and no
        others (see project-work.ts), read for the job's own office. An empty
        result is a failed or absent read, never "the project has no tasks": a
        project with none says so in its own block.
      */
      const projectWorkBriefs = !answering
        ? []
        : await readProjectWork(deps.db, job.jobId, job.projectId, instruction, lit)
      const projectWork = projectWorkSpine(projectWorkBriefs)

      // Asked once per answer rather than described in the prompt as a
      // constant: a connector switched off an hour ago must change what she
      // says she can do.
      /*
        One query now, not two, and scoped to the person answering (#148).

        `reachNow` and `verbsNow` were two calls and the second was a
        hand-written list in TypeScript covering three of twenty-one tools. It
        is `app.capability_index` now, which also knows what this agent may NOT
        do and what has already been asked for and refused — so an agent that
        hits a boundary has something to propose (#49) instead of asserting a
        limitation it does not have (#64).
      */
      const cap = !answering
        ? EMPTY_CAPABILITY
        : await capabilityNow(deps.db, { jobId: job.jobId }, who.slug)
      const reach = cap.reach

      /*
        What this person has learned and knows how to do (#48, #50).

        Retrieved here because here is where the prompt is built, and until now
        it was retrieved nowhere at all — `lessons_for` existed for a fortnight
        and every caller was its own test suite. A memory nothing consults is a
        table with good comments.

        Scoped to this person, this kind of job and this project, so a
        procedure written for research does not turn up in a finance answer.
      */
      const guidance = !answering
        ? { lessons: [], skills: [] }
        : await guidanceFor(deps.db, { jobId: job.jobId }, who.slug, job.kind, job.projectId)
      // At retrieval, not at completion: a skill shown to a job and then
      // ignored still shaped the prompt, so it still answers for the outcome.
      await recordSkillUse(deps.db, guidance.skills, job.jobId)
      const learned = guidanceBrief(guidance)

      /*
        What this person is told on THIS project (#36, migration 0323).

        Grant: Legacy Coaching wants a different Emma from AI Learning. Applied
        ON TOP of the remit and the style, never instead of them — a
        per-project note that replaced the global brief would let one line
        delete §12, and it is one line typed into a text box.

        Empty for every project he has not written one for, which is all of
        them today, so this adds nothing to the prompt until he uses it.
      */
      const localBrief =
        job.projectId === null
          ? ''
          : await deps.db
              .execute(
                `select app.project_instruction_for(app.job_office(${lit(job.jobId)}::uuid), ${lit(job.projectId)}::uuid, ${lit(who.slug)}) as v`,
              )
              .then((r) => String((r.rows[0] as { v?: string } | undefined)?.v ?? '').trim())
              .catch(() => '')

      const completion = !answering
        ? null
        : await deps.router.complete({
            messages: [
              {
                role: 'system',
                content:
                  // §9 records a `communication_style` for every one of these
                  // people and this prompt ignored it, which is why Grant
                  // said the messages read "a bit too robotic": eight
                  // colleagues generated from one template with the name
                  // swapped in. The style and the remit are what make Daniel
                  // sound sceptical and Emma sound careful, and they are in
                  // the database precisely so this is not written eight times.
                  `You are ${who.name}, ${who.title} on a small team. ` +
                  (who.responsibilities === null ? '' : `Your remit: ${who.responsibilities} `) +
                  (who.communication_style === null
                    ? ''
                    : `How you talk: ${who.communication_style} `) +
                  // After the remit and the style, and before anything about
                  // the conversation: it is a standing fact about the work,
                  // not an instruction about this reply.
                  (localBrief === ''
                    ? ''
                    : `On this project specifically, ${currentPerson().name} has told you: ${localBrief} `) +
                  `You are replying to ${currentPerson().name}, who runs the place, in a private chat. ` +
                  'They are a colleague you know well, not a customer.\n\n' +
                  /*
                      Say which constraint you set aside (#231).

                      Two turns of one session, the same shape. He asked for
                      one sentence of under ten words covering five facts —
                      impossible — and got eleven words with no mention of it.
                      He set a standing rule one turn earlier ("keep every
                      answer to a single short paragraph, no lists") and then
                      asked for a numbered list; he got the list, silently.

                      Neither answer was bad. Both left him unable to tell
                      that a thing he had asked for had been dropped, and a
                      system that quietly obeys the most recent instruction is
                      one whose standing rules decay without ever being
                      argued with. One clause is the whole cost of fixing it,
                      and asking instead would be worse — CLAUDE.md records
                      what a gate that fails into silence costs, and this is
                      the version that keeps answering.
                    */
                  // Extracted to `say-what-you-dropped.ts` so #277 can MEASURE
                  // a candidate against it rather than argue about it.
                  `${SET_ASIDE_LINE}\n\n` +
                  (turns.length === 0
                    ? ''
                    : 'You are mid-conversation. The turns before this one follow; the last ' +
                      'message is what you are answering. He corrects himself, changes his ' +
                      'mind and checks you have followed — read the latest message as a ' +
                      'continuation, not as a fresh request, and do not repeat what you ' +
                      'have already said.\n\n') +
                  /*
                      Where the line is between what was said and what is true
                      (#231).

                      Placed with the conversation note because it is about how
                      to READ the turns above, not about how to write the
                      answer. The recovery half of a pair: `provenance.ts`
                      explains the argument, `assertsRecordsUnseen` and
                      `fabricatedWhen` are what happen when this is ignored,
                      and CLAUDE.md records why a prompt alone is not enough —
                      the same build obeys one run and not the next.
                    */
                  `${provenanceNote()}\n\n` +
                  // Grant: *"I want messages in general from everyone to be
                  // more human and easier to read."* Two things, and the
                  // second was the one being missed: the replies were
                  // already conversational and they arrived as a single
                  // 120-word block, which on a phone is a wall.
                  'Write like a person messaging a person. Use contractions. Start with ' +
                  'the answer, not a restatement of the question. Have an opinion where ' +
                  'you have one and say so when you do not. A dry aside is fine if it is ' +
                  'actually dry.\n\n' +
                  'Make it EASY TO READ on a phone. Short sentences — if one has two ' +
                  'halves joined by "and", it is usually two sentences. Break the reply ' +
                  'into two or three short paragraphs with a blank line between them, one ' +
                  'thought each. A single dense block is a message he will skim and ' +
                  'misread. Under 120 words in total, first person, no headings, no ' +
                  'bold.\n\n' +
                  // Grant, 14 September: *"if our paragraph should be
                  // separated by bullet points, enumerated bullet points. So
                  // a numbered list, just to keep things easy to read and
                  // easy to refer to."*
                  //
                  // This NARROWS #186 rather than undoing it. #186 banned
                  // bullets outright because a bulleted reply to a
                  // conversational question reads as a report, and that is
                  // still true — hence "prose is the default", stated first
                  // and stated as the default rather than as an option.
                  //
                  // What #186 got wrong is the case where the content
                  // genuinely IS a list. Three options rendered as prose
                  // with semicolons cannot be replied to with "do 2 and 4",
                  // and that referability is the whole reason he asked.
                  //
                  // NUMBERED and not dashes, for the same reason: a dash is
                  // as unreferenceable as a semicolon.
                  'Prose is the default and most replies are prose. But when what you are ' +
                  'saying genuinely IS a list — options he is choosing between, steps in ' +
                  'an order, separate findings, things he needs to decide — write it as a ' +
                  'NUMBERED list, one item per line, starting each line with "1. ", "2. " ' +
                  'and so on. Numbered rather than dashes, so he can reply "do 2 and 4". ' +
                  'Put a short line of context before the list and stop after it. Two ' +
                  'items or fewer is a sentence, not a list.\n\n' +
                  'Never write: "I hope this helps", "Let me know if", "Certainly", "As ' +
                  'an AI", "I have drafted", "Here is a summary of". Do not sign your ' +
                  'name — the chat already shows who you are. Do not thank him for ' +
                  'asking. If you are inferring rather than reporting, say so inside the ' +
                  'sentence rather than as a disclaimer at the end.' +
                  // What the team can actually reach, from the registry that
                  // knows. Placed immediately before the no-context branch
                  // because that branch is where the false claim came from:
                  // told to say she could not see a notebook, Claire
                  // generalised to "I don't have integration access".
                  `\n\n${capabilityBrief(cap)}` +
                  // After what the office can reach, before what it holds on
                  // this question: how we work sits between authority and
                  // evidence, which is exactly what it is.
                  (learned === '' ? '' : `\n\n${learned}`) +
                  (context === ''
                    ? // Nothing matched. The old wording here said "answer
                      // from general knowledge", and that is how Grant asked
                      // about a NotebookLM project we hold nothing on and
                      // got four sentences about mindfulness, wellness
                      // stipends and leadership buy-in — none of it from
                      // anywhere, all of it plausible. §10 wants evidence;
                      // an invented answer that opens with "our records had
                      // nothing" still reads as an answer.
                      //
                      // So: general knowledge is permitted for a general
                      // question, and refused for a specific one. If he
                      // names a thing — a project, a document, a notebook —
                      // and we hold nothing about it, the useful reply is
                      // that we cannot see it and a question about where it
                      // is. Not an essay about what it might contain.
                      ' Nothing in our own records matched this. Say so first. ' +
                      'If the message names something specific we do not hold — a ' +
                      'project, a document, a notebook, a file — then do NOT describe ' +
                      'or speculate about what it might contain. Say you cannot see it ' +
                      'and ask where it is or how to reach it. Only answer from general ' +
                      'knowledge if the question is a general one that does not depend ' +
                      'on anything of ours.'
                    : /*
                           Whose facts win, said out loud (#231).

                           This used to be "Prefer them", meaning prefer our
                           documents over your general knowledge — and a model
                           reads it as prefer them over EVERYTHING, the message
                           included. Grant wrote five facts into one sentence
                           (forty pounds a month, three tiers, email-only
                           support, two weeks to onboard, a twelve-month
                           contract) and got back a price of £63.50 from an
                           unrelated document, "dedicated 24/7 support" and
                           "month-to-month up to annual commitments". Every
                           figure he supplied was replaced by one he had not,
                           confidently, with no sign it had happened.

                           That is worse than an invented answer. He cannot
                           catch it by knowing his own business, because the
                           reply is about his own business and is wrong in the
                           details he had just stated. A document can be a
                           month out of date; the sentence in front of it
                           cannot be.

                           So the precedence is explicit and in the right
                           order. Documents still beat general knowledge, which
                           is what the line was always for.
                         */
                      ' Numbered excerpts from our documents follow. Cite them as [1], [2], ' +
                      'and say plainly when they do not answer the question. Prefer them ' +
                      `over anything you merely know.\n\nBut what ${currentPerson().name} states in their own ` +
                      'message outranks every document. If they give you a figure, a name or ' +
                      'a fact, use THEIRS, even where a document says otherwise — and when a ' +
                      'document disagrees with them, say so rather than quietly choosing ' +
                      'one.'),
              },
              ...(context === ''
                ? []
                : [{ role: 'system' as const, content: `Our documents:\n\n${context}` }]),
              /*
                  The correspondence (#172).

                  After the documents and before the coverage note, which is
                  where it belongs in the argument: this is more evidence of
                  the same question, and the note that follows is a statement
                  about how far all of it goes.
                */
              ...(mailContext === '' ? [] : [{ role: 'system' as const, content: mailContext }]),
              ...(waitingContext === ''
                ? []
                : [{ role: 'system' as const, content: waitingContext }]),
              /*
                  What the search could NOT see (#257).

                  Immediately after the documents, because it is a statement
                  about those documents: how far they go. Before the decisions
                  and the colleague's draft, because it changes how an absence
                  may be reported and both of those are about content.
                */
              ...(gapNote === '' ? [] : [{ role: 'system' as const, content: gapNote }]),
              /*
                  What is already settled (#129).

                  Before the colleague's draft and after the documents: a
                  decision is a stronger constraint than a draft and a weaker
                  source than a document, and the order of these system
                  messages is the order of authority the answer should give
                  them.
                */
              ...(decidedBlock === '' ? [] : [{ role: 'system' as const, content: decidedBlock }]),
              /*
                  The colleague's draft (#128).

                  AFTER the documents deliberately. The order of these system
                  messages is the order of authority the answer should give
                  them, and a colleague's prose sits below a retrieved document
                  for the same reason it is excluded from `established()`: it
                  is a record of what was said, not of what is true.

                  The block says so in words as well, because a model reading
                  three system messages does not infer precedence from their
                  order.
                */
              ...(handedOverBlock === ''
                ? []
                : [{ role: 'system' as const, content: handedOverBlock }]),
              // Canonical state, so a question about the office's own spine
              // has an answer that is both honest and useful.
              ...(projectList === '' ? [] : [{ role: 'system' as const, content: projectList }]),
              ...(hisList === '' ? [] : [{ role: 'system' as const, content: hisList }]),
              ...(projectWork === '' ? [] : [{ role: 'system' as const, content: projectWork }]),
              /*
                WHAT THIS TURN ALREADY DID (ledger R42). When a turn both acts
                and asks, the confirmation goes above the answer — and the
                model was never told it existed, so it answered the whole
                message: "That is on your list for 2026-10-02 - Chase the
                printers" followed, in the same reply, by "I can't set a
                reminder for Friday until I know where to put it". Stated as
                settled fact, so the answer covers only what is left.
              */
              ...(confirmation === null
                ? []
                : [
                    {
                      role: 'system' as const,
                      content:
                        'The office has ALREADY done the following parts of his message on this ' +
                        'turn, and they are shown to him directly above your reply. Do not repeat ' +
                        'them, do not say they could not be done, and do not ask for anything in ' +
                        'order to do them. Answer only what he asked that this does not cover.\n\n' +
                        confirmation,
                    },
                  ]),
              /*
                  What this chat said before the window, and what is out of
                  view (#238).

                  Placed before the coherence note and after the documents,
                  because it is context rather than an instruction about the
                  answer. The boundary line goes in even when nothing was
                  recalled — that is the half Grant asked for: a model told
                  "there are 40 earlier turns and you can see 12" says so, and
                  one told nothing answers across the gap and sounds certain.
                */
              ...(memory.boundary === null
                ? []
                : [
                    {
                      role: 'system' as const,
                      content: `${memory.boundary}${
                        memory.recalled.length === 0
                          ? ''
                          : `\n\nEarlier in this conversation:\n${memory.recalled
                              .map(
                                (m) =>
                                  `- ${String(m.minutesAgo)} minutes ago he said: ${m.said}` +
                                  (m.answered === ''
                                    ? ''
                                    : `\n  and the answer was: ${m.answered}`),
                              )
                              .join('\n')}`
                      }`,
                    },
                  ]),
              /*
                  What the coherence gate refused last time (#237).

                  A previous attempt at THIS job claimed a read that never
                  happened, the gate correctly refused it, and the worker wrote
                  the reason here before retrying. Without this line the retry
                  is a coin flip; with it, it is a correction.

                  Placed after the documents deliberately: it is about the
                  answer rather than about the subject, and it should be the
                  last thing read before the conversation.
                */
              /*
                  What this turn is PERMITTED to promise - #302.

                  The contract is computed from rows above. Telling the
                  writer is the other half of it: the composed sentence makes
                  the truth unavoidable, and this stops the model appending a
                  commitment that contradicts it.

                  A live probe is why this exists. With the composed line
                  leading, the office still answered "I have not done this...
                  but I'll create a task for the appropriate team member and
                  set a deadline" - against 0 tasks and 0 child jobs. The
                  truth led and the promise followed it, which is a mixed
                  message rather than an honest one.

                  Stated as a permission derived from state, never as a list
                  of forbidden phrases: a detector that cannot tell "I'll
                  draft it" backed by a child job from the same words backed
                  by nothing would have to refuse both.
                */
              ...(contractFor(outcome).mayCommitToFuture
                ? []
                : [
                    {
                      role: 'system' as const,
                      content:
                        'NOTHING IS QUEUED TO HAPPEN AFTER THIS ANSWER. No work has been ' +
                        'started, handed on or scheduled by this turn, so there is nothing ' +
                        'that would carry out a commitment you make here. Do not say you ' +
                        'are going to do something, or that something will happen, unless ' +
                        'he does something first - "tell me which project and I will" is ' +
                        'fine because it depends on him; "I will create the task" is not, ' +
                        'because nothing will. Say what you would need, and ask for it.',
                    },
                  ]),
              ...(coherenceNote === null
                ? []
                : [
                    {
                      role: 'system' as const,
                      content:
                        'A previous attempt at this exact question was REJECTED before it ' +
                        `reached anyone. The reason: ${coherenceNote}\n\n` +
                        'Do not describe any lookup, read, query or search as having ' +
                        'happened. Everything above is all you have. Answer from it, and ' +
                        'where it does not cover the question say plainly that you have ' +
                        'not looked.',
                    },
                  ]),
              // The exchange, as an exchange. Replayed as real turns rather
              // than pasted into the system prompt as a transcript: a model
              // handed "here is what was said" reasons about the text, and a
              // model handed the turns reasons about the conversation.
              ...turns.flatMap((t) => {
                /*
                  A colleague's answer is part of the exchange and is ATTRIBUTED
                  as one (0549). Replayed as the office's own turn, because
                  that is what it is — the office asked somebody and this is
                  what came back — and said so in the first person so the model
                  cannot mistake it for something Grant told it.
                */
                /*
                  What came back, and what has not (0549, 0550). Both as the
                  OFFICE's own turn: a colleague's answer replayed as Grant's
                  would read as something he told it, which is the
                  fabrication-laundering shape `provenance.ts` prevents.
                */
                const outstanding =
                  t.waitingOnYou > 0
                    ? `Still open from that: ${String(t.waitingOnYou)} piece(s) of it are waiting on your answer.`
                    : t.stillGoing > 0
                      ? `Still open from that: ${String(t.stillGoing)} piece(s) are still running.`
                      : ''
                const lines = [
                  ...(t.colleagues.length === 0
                    ? []
                    : [
                        `What the colleagues I asked came back with:\n${t.colleagues.join('\n\n')}`,
                      ]),
                  ...(outstanding === '' ? [] : [outstanding]),
                ]
                const from =
                  lines.length === 0
                    ? []
                    : [{ role: 'assistant' as const, content: lines.join('\n\n') }]
                return t.answered === null
                  ? [{ role: 'user' as const, content: t.said }, ...from]
                  : [
                      { role: 'user' as const, content: t.said },
                      { role: 'assistant' as const, content: t.answered },
                      ...from,
                    ]
              }),
              { role: 'user', content: instruction },
            ],
            // 2,000, and NOT the 400 that looked obviously better.
            //
            // The prompt asks for under 120 words — about 180 tokens — so a
            // 400 ceiling read as generous and was tried, to cut the time
            // Grant spends watching a typing indicator. It made every reply
            // slower.
            //
            // `completion_tokens` on these models counts REASONING tokens as
            // well as the answer. Capped at 400, `cohere/north-mini-code`
            // spent the budget thinking and returned nothing: three
            // `empty_completion` rows at exactly 400 tokens, each one six to
            // nine seconds, each one failing over to the next model. A
            // measure meant to save thirty seconds cost fifteen.
            //
            // 0150 added `latency_ms` precisely so this kind of change is
            // decided by measurement rather than by how sensible it sounds.
            maxTokens: 2_000,
            correlationId: job.correlationId,
            jobId: job.jobId,
          })

      // §5: the decision is recorded with its reason, through the same
      // `recordDecision` the office uses.
      //
      // The first version hand-wrote the insert with an empty
      // `subject_terms` and was refused by
      // `routing_decisions_search_was_performed` — a constraint that exists
      // because "we checked for duplicates" must be a fact and not a
      // convention. Writing the row by hand was the mistake; the duplicate
      // scan is not optional here just because the roster was already decided.
      const scan = await scanForDuplicates(deps.db, instruction, {
        office: `app.job_office(${lit(job.jobId)}::uuid)`,
        ...(job.projectId === null ? {} : { projectId: job.projectId }),
        jobId: job.jobId,
      })
      const decided = route(instruction, scan)
      /*
        The depth this job is actually at (#233).

        `recordDecision`'s fourth argument has existed since the table did and
        NO CALLER HAS EVER PASSED IT — so `delegation_depth` was 0 on every row
        by construction, and "is the office delegating" was a question the
        column could not answer whatever the office did. A parameter nothing
        passes is the same defect as a column nothing reads.
      */
      const depth = await deps.db
        .execute(`select app.job_depth(${lit(job.jobId)}::uuid)::int as d`)
        .then((r) => Number((r.rows[0] as { d?: number } | undefined)?.d ?? 0))
        .catch(() => 0)

      await recordDecision(
        deps.db,
        job.jobId,
        {
          ...decided,
          /*
            Everyone convened, not just whoever speaks (#233).

            This recorded `[who.slug]` — one name — while `pickRoster` may have
            chosen several, so `routing_decisions.roster` was the record of a
            decision narrower than the one made, and `npm run measure` counts
            who the office chooses from exactly this column.

            Safe against `routing_decisions_unconfident_stays_small` by
            construction rather than by hope: `pickRoster` caps a contested
            reading at one person, so `alsoConvened` is empty whenever
            `confident` is false.
          */
          /*
            What was CONVENED, which is not always who speaks (#231).

            `[who.slug, ...]` put the Chief of Staff in the roster of every
            question that convened nobody — see `convened` on `Speaker`.
          */
          roster: who.convened as never,
          rosterReason: who.reason,
        },
        depth,
      )

      /*
        A confirmation reports a fact about the queue rather than an opinion —
        the child job exists, the task exists, or the insert failed — so §16
        exempts it from review and there is nothing in it for a reviewer to
        disagree with. Its source is the job itself, because §10's gate refuses
        `verified` with no sources and is right to: verified means someone can
        go and check.

        BUT the exemption is defined by how the answer was produced, and
        `enforce_deterministic_claim` checks that against the record rather than
        taking the handler's word for it: a job with ANY `inference_usage` row
        against its correlation may not claim determinism. That guard is
        correct and it refused a real action.

        #237 found it by asking the office to create a task. The confirmation
        was composed entirely in code — and by then the turn had already spent
        three model calls resolving the sentence against the conversation and
        naming its subject, so the insert was refused, the job FAILED, and
        Grant would have received nothing at all for a task that had in fact
        been created. Latent since the thread resolver existed; #232's semantic
        subject namer made it likely on any turn whose wording the expertise
        vocabulary does not match, which is most of them.

        So ask the same question the guard asks, and when a model was called on
        this correlation, send the confirmation to review instead of claiming an
        exemption it cannot have. The words are unchanged and still true; only
        the claim about how they were produced is dropped. The trigger's own
        message says exactly this: *"Mark it deterministic only on a code path
        that makes no inference call, or send it to review."*
      */
      /*
        ONLY when the confirmation is the whole of what he is owed (#282).

        `answering` is the same boolean the fourteen gates above read, so the
        turn cannot have skipped retrieval and then tried to answer, or paid
        for retrieval and then returned without it.
      */
      if (!answering) {
        return {
          body: confirmation ?? '',
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: await howComposed(deps.db, job.jobId),
          model: null,
        } satisfies HandlerOutput
      }
      if (completion === null) throw new Error('no completion and no confirmation')

      /*
        And the guard, because the brief above is an instruction and not a
        guarantee.

        Same shape as the numeric check in `src/text/voice.ts`, for the same
        reason: on a free model, "do not invent" is followed most of the time.
        A stray clause is embarrassing; a stray claim that the team cannot
        reach Notion is Grant believing his integration is broken and going to
        look at it.

        Corrected rather than suppressed. The reply is usually right about
        everything else, and dropping it would lose a good answer over one
        false sentence — so the sentence is contradicted, in the same message,
        by the registry that knows.
      */
      // Scaffolding out FIRST, before anything else looks at the text. A free
      // model that wanted a tool it was not offered emitted `<dots_function_call>`
      // straight into a Telegram message to Grant, and everything after that
      // token is the model talking to a harness that is not there.
      /*
        Only scaffolding came back — retry rather than apologise (#237).

        A free model occasionally emits a bare tool-call token and nothing
        else. `scrub` correctly refuses to show that to anybody and returns a
        sentence instead, and the contradictions session put that sentence on
        the screen in answer to a real question, on a job marked `complete`:
        *"I started on that and my answer came back malformed. Ask me again and
        I will retry."* Asking Grant to type his question a second time is
        passing our problem to him.

        Throwing hands it to the worker's existing retry, which is bounded by
        the same `attempt < 4` as every other failure here and backs off
        between goes. The apology survives for the LAST attempt, when there
        genuinely is nothing else to say — a person is still owed a sentence.
      */
      if (scrubbedToNothing(completion.content) && job.attempt < 4) {
        throw new Error('the model returned only scaffolding, nothing to say')
      }
      const said = scrub(completion.content)

      /*
        And the same question about a CAPABILITY rather than a connector (#320).

        `contradictsReality` reads `reach`, so it catches "I can't get into
        Notion" and cannot see "I can't create a PDF" — a capability is a row
        in `tool_permissions` and that row was never consulted. The office had
        made 139 PDFs when it told Grant it could not make one, and offered him
        a Notion page to export by hand instead.

        Corrected rather than suppressed, for the reason the connector version
        gives: the reply is usually right about everything else. The sentence
        uses the registry's own description rather than the tool's id, because
        the brief already tells every agent to say what it cannot do "plainly
        in his words rather than naming the switch", and a correction that
        breaks that rule reads as the machine talking past him.

        Measured against 1292 real delivered answers before it was wired in:
        five findings, every one a genuine denial of something the office
        could do, no false positives. `capabilityLies` returns only the two
        defect verdicts — a capability that is off, needs approval, or whose
        attempt failed is reported by `capabilityClaims` and corrected by
        nobody, because those three sentences are true.
      */
      // The description opens with a capital because it is written for the
      // Governance page; mid-sentence it needs to read as prose.
      const lowerFirst = (t: string): string =>
        t === '' ? t : `${t.charAt(0).toLowerCase()}${t.slice(1)}`
      const cannotReally = capabilityLies(said, cap)[0] ?? null
      const denied = contradictsReality(said, reach)
      const answerC =
        cannotReally === null
          ? said
          : cannotReally.verdict === 'false_denial'
            ? `${said}\n\n(Correction, from the system rather than from me: this office CAN ` +
              `${lowerFirst(cannotReally.what)}. If I said otherwise above, ignore it — say the ` +
              `word and I will start it.)`
            : `${said}\n\n(Correction, from the system rather than from me: I cannot ` +
              `${lowerFirst(cannotReally.what)} — that is switched off here. If I offered it ` +
              `above, ignore the offer.)`
      const answer0 =
        denied === null
          ? answerC
          : `${answerC}\n\n(Correction, from the system rather than from me: ` +
            `${denied} IS connected and reachable right now. If I said otherwise above, ` +
            `ignore it — the honest version is that I could not find what you asked about, ` +
            `not that I cannot get in.)`

      /*
        And the offer, appended to the answer he is already reading (#147).

        An offer he never sees is not an offer, and the Governance page is
        somewhere he goes rather than somewhere he is. So the drafted rule is
        shown here, verbatim — the issue's *"visible verbatim before
        acceptance"* — and the press happens on the page, which is where every
        other accept-or-decline in this office lives.

        `offered` is false when this class of rule has already been put to him
        once, accepted OR declined, so a correction he has already answered
        about does not ask again on every repetition. That dedupe is in the
        migration rather than here, because it has to hold across jobs.

        Appended AFTER the answer is composed, so a failure to write the offer
        costs the offer and never the answer — and never swallowed silently:
        `app.cannot` is where a write allowed to fail records that it did.
      */
      const offered = correction === null ? null : await offerRule(deps.db, correction, job)
      const answer0b = confirmation === null ? answer0 : `${confirmation}\n\n${answer0}`
      const answer1 = offered === null ? answer0b : `${answer0b}\n\n${offered}`

      /*
        And the one sentence the model is not allowed to write - #302.

        The defect: understanding improved faster than acting, so the office
        now reads instructions it cannot carry out. Asked to "stick something
        down so I do not forget to ring Kevin", it read an assignment, filed
        nothing, wrote "Task added", was refused four times by the coherence
        gate and Grant received an EMPTY REPLY. Asked to "do what you think is
        best", it was refused once and the retry came back with "I'll draft an
        outline... create a task... add a Notion note" - three things, none of
        which exists, which PASSED because the future tense is a shape no
        detector had.

        The second is reached FROM the first: the refusal goes into
        `pinned_config` so the retry can see it, the retry reads "do not
        report it as done", and switches tense. The closed loop teaches the
        model to promise instead of claim.

        So this is not a seventh detector. `outcome.ts` classifies what
        CANONICALLY happened - from counts, never from the prose - and
        composes the sentence that class owes him. Prepended rather than
        appended, because the state is the headline and the model's prose is
        the detail: a person reading "I have not done this yet - I need which
        project this is for" cannot be misled by an "I'll get on it" further
        down, whereas the same two sentences the other way round read as a
        promise with a caveat.

        `act()` already proves the shape works. *"Happy to, but this one is not
        attached to a project, so I have nowhere to put it. Tell me which
        project and it is done."* is code-composed, always true, and has never
        needed a detector - because a composed sentence cannot be phrased
        around.
      */
      const outcomeLine = sayWhatHappened(outcome)
      /*
        Joined with a SPACE, not a blank line.

        The first version used a paragraph break and the live probe found
        what that costs: Grant has a standing rule reading *"From now on in
        this conversation, keep every answer to a single short paragraph"*,
        and a prepended paragraph makes that rule structurally
        unsatisfiable - the office would have to break one of his
        instructions to obey another. The coherence gate said so, on the
        deployed worker, about a real lesson of his rather than anything the
        harness taught.

        A leading sentence keeps the state first, which is the whole point,
        and leaves the shape of the answer to his rules rather than to this
        line's formatting.
      */
      const draft = outcomeLine === null ? answer1 : `${outcomeLine} ${answer1}`.trim()

      /*
        And the backstop, when the rows say nothing is coming - #302.

        The composed sentence made the truth unavoidable and the prompt
        clause asked the writer not to promise, and three live probes
        against v679 and v681 showed neither was enough: the office answered
        "I have not done this... but I'll create a task that flags the
        insurance renewal", against 0 tasks and 0 child jobs. Prompting is
        advisory.

        Authority stays with the rows. `unsupportedCommitment` is consulted
        ONLY where `mayCommitToFuture` is already false, so it never has to
        tell a real plan from an invented one - a promise backed by a child
        job is never shown to it.

        One rewrite, then the truth. A model asked to stop promising will
        promise something else, so the loop ends at a sentence composed from
        canonical state rather than at another attempt.
      */
      const may = contractFor(outcome)
      const held =
        may.mayCommitToFuture && may.mayClaimCompletion
          ? { answer: draft, outcome: 'clean' as const }
          : await heldToWhatIsQueued(
              draft,
              outcomeLine,
              async (instruction) => {
                const redo = await deps.router.complete({
                  messages: [
                    { role: 'system' as const, content: instruction },
                    { role: 'user' as const, content: draft },
                  ],
                  jobId: job.jobId,
                  maxTokens: 700,
                  // Deterministic: a correction that varies between attempts is a
                  // coin flip, and this one has exactly one job.
                  temperature: 0,
                })
                return scrub(redo.content)
              },
              may,
            )

      /*
        Recorded when neither the rewrite nor the fallback could produce a
        clean answer - which is only reachable on a COMPLETED turn, where
        there is no composed sentence to fall back to and the report of real
        work is worth more than a trailing promise.

        Allowed to fail without failing the job, and never silently: a write
        that may fail records that it did, which is the rule `consultations`
        was written into this repository for.
      */
      if (held.outcome === 'fell_back' && outcomeLine === null) {
        await deps.db
          .execute(`
            select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
              'an answer that does not promise what nothing will do', ${lit(who.slug)},
              ${lit('the rewrite still committed the office to unqueued work')})`)
          .catch(() => undefined)
      }
      const answer = held.answer

      /*
        The context, tagged. Assembled from the same values that went into the
        prompt, so it cannot drift from what the model was actually shown.
      */
      const shown: Context = {
        asked: instruction,
        saidBefore: [
          ...turns.map((t) => t.said),
          ...memory.recalled.map((m) => m.said),
          /*
            A decision GRANT made is a record of what he said (#129).

            So it belongs here, with the rest of his words, and the office's
            own conclusions do not — they go to `answeredBefore` below. Folding
            both into one list would let a conclusion the office drew become a
            fact it may cite, which is the whole asymmetry `provenance.ts`
            exists to keep.
          */
          ...hisDecisions.map((d) => `${d.question} — ${d.chose}. ${d.because}`),
        ],
        retrieved: [
          ...(context === '' ? [] : [context]),
          /*
            Correspondence is RETRIEVED, not the office's own prose (#172).

            A subject line the office read out of the cache is material, the
            same as a document — so it belongs in the list `established()`
            counts, and a figure Grant quoted in an email he sent is his own
            word rather than the office's guess. What it does NOT license is
            summarising a thread, and `mailBlock` says so in the block itself
            because that is the only place a model reads it.
          */
          ...(mailContext === '' ? [] : [mailContext]),
          ...(waitingContext === '' ? [] : [waitingContext]),
          ...(projectList === '' ? [] : [projectList]),
          ...(hisList === '' ? [] : [hisList]),
          ...(projectWork === '' ? [] : [projectWork]),
        ],
        /*
          What was LOOKED AT, not what came back.

          This read `context === '' ? [] : ['documents']`, which is the wrong
          question and collapsed a supported absence into "not checked":
          `retrieve()` runs on every one of these turns, so a search that
          returned zero rows is precisely the evidence entitling the office to
          say *"there is nothing in our documents about that"* — and the first
          version forbade exactly that sentence while allowing it after a
          search that DID find something.

          `hits` is the result; the search ran whenever there was no
          confirmation to short-circuit it. Projects are read unconditionally
          below.

          Nothing else on this path reads anything — there is no diary, inbox,
          task or contact lookup here at all — which is why a claim about any
          of those, positive OR negative, can never be grounded from this
          handler. The office may still say it has no record of one; that is
          the third state and `EPISTEMIC` protects it.
        */
        consultedDomains: [
          ...(answering ? (['documents'] as const) : []),
          'projects' as const,
          // Only when the project's work was actually read: a failed read is not a look that found nothing.
          ...(projectWorkBriefs.length > 0 ? (['tasks'] as const) : []),
          /*
            Mail, but only when the office could actually read it (#172).

            `coverage.blank` carries `mail` when the cache has gone stale on a
            project that has correspondents, and a domain listed as consulted
            is a domain the office may report an absence from. Listing it while
            the reader is broken is exactly the lie #257 exists to stop, one
            corpus over.
          */
          ...(answering && coverage !== null && !coverage.blank.includes('mail')
            ? (['mail'] as const)
            : []),
        ],
        /*
          Only the project list is held WHOLE. `retrieve()` returns the best
          few matches for a query, so it can support "there is nothing in our
          documents about renewals" and can never support "we hold four
          documents on renewals" — a search is not a census.
        */
        completeDomains: [
          'projects' as const,
          /*
            A project's tasks are held WHOLE when every one was listed (#408).

            "The only overdue task" is an exhaustiveness claim and the gate
            refuses it unless the list was a census. The reader says how many
            it listed against how many exist, so the claim is entitled exactly
            when the block itself said "All of them are listed", and a project
            with more tasks than fit is still a search that cannot support it.
          */
          ...(projectWorkBriefs.length > 0 &&
          projectWorkBriefs.every((b) => b.shown >= b.counts.total)
            ? (['tasks'] as const)
            : []),
        ],
        /*
          NOT `documents`, and never — see the comment above. This line is
          here to say that #257 did not change it: a search is not a census
          whatever the coverage, and a connector being indexed makes an
          absence REPORTABLE, not the collection COMPLETE. The two are
          different permissions and conflating them is what `provenance.ts`
          splits `consultedDomains` from `completeDomains` to prevent.
        */
        answeredBefore: [
          ...turns.map((t) => t.answered ?? ''),
          /*
            And what the specialists came back with (0549), HERE and not in
            `retrieved` — for exactly the reason the comment below gives about
            a handover. A colleague's output is the office's own prose, so it
            is conversation and never evidence.
          */
          ...turns.flatMap((t) => t.colleagues),
          ...memory.recalled.map((m) => m.answered),
          /*
            A colleague's handover is the office's own prose (#128).

            Here and NOT in `retrieved`, which is the whole safety property of
            the handoff: Oliver may write up what Emma found, and a figure of
            Emma's does not become grounded for him by having passed through
            her. `established()` excludes this list for exactly that reason.
          */
          ...(handedOver?.body === undefined ? [] : [handedOver.body]),
          // And decisions the OFFICE reached, for the same reason (#129).
          ...oursDecisions.map((d) => `${d.question} — ${d.chose}. ${d.because}`),
        ],
      }

      return {
        body: answer,
        confidence: 'medium',
        evidence: 'inferred',
        sources: [...sourceRefs(hits), ...mailRefs(mail)],
        contradictions: null,
        path: 'inference',
        model: completion.model,
        /*
          What this answer was entitled to know, tagged by where it came from
          (#231).

          The first version of this put the office's OWN earlier answers into
          the grounding alongside Grant's words and the retrieved documents.
          That is the defect it was built to catch, one layer up: a figure the
          office invented in turn two becomes, in turn five, a figure "in the
          conversation" and therefore grounded — so a fabrication launders
          every repetition of itself.

          `provenance.ts` carries the argument. Here the only thing that
          matters is that `answeredBefore` is passed in and deliberately left
          out of `established()`: what Grant says is evidence, what the office
          says is not, until something outside the conversation backs it.
        */
        grounding: established(shown),
        consulted: { consulted: consulted(shown), complete: complete(shown) },
        /*
          The census behind `completeDomains`, as DATA (#342).

          `completeDomains` says the office holds the project list WHOLE; this
          says how many are in it, so the gate can refuse an answer that denies
          a list it was handed. Passed as a number rather than parsed back out
          of `projectSpine`'s sentence, which would be a wording lock across
          two files.

          The reserved bucket is excluded, for the same reason `projectSpine`
          excludes it from the count: it is not one of his projects.
        */
        holds: { projects: openNow.filter((p) => !p.reserved).length },
        // The machinery half of #246's co-occurrence rule, from the same rows
        // the capability brief is built from.
        toolNames: toolNames(cap),
        /*
          What this job was TOLD to do, so #242's gate can ask whether the
          answer kept it. Lessons and skills both, because a standing
          preference can arrive either way: Grant correcting the office once
          becomes a lesson, and him teaching it a procedure becomes a skill.

          The rules as WRITTEN, never a summary of them — the gate hands the
          words back in the retry, and a paraphrase of somebody's own
          preference read back at them is worse than nothing.
        */
        standingRules: [
          ...guidance.lessons.map((l) => l.body),
          ...guidance.skills.map((sk) => sk.procedure),
        ],
        // What this turn actually did, so #248's check has a number to compare
        // the answer against.
        acted,
        /*
          And how many TASK rows it touched (ledger R3). A hand-off counts in
          acted; it is not a task ticked off, and the claim that one was
          is checked against this instead. Calling work off counts too:
          the model says "the related tasks have been cancelled" about
          stopped JOBS, and refusing a true stop confirmation fails the turn
          into silence, which is the expensive direction.
        */
        tasksChanged:
          (noted === null ? 0 : 1) +
          (changed === null ? 0 : 1) +
          (settledTask?.did === true ? 1 : 0) +
          (subbed?.did === true ? 1 : 0) +
          (filed === null ? 0 : 1) +
          (stopped === null ? 0 : 1),
        /*
          And who continues (#128).

          Only set when `speaker` found a sequence between two different
          people. The worker enqueues it AFTER this output is written and
          reviewed, because a handoff carries what was produced and a rejected
          answer must not be handed on.
        */
        ...(who.handoff === null
          ? {}
          : {
              handoff: {
                to: who.handoff.to,
                from: who.slug,
                clause: who.handoff.clause,
                because: who.handoff.because,
              },
            }),
      } satisfies HandlerOutput
    },
  }
}
