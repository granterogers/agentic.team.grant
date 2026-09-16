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

import { KIND_LABEL, notebookRequest, type RequestedKind } from '../agents/actions.ts'
import {
  capabilityBrief,
  capabilityNow,
  contradictsReality,
  EMPTY_CAPABILITY,
  toolNames,
} from '../agents/capability.ts'
import { clauses } from '../agents/clauses.ts'
import { connectRequest, populateRequest } from '../agents/connect.ts'
import { type Correction, readCorrection } from '../agents/correction.ts'
import { guidanceBrief, guidanceFor, recordSkillUse } from '../agents/guidance.ts'
import { classifyIntent } from '../agents/intent.ts'
import { type FoundLink, LINK_LABEL, type LinkRequest, linkRequest } from '../agents/links.ts'
import { asksWhatWasSaid, rejectsWithoutSaying, withoutNegated } from '../agents/negation.ts'
import { join, PAIRING_WINDOW_MINUTES, readFragment } from '../agents/pairing.ts'
import {
  createsSomething,
  describePlan,
  needsGrantToChoose,
  type Plan,
  readPlan,
  type Step,
} from '../agents/plan.ts'
import {
  type Context,
  complete,
  consulted,
  established,
  PROVENANCE_NOTE,
} from '../agents/provenance.ts'
import { remember } from '../agents/remember.ts'
import { recordDecision, route, scanForDuplicates } from '../agents/router.ts'
import { nameSubjects } from '../agents/subject.ts'
import { NEEDS_A_TITLE, type TaskRequest, taskRequest, titleReply } from '../agents/tasks.ts'
import { readTeaching } from '../agents/teaching.ts'
import { resolveAgainstThread } from '../agents/thread.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { contextBlock, retrieve, sourceRefs } from '../knowledge/retrieval.ts'
import { NotebookActions } from '../notebook/actions.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { BOT_FOR_INBOUND } from '../telegram/roster.ts'
import { scrub, scrubbedToNothing } from '../text/scrub.ts'
import {
  fetchTelegramAudio,
  readTranscriber,
  transcribeOverApi,
  transcribeTelegramVoice,
  VoiceNoteError,
} from '../voice/inbound.ts'
import { allowance, describe } from './meter.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

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
}

export interface InstructionDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter
}

interface Payload {
  readonly instruction?: string
  readonly voice_file_id?: string | null
  readonly voice_seconds?: number | null
  readonly addressed_to?: string | null
  readonly origin_channel?: string
  readonly origin_ref?: string
  readonly command_id?: string
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
const howComposed = async (
  db: SqlExecutor,
  jobId: string,
): Promise<'deterministic_retrieval' | 'inference'> =>
  await db
    .execute(`
      select count(*)::int as n from public.inference_usage u
       where u.correlation_id = (select correlation_id from public.jobs
                                  where job_id = ${lit(jobId)}::uuid)`)
    .then((r) =>
      Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0) === 0
        ? ('deterministic_retrieval' as const)
        : ('inference' as const),
    )
    .catch(() => 'inference' as const)

async function speaker(
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
): Promise<Speaker> {
  const byName = addressedTo === null || addressedTo === '' ? null : addressedTo
  if (byName !== null) {
    const { rows } = await db.execute(`
      select slug, name, title, communication_style, responsibilities
        from public.staff where slug = ${lit(byName)} and active
    `)
    const s = rows[0] as Omit<Speaker, 'reason' | 'alsoConvened' | 'convened'> | undefined
    if (s !== undefined) {
      /*
        Nobody else, and that is what stops delegation recursing.

        A child job spawned for a second specialist carries `addressed_to`, so
        it arrives here, takes this branch, and convenes nobody further. The
        depth trigger caps it at three anyway; this makes the natural fixed
        point one, which is what §9 wants.
      */
      return {
        ...s,
        reason: 'addressed directly — Grant opened this person’s bot',
        alsoConvened: [],
        // Addressing somebody IS convening them, so this one is not empty:
        // Grant picked the specialist himself.
        convened: [s.slug],
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
  const asks = clauses(forLookup)
  const perAsk = asks.length === 1 ? 3 : 1

  // Nothing to look up. `withoutNegated` can empty a message that was entirely
  // a withdrawal, and an empty VALUES list is a syntax error rather than an
  // empty answer.
  const found =
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
    projectId === null
      ? undefined
      : await db
          .execute(`select unnest(app.staff_on_project(${lit(projectId)}::uuid)) as slug`)
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
  const alsoConvened = roster.slice(1)
  const convened = roster
  const { rows } = await db.execute(`
    select slug, name, title, communication_style, responsibilities
      from public.staff where slug = ${lit(chosen)} and active
  `)
  const s = rows[0] as Omit<Speaker, 'reason' | 'alsoConvened' | 'convened'> | undefined
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
      }
    : { ...s, reason, alsoConvened, convened }
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
async function addTask(db: SqlExecutor, job: Job, asked: TaskRequest): Promise<string> {
  if (asked.title === null) return NEEDS_A_TITLE

  const said = await db
    .execute(`
      select app.task_add(
        ${job.projectId === null ? 'null' : `${lit(String(job.projectId))}::uuid`},
        ${lit(asked.title)}, null, null, null, false, 'the office',
        ${lit(job.jobId)}::uuid) as r`)
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
  return `Added it: **${answer?.title ?? asked.title}**.`
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
    select display_name from public.project_attachments
     where project_id = ${lit(String(job.projectId))}::uuid
       and connector = 'notebooklm' and enabled
     order by case when role = 'home' then 0 else 1 end
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
        ${lit(job.jobId)}::uuid, 'notebook.generate',
        jsonb_build_object('kind', ${lit(kind)}, 'instructions', ${lit(instructions)}),
        interval '0', true
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
  const meter = await allowance(db, kinds[0] ?? 'ask')
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
    `select transcript from public.inbound_commands where command_id = ${lit(commandId)}::uuid`,
  )
  const already = (existing[0] as { transcript?: string | null } | undefined)?.transcript
  if (already !== undefined && already !== null && already.trim() !== '') return already.trim()

  const { rows } = await db.execute(`
    select app.resolve_secret(t.token_ref) as token
      from public.inbound_commands c
      -- The bot it arrived ON, not "a bot with this chat id" (0097). A
      -- Telegram file_id is scoped to the bot that received the file, so the
      -- wrong token here does not fetch the wrong audio — it fetches nothing.
      ${BOT_FOR_INBOUND}
     where c.command_id = ${lit(commandId)}::uuid
       and t.enabled and t.token_ref is not null
     limit 1
  `)
  const token = (rows[0] as { token?: string | null } | undefined)?.token
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
  const vocabulary = await spokenVocabulary(db)
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
  const sayBackFollows = readPlan(heard.text) !== null
  if (!sayBackFollows) {
    await echoTranscript(token, String(payload.origin_ref ?? ''), heard)
  }

  await db.execute(`
    update public.inbound_commands
       set transcript = ${lit(heard.text)}, instruction = ${lit(heard.text)}
     where command_id = ${lit(commandId)}::uuid
  `)
  // Onto the job too, so `pinned_config` still explains the job's behaviour
  // afterwards — §6's whole reason for pinning.
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
async function spokenVocabulary(db: SqlExecutor): Promise<string[]> {
  // Ordered most-specific first: the hint has a token budget and the caller
  // truncates, so the words most likely to be mangled must come before the
  // ones a general model already knows.
  const fixed = ['NotebookLM', 'Notion', 'Supabase', 'Slack', 'Telegram', 'OpenRouter', 'Team HQ']
  try {
    const { rows } = await db.execute(`
      select name from public.staff where active
      union
      select name from public.projects where status = 'active'
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
  token: string,
  originRef: string,
  heard: { text: string; seconds: number; hinted: boolean },
): Promise<void> {
  const [chatId, messageId] = originRef.split(':')
  if (chatId === undefined || chatId === '') return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        // Threaded under the voice note. `allow_sending_without_reply` so a
        // deleted original degrades to a loose message rather than to nothing.
        ...(messageId === undefined || messageId === '' || !/^\d+$/.test(messageId)
          ? {}
          : {
              reply_to_message_id: Number(messageId),
              allow_sending_without_reply: true,
            }),
        // Quoted, so it is unmistakably a repeat of his words rather than the
        // bot saying something. The seconds are there because a transcript
        // much shorter than the recording is its own kind of wrong.
        text:
          `🎧 Heard (${String(Math.round(heard.seconds))}s): “${heard.text}”\n\n` +
          'Working on it — if that is not what you said, send it again and ignore ' +
          'what comes back.',
        disable_notification: true,
      }),
    })
  } catch {
    // Deliberately swallowed. See the note above.
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
  named: string | null,
): Promise<{ project: Candidate | null; ask: string | null }> {
  const { rows } = await db.execute(`
    select project_id::text as project_id, slug, name
      from public.projects where status = 'active' order by updated_at desc
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

  const { project, ask } = await whichProject(db, request.namedProject)
  if (project === null) return ask

  const said: string[] = []

  // Places first: a notebook attached in the same message is the destination
  // the sources in that message should go to, and doing it in the other order
  // would refuse the sources for want of the notebook that arrived with them.
  const places = request.links.filter((l) => l.kind === 'notebooklm' || l.kind === 'notion')
  for (const link of places) {
    const { rows } = await db.execute(`
      select app.hq_attach(
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
      select display_name from public.project_attachments
       where project_id = ${lit(project.project_id)}::uuid
         and connector = 'notebooklm' and enabled
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
      ${lit(job.jobId)}::uuid, 'notebook.add_source',
      jsonb_build_object('url', ${lit(link.url)}, 'kind', ${lit(link.kind)}),
      interval '0', false, ${lit(projectId)}::uuid
    )
  `)
}

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
     where c.command_id <> self.command_id
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = split_part(self.origin_ref, ':', 1)
       and coalesce(c.addressed_to, '') = coalesce(self.addressed_to, '')
       and coalesce(c.subject, c.actor) = coalesce(self.subject, self.actor)
       and c.paired_with is null
       and c.callback_action is null
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
       where command_id in (${lit(commandId)}::uuid, ${lit(other.command_id)}::uuid)
    `)
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
): Promise<Memory> {
  if (commandId === '') return NOTHING_OLDER

  const extent = await db
    .execute(`select app.conversation_extent(${lit(commandId)}::uuid) as e`)
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
      `select app.recall_conversation(${lit(commandId)}::uuid, ${lit(instruction.slice(0, 500))}, 3) as r`,
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
): Promise<readonly { said: string; answered: string | null }[]> {
  if (commandId === '') return []
  const { rows } = await db.execute(`select app.conversation_before(${lit(commandId)}::uuid) as t`)
  const raw = (rows[0] as { t: unknown } | undefined)?.t
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => entry as { said?: string; answered?: string | null })
    .filter((entry) => typeof entry.said === 'string' && entry.said.trim() !== '')
    .map((entry) => ({
      said: String(entry.said),
      answered:
        entry.answered === null || entry.answered === undefined ? null : String(entry.answered),
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
  correction: Correction,
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
async function resolveProjects(db: SqlExecutor, plan: Plan): Promise<Plan> {
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
    const { rows } = await db.execute(`
      select r.project_id::text, r.slug, r.name, r.confidence::float8 as confidence
        from app.resolve_project_by_name(${lit(name)}) r
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

      // Two messages that are one instruction. Grant shares a video and then
      // says what to do with it, or the reverse; both halves are correct alone
      // and wrong apart. See `src/agents/pairing.ts`.
      const paired = await pairWithNearby(deps.db, job, payload, instruction)
      if (paired !== null) instruction = paired

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
      if (rejectsWithoutSaying(instruction)) {
        // The thread is read again here rather than hoisted: this path is
        // rare, the read is one query, and moving the main one earlier would
        // put a database call in front of every message to serve this one.
        const last = (
          await conversationBefore(deps.db, String(payload.command_id ?? '')).catch(() => [])
        ).at(-1)
        /*
          Attributed, because #65's whole finding was 499 jobs with a NULL
          `recipient_agent` and Grant reasonably concluding nothing was being
          delegated. This path returns before `speaker()` runs, so the row
          would be nobody's — and an empty roster already means the Chief of
          Staff everywhere else in this system, which is exactly who asks a
          clarifying question.
        */
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
        His words, before the resolver rewrites them (#147).

        `resolveAgainstThread` expands a fragment into the instruction it
        refers to, which is exactly what the answering path needs and exactly
        what a correction reader must not see: "no, at the end" resolves into
        the whole of the previous request, and a standing rule drafted from
        THAT would be a rule saying what he was already asking for rather than
        what he wanted changed. Same reason `rejectsWithoutSaying` is checked
        above the resolver and not below it.
      */
      const asSaid = instruction

      const resolved = await resolveAgainstThread(
        deps.db,
        deps.router,
        String(payload.command_id ?? ''),
        instruction,
        { correlationId: job.correlationId, jobId: job.jobId },
      )
      instruction = resolved.instruction

      const who = await speaker(
        deps.db,
        payload.addressed_to ?? null,
        instruction,
        deps.router,
        job.projectId ?? null,
      )

      /*
        Write down who it went to (#65).

        `jobs.recipient_agent` has existed since the job engine and was NULL on
        all 499 real jobs — the routing decision was made, recorded in
        `routing_decisions`, and then thrown away. So "did Emma do this?" had
        no answer, and Grant reasonably concluded nothing was being delegated.

        This is the whole of the cheap half of the fix: the decision already
        existed, it just never reached the row anyone would look at.
      */
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
      for (const other of who.alsoConvened) {
        const spawned = await deps.db
          .execute(`
            select app.enqueue_child(
              ${lit(job.jobId)}::uuid, 'office.instruction',
              jsonb_build_object(
                'instruction', ${lit(instruction.slice(0, 4_000))},
                'addressed_to', ${lit(other)},
                'origin_channel', ${lit(String(payload.origin_channel ?? 'teamhq'))},
                'command_id', ${lit(String(payload.command_id ?? ''))},
                'handed_off_by', ${lit(who.slug)}
              ),
              interval '0', false
            )::text as id
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
            select public.record_consultation(${lit(job.jobId)}::uuid, ${lit(other)},
              ${lit(who.slug)},
              ${lit(`convened alongside ${who.slug}: ${who.reason}`.slice(0, 400))}, 0)
          `)
          .catch(() => undefined)
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
            select public.record_consultation(${lit(job.jobId)}::uuid, ${lit(who.slug)},
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

      const unresolved = readPlan(instruction)
      const plan = unresolved === null ? null : await resolveProjects(deps.db, unresolved)
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
        await deps.db.execute(`
          update public.jobs
             set pinned_config = pinned_config
                   || jsonb_build_object('plan_steps', ${lit(JSON.stringify(plan.steps))}::jsonb)
           where job_id = ${lit(job.jobId)}::uuid
        `)
        await deps.db.execute(`
          select app.request_approval(
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
      const fill = populateRequest(instruction)
      const wire = connectRequest(instruction)
      if ((wire !== null || fill) && job.projectId !== null && job.projectId !== undefined) {
        // A child of this job, so it inherits the correlation id, the priority
        // and — the part that matters — the project this instruction resolved
        // to. `enqueue_job` does not exist; `enqueue_child` is how the office
        // hangs follow-up work off the thing that asked for it.
        if (wire !== null) {
          await deps.db.execute(`
            select app.enqueue_child(
              ${lit(job.jobId)}::uuid,
              'office.notion_adopt',
              '{}'::jsonb,
              interval '0',
              true,
              ${lit(job.projectId)}::uuid
            )
          `)
        }
        if (fill) {
          await deps.db.execute(`
            select app.enqueue_child(
              ${lit(job.jobId)}::uuid,
              'office.notion_import',
              '{}'::jsonb,
              interval ${wire === null ? "'0'" : "'1 minute'"},
              true,
              ${lit(job.projectId)}::uuid
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
      const teaching = readTeaching(instruction)
      if (teaching !== null) {
        const kept = await remember(
          deps.db,
          teaching,
          'grant',
          // Addressed to one person, or to the office. Getting this backwards
          // means a rule for Ruby quietly governing Daniel.
          (payload.addressed_to ?? '') === '' ? null : who.slug,
          job.jobId,
        )
        return {
          body: kept.said,
          confidence: 'high',
          // The write either happened or the sentence says it did not.
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: await howComposed(deps.db, job.jobId),
          model: null,
        } satisfies HandlerOutput
      }

      const sent = linkRequest(instruction)
      const linked = sent === null ? null : await handleLinks(deps.db, job, sent)

      // Does this ask for something to be MADE? If so, make it, and let the
      // confirmation be the reply.
      // Both, independently. "Add this video and make an audio overview" is
      // two instructions in one sentence, and the first version answered only
      // the half it noticed first.
      const wanted = notebookRequest(instruction)
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
      const asked = taskRequest(instruction, classifyIntent(instruction))

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
        asked !== null || instruction.trim().length > 90
          ? null
          : await deps.db
              .execute(`
                select coalesce(
                  (select left(o.body, 500) from public.outputs o
                     join public.inbound_commands c on c.job_id = o.job_id
                    where c.origin_channel = 'teamhq'
                      and c.command_id <> ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid
                      and split_part(c.origin_ref, ':', 1) = (
                        select split_part(origin_ref, ':', 1) from public.inbound_commands
                         where command_id = ${lit(String(payload.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid)
                    order by c.received_at desc limit 1), '') as said`)
              .then((r) => String((r.rows[0] as { said?: string } | undefined)?.said ?? ''))
              /*
                The third argument is what stops a request becoming a title
                (#255): a turn that asks for something of its own is never the
                answer to a question about something else.
              */
              .then((prev) =>
                titleReply(
                  instruction,
                  prev === '' ? null : prev,
                  notebookRequest(instruction) !== null,
                ),
              )
              .catch(() => null)

      const filed =
        asked !== null
          ? await addTask(deps.db, job, asked)
          : namedLater === null
            ? null
            : await addTask(deps.db, job, {
                title: namedLater,
                matched: 'answered the title question',
              })

      const confirmation = [linked, made, filed].filter((x) => x !== null).join('\n\n') || null

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
      const acted = (made === null ? 0 : 1) + (filed === null ? 0 : 1) + who.alsoConvened.length

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

      const turnsBefore = await conversationBefore(deps.db, String(payload.command_id ?? ''))
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
      const correction = readCorrection(asSaid, (turnsBefore.at(-1)?.answered ?? null) !== null)

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
      const memory = await recallOlder(deps.db, commandId, instruction)

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

      const hits = confirmation !== null ? [] : await retrieve(deps.db, instruction, job.projectId)
      const context = contextBlock(hits)

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
      const projectsNow = await deps.db
        .execute(`
          select slug, name from public.projects
           where status = 'active' and not is_fixture
           order by updated_at desc limit 25`)
        .then((r) => (r.rows as { slug: string; name: string }[]).map((p) => p.name))
        .catch(() => [] as string[])
      const projectList =
        projectsNow.length === 0
          ? ''
          : `The dashboard projects open right now, ${String(projectsNow.length)} of them: ${projectsNow.join(', ')}.`
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
      const cap = confirmation !== null ? EMPTY_CAPABILITY : await capabilityNow(deps.db, who.slug)
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
      const guidance =
        confirmation !== null
          ? { lessons: [], skills: [] }
          : await guidanceFor(deps.db, who.slug, job.kind, job.projectId)
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
                `select app.project_instruction_for(${lit(job.projectId)}::uuid, ${lit(who.slug)}) as v`,
              )
              .then((r) => String((r.rows[0] as { v?: string } | undefined)?.v ?? '').trim())
              .catch(() => '')

      const completion =
        confirmation !== null
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
                      : `On this project specifically, Grant has told you: ${localBrief} `) +
                    'You are replying to Grant, who runs the place, in a private chat. He is ' +
                    'a colleague you know well, not a customer.\n\n' +
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
                    'If you cannot satisfy everything he has asked for at once — his own ' +
                    'standing instructions included — do the most useful thing and say in ' +
                    'one clause which constraint you set aside and why. Never drop one ' +
                    'silently.\n\n' +
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
                    `${PROVENANCE_NOTE}\n\n` +
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
                        'over anything you merely know.\n\nBut what Grant states in his own ' +
                        'message outranks every document. If he gives you a figure, a name or ' +
                        'a fact, use HIS, even where a document says otherwise — and when a ' +
                        'document disagrees with him, say so rather than quietly choosing ' +
                        'one.'),
                },
                ...(context === ''
                  ? []
                  : [{ role: 'system' as const, content: `Our documents:\n\n${context}` }]),
                // Canonical state, so a question about the office's own spine
                // has an answer that is both honest and useful.
                ...(projectList === '' ? [] : [{ role: 'system' as const, content: projectList }]),
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
                ...turns.flatMap((t) =>
                  t.answered === null
                    ? [{ role: 'user' as const, content: t.said }]
                    : [
                        { role: 'user' as const, content: t.said },
                        { role: 'assistant' as const, content: t.answered },
                      ],
                ),
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
        ...(job.projectId === null ? {} : { projectId: job.projectId }),
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
      if (confirmation !== null) {
        return {
          body: confirmation,
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

      const denied = contradictsReality(said, reach)
      const answer0 =
        denied === null
          ? said
          : `${said}\n\n(Correction, from the system rather than from me: ` +
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
      const answer = offered === null ? answer0 : `${answer0}\n\n${offered}`

      /*
        The context, tagged. Assembled from the same values that went into the
        prompt, so it cannot drift from what the model was actually shown.
      */
      const shown: Context = {
        asked: instruction,
        saidBefore: [...turns.map((t) => t.said), ...memory.recalled.map((m) => m.said)],
        retrieved: [
          ...(context === '' ? [] : [context]),
          ...(projectList === '' ? [] : [projectList]),
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
          ...(confirmation === null ? (['documents'] as const) : []),
          'projects' as const,
        ],
        /*
          Only the project list is held WHOLE. `retrieve()` returns the best
          few matches for a query, so it can support "there is nothing in our
          documents about renewals" and can never support "we hold four
          documents on renewals" — a search is not a census.
        */
        completeDomains: ['projects' as const],
        answeredBefore: [
          ...turns.map((t) => t.answered ?? ''),
          ...memory.recalled.map((m) => m.answered),
        ],
      }

      return {
        body: answer,
        confidence: 'medium',
        evidence: 'inferred',
        sources: sourceRefs(hits),
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
        // The machinery half of #246's co-occurrence rule, from the same rows
        // the capability brief is built from.
        toolNames: toolNames(cap),
        // What this turn actually did, so #248's check has a number to compare
        // the answer against.
        acted,
      } satisfies HandlerOutput
    },
  }
}
