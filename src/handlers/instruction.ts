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
import { capabilityBrief, contradictsReality, reachNow, verbsNow } from '../agents/capability.ts'
import { connectRequest, populateRequest } from '../agents/connect.ts'
import { guidanceBrief, guidanceFor, recordSkillUse } from '../agents/guidance.ts'
import { type FoundLink, LINK_LABEL, type LinkRequest, linkRequest } from '../agents/links.ts'
import { join, PAIRING_WINDOW_MINUTES, readFragment } from '../agents/pairing.ts'
import {
  createsSomething,
  describePlan,
  needsGrantToChoose,
  type Plan,
  readPlan,
  type Step,
} from '../agents/plan.ts'
import { remember } from '../agents/remember.ts'
import { recordDecision, route, scanForDuplicates } from '../agents/router.ts'
import { readTeaching } from '../agents/teaching.ts'
import { resolveAgainstThread } from '../agents/thread.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { contextBlock, retrieve, sourceRefs } from '../knowledge/retrieval.ts'
import { NotebookActions } from '../notebook/actions.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { BOT_FOR_INBOUND } from '../telegram/roster.ts'
import { scrub } from '../text/scrub.ts'
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
async function speaker(
  db: SqlExecutor,
  addressedTo: string | null,
  instruction: string,
): Promise<Speaker> {
  const byName = addressedTo === null || addressedTo === '' ? null : addressedTo
  if (byName !== null) {
    const { rows } = await db.execute(`
      select slug, name, title, communication_style, responsibilities
        from public.staff where slug = ${lit(byName)} and active
    `)
    const s = rows[0] as Omit<Speaker, 'reason'> | undefined
    if (s !== undefined) {
      return { ...s, reason: 'addressed directly — Grant opened this person’s bot' }
    }
  }

  // Nobody was named, so the Chief of Staff decides. Deliberately the cheapest
  // possible routing rather than a second classifier: §9's roster ceilings
  // already encode who a kind of request belongs to, and the instruction
  // handler is not the place to re-litigate them.
  const { classifyIntent } = await import('../agents/intent.ts')
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
  const topical = await db
    .execute(`select slug from app.who_knows_about(${lit(instruction)}, 3)`)
    .then((r) => (r.rows as { slug: string }[]).map((x) => String(x.slug)))
    .catch(() => undefined)

  const { roster, reason } = pickRoster(classified, instruction, topical as never)
  const chosen = roster[0] ?? 'chief-of-staff'
  const { rows } = await db.execute(`
    select slug, name, title, communication_style, responsibilities
      from public.staff where slug = ${lit(chosen)} and active
  `)
  const s = rows[0] as Omit<Speaker, 'reason'> | undefined
  return s === undefined
    ? {
        slug: 'chief-of-staff',
        name: 'Claire',
        title: 'Chief of Staff',
        communication_style: null,
        responsibilities: null,
        reason,
      }
    : { ...s, reason }
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
      const resolved = await resolveAgainstThread(
        deps.db,
        deps.router,
        String(payload.command_id ?? ''),
        instruction,
        { correlationId: job.correlationId, jobId: job.jobId },
      )
      instruction = resolved.instruction

      const who = await speaker(deps.db, payload.addressed_to ?? null, instruction)

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
        await deps.db
          .execute(`
            insert into public.consultations
              (job_id, consulted_staff, requested_by, reason, provider_requests)
            values (${lit(job.jobId)}::uuid, array[${lit(who.slug)}]::text[],
                    'chief-of-staff', ${lit(who.reason)}, 0)
          `)
          .catch(() => undefined)
      }

      // Is this several things at once? If so, say it back and hold it.
      //
      // Grant: *"probably a good idea that he confirms he understands and spits
      // back what I want before going ahead."* A one-step instruction is
      // better served by doing it — a permission slip for one thing is
      // friction — so `readPlan` returns null below two substantive steps and
      // the single-step paths below take over.
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
            describePlan(plan),
          ]
            .filter((part) => part !== null)
            .join('\n\n'),
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: 'deterministic_retrieval',
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
          path: 'deterministic_retrieval',
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
          path: 'deterministic_retrieval',
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
      const confirmation = linked === null ? made : made === null ? linked : `${linked}\n\n${made}`

      // The same retrieval the office uses, so an instruction answered in
      // Telegram cites the same corpus as one answered in Slack. §22's rule
      // that the source interface must not change the organisation's
      // behaviour applies to the answer as much as to the routing.
      // What was said before this. Grant sent six messages in forty-three
      // seconds — a correction, a fact, an instruction, a check that we had
      // followed — and each was answered as a standalone sentence because
      // nothing carried the exchange (0089).
      const turns = await conversationBefore(deps.db, String(payload.command_id ?? ''))

      const hits = confirmation !== null ? [] : await retrieve(deps.db, instruction, job.projectId)
      const context = contextBlock(hits)
      // Asked once per answer rather than described in the prompt as a
      // constant: a connector switched off an hour ago must change what she
      // says she can do.
      const reach = confirmation !== null ? [] : await reachNow(deps.db)
      // What each reachable service can be made to DO. Read from the tool
      // registry rather than the network, so it costs a query and not a round
      // trip — and because "Notion is reachable" was never the sentence that
      // stopped Claire offering Grant an outline to paste in himself.
      const verbs = confirmation !== null ? [] : await verbsNow(deps.db)

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
                    'You are replying to Grant, who runs the place, in a private chat. He is ' +
                    'a colleague you know well, not a customer.\n\n' +
                    (turns.length === 0
                      ? ''
                      : 'You are mid-conversation. The turns before this one follow; the last ' +
                        'message is what you are answering. He corrects himself, changes his ' +
                        'mind and checks you have followed — read the latest message as a ' +
                        'continuation, not as a fresh request, and do not repeat what you ' +
                        'have already said.\n\n') +
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
                    'misread. Under 120 words in total, first person, no bullet points, no ' +
                    'headings, no bold.\n\n' +
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
                    `\n\n${capabilityBrief(reach, verbs)}` +
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
                      : ' Numbered excerpts from our documents follow. Prefer them, cite them ' +
                        'as [1], [2], and say plainly when they do not answer the question.'),
                },
                ...(context === ''
                  ? []
                  : [{ role: 'system' as const, content: `Our documents:\n\n${context}` }]),
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
      await recordDecision(deps.db, job.jobId, {
        ...decided,
        // The roster is the one thing not left to the classifier: Grant chose
        // it by opening this person's bot.
        roster: [who.slug] as never,
        rosterReason: who.reason,
      })

      // A confirmation is `verified`/`deterministic` because it reports a fact
      // about the queue rather than an opinion: the child job exists or the
      // insert failed. §16 exempts a deterministic output from review, which is
      // right here — there is nothing in it for a reviewer to disagree with.
      //
      // Its source is the job itself. §10's gate refuses `verified` with no
      // sources, and correctly: verified means someone can go and check.
      if (confirmation !== null) {
        return {
          body: confirmation,
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: 'deterministic_retrieval',
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
      const said = scrub(completion.content)

      const denied = contradictsReality(said, reach)
      const answer =
        denied === null
          ? said
          : `${said}\n\n(Correction, from the system rather than from me: ` +
            `${denied} IS connected and reachable right now. If I said otherwise above, ` +
            `ignore it — the honest version is that I could not find what you asked about, ` +
            `not that I cannot get in.)`

      return {
        body: answer,
        confidence: 'medium',
        evidence: 'inferred',
        sources: sourceRefs(hits),
        contradictions: null,
        path: 'inference',
        model: completion.model,
      } satisfies HandlerOutput
    },
  }
}
