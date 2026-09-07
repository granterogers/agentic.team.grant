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
 * exactly as though Grant had typed them. He asked not to be shown the
 * transcription, so nothing echoes it — the answer is the answer to what he
 * said, which is the only evidence that it was heard correctly he needs.
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
import { recordDecision, route, scanForDuplicates } from '../agents/router.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { contextBlock, retrieve, sourceRefs } from '../knowledge/retrieval.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { transcribeTelegramVoice } from '../voice/inbound.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

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
): Promise<{ slug: string; name: string; title: string; reason: string }> {
  const byName = addressedTo === null || addressedTo === '' ? null : addressedTo
  if (byName !== null) {
    const { rows } = await db.execute(
      `select slug, name, title from public.staff where slug = ${lit(byName)} and active`,
    )
    const s = rows[0] as { slug: string; name: string; title: string } | undefined
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
  const { roster, reason } = pickRoster(classified, instruction)
  const chosen = roster[0] ?? 'chief-of-staff'
  const { rows } = await db.execute(
    `select slug, name, title from public.staff where slug = ${lit(chosen)} and active`,
  )
  const s = rows[0] as { slug: string; name: string; title: string } | undefined
  return s === undefined
    ? { slug: 'chief-of-staff', name: 'Chief of Staff', title: 'Chief of Staff', reason }
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
      'I can start that, but this instruction is not attached to a project, so I have no ' +
      'notebook to put it in. Say which project and I will.'
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
      'I would need a notebook for that. This project has no NotebookLM notebook attached, ' +
      'and I am not going to write into whichever of yours I find first — attach one on the ' +
      'web front end and ask me again.'
    )
  }

  const started: string[] = []
  for (const kind of kinds) {
    // announce = false: this reply IS the announcement. The generate job's own
    // output would otherwise arrive seconds later saying the same thing twice.
    await db.execute(`
      select app.enqueue_child(
        ${lit(job.jobId)}::uuid, 'notebook.generate',
        jsonb_build_object('kind', ${lit(kind)}, 'instructions', ${lit(instructions)}),
        interval '0', false
      )
    `)
    started.push(KIND_LABEL[kind])
  }

  const list =
    started.length === 1
      ? (started[0] as string)
      : `${started.slice(0, -1).join(', ')} and ${String(started.at(-1))}`
  return started.length === 1
    ? `Starting the ${list} in "${String(notebook)}" now. Google takes a few minutes; I am ` +
        'watching for it and will post the link here and in the project channel when it lands.'
    : `Starting the ${list} in "${String(notebook)}" now. Google takes a few minutes each; I am ` +
        'watching for them and will post the links here and in the project channel as they land.'
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
      join public.telegram_chats ch on ch.chat_id = split_part(c.origin_ref, ':', 1)
      join public.telegram_bots t on t.bot_id = ch.bot_id
     where c.command_id = ${lit(commandId)}::uuid
       and t.enabled and t.token_ref is not null
     limit 1
  `)
  const token = (rows[0] as { token?: string | null } | undefined)?.token
  if (token === undefined || token === null || token === '') {
    throw new Error('a voice note arrived on a bot whose token we cannot resolve')
  }

  const heard = await transcribeTelegramVoice(token, String(payload.voice_file_id), {
    ...(payload.voice_seconds === null || payload.voice_seconds === undefined
      ? {}
      : { seconds: payload.voice_seconds }),
  })

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
      if (instruction === '' && (payload.voice_file_id ?? null) !== null) {
        instruction = await listen(deps.db, job, payload)
      }
      if (instruction === '') throw new Error('the command carried no instruction')

      const who = await speaker(deps.db, payload.addressed_to ?? null, instruction)

      // Does this ask for something to be MADE? If so, make it, and let the
      // confirmation be the reply.
      const wanted = notebookRequest(instruction)
      const confirmation =
        wanted === null ? null : await act(deps.db, job, wanted.kinds, wanted.instructions)

      // The same retrieval the office uses, so an instruction answered in
      // Telegram cites the same corpus as one answered in Slack. §22's rule
      // that the source interface must not change the organisation's
      // behaviour applies to the answer as much as to the routing.
      const hits = confirmation !== null ? [] : await retrieve(deps.db, instruction, job.projectId)
      const context = contextBlock(hits)

      const completion =
        confirmation !== null
          ? null
          : await deps.router.complete({
              messages: [
                {
                  role: 'system',
                  content:
                    `You are ${who.name}, ${who.title} on a small team. You are replying to ` +
                    'Grant, who runs it, in a private chat. Write as a colleague would: plain ' +
                    'prose, first person, no preamble, no bullet points, under 120 words. Do ' +
                    'not sign your name — the chat already shows who you are. If you are ' +
                    'inferring rather than reporting, say so.' +
                    (context === ''
                      ? ' Nothing in our own records matched this, so answer from general ' +
                        'knowledge and open by saying our records had nothing on it.'
                      : ' Numbered excerpts from our documents follow. Prefer them, cite them ' +
                        'as [1], [2], and say plainly when they do not answer the question.'),
                },
                ...(context === ''
                  ? []
                  : [{ role: 'system' as const, content: `Our documents:\n\n${context}` }]),
                { role: 'user', content: instruction },
              ],
              maxTokens: 2_000,
              correlationId: job.correlationId,
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
          path: 'deterministic',
          model: null,
        } as unknown as HandlerOutput
      }
      if (completion === null) throw new Error('no completion and no confirmation')

      return {
        body: completion.content.trim(),
        confidence: 'medium',
        evidence: 'inferred',
        sources: sourceRefs(hits),
        contradictions: null,
        path: 'inference',
        model: completion.model,
      } as unknown as HandlerOutput
    },
  }
}
