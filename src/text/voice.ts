/**
 * Say it the way that person would say it.
 *
 * Grant, after a day of watching the team talk: *"There's a lot of mindless
 * repetition on Telegram and Slack. The point is you were supposed to make
 * these people pass the Turing test."*
 *
 * He is right, and the cause is not tone — it is that the messages were not
 * written. They were format strings:
 *
 *     Slack tokens renewed. Good for another 12 hours.
 *     Slack tokens renewed. Good for another 12 hours.
 *     Looked through 2 notebooks. Nothing new.
 *     Looked through 2 notebooks. Nothing new.
 *
 * Identical every time, because the same template ran with a different number
 * in it. Nobody types the same sentence twice a day for a week. That is the
 * tell, and no amount of adjusting the wording of the template fixes it —
 * a better template is still a template.
 *
 * ## What this does
 *
 * Takes the FACTS and the person, and asks them to say it. The facts stay
 * exactly as the handler computed them; what varies is the sentence. Marcus
 * reporting the same thing twice says it two different ways, which is what a
 * person does.
 *
 * ## Why the facts are passed as facts
 *
 * Not as a draft to reword. A model handed "make this friendlier" edits the
 * sentence and occasionally edits the number with it — and §11 draws a hard
 * line between a measured figure and a modelled one. Handing over the figures
 * and asking for a sentence keeps the arithmetic on this side of the boundary.
 *
 * ## Why it always falls back
 *
 * The template is still there, as the answer when the model is unavailable,
 * slow, or refuses. A message that does not arrive is worse than a message
 * that reads like a machine — and this runs on the free tier, where "the model
 * is busy" is an ordinary Tuesday.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { currentPerson } from '../office/person.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { scrub } from './scrub.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface Speaker {
  readonly slug: string
  readonly name: string
  readonly title: string
  readonly responsibilities: string | null
  readonly style: string | null
}

/** Who is speaking, from the roster. Null when the slug is not a person. */
export async function speaker(db: SqlExecutor, slug: string): Promise<Speaker | null> {
  const { rows } = await db.execute(`
    select slug, name, title, responsibilities, communication_style as style
      from public.staff where slug = ${lit(slug)} and active
  `)
  const row = rows[0] as
    | {
        slug: string
        name: string
        title: string
        responsibilities: string | null
        style: string | null
      }
    | undefined
  return row ?? null
}

export interface SayOptions {
  /** The facts, already computed and already true. One per line. */
  readonly facts: readonly string[]
  /** What the message is FOR, in a few words. Steers length and register. */
  readonly purpose: string
  /** Used when the model cannot be reached. Must be a complete message. */
  readonly fallback: string
  /** Rough ceiling. Spoken registers want fewer; a report can take more. */
  readonly words?: number
  /** Which model writes it. Undefined uses the ordinary failover order. */
  readonly model?: string | undefined
  /**
   * The job this is being written for, so the call is attributed (#268).
   *
   * Every caller of `sayAs` is a handler and every handler has one, so this
   * is very nearly required — it is optional because `say` is also reachable
   * from a script, where there genuinely is no job and inventing one would put
   * harness traffic into a measurement (0395).
   *
   * Without it the model call lands under the kind `(unattributed)` in
   * `public.model_record`, so a model that writes a bad morning note cannot be
   * told apart from one that answers a question badly — which is the whole
   * point of #127 keeping the record per KIND.
   */
  readonly job?: { readonly jobId: string; readonly correlationId: string }
}

/**
 * One short message, in that person's voice, carrying exactly those facts.
 *
 * Never throws: every failure returns the fallback, because the caller is
 * always in the middle of delivering something.
 */
export async function say(
  router: ProviderRouter,
  who: Speaker | null,
  options: SayOptions,
): Promise<string> {
  if (who === null || options.facts.length === 0) return options.fallback

  const words = options.words ?? 60

  const system =
    `You are ${who.name}, ${who.title} on a small team. ` +
    (who.responsibilities === null ? '' : `Your remit: ${who.responsibilities} `) +
    (who.style === null ? '' : `How you talk: ${who.style} `) +
    `You are writing to ${currentPerson().name}, who runs the place. They are a colleague you know ` +
    'well, not a customer, and they are your boss.\n\n' +
    'You are REPORTING, not instructing. Tell them what happened. Do not open ' +
    'with an imperative — "Make the decision now", "Approve the request", ' +
    '"Review that" are all wrong, because you do not give them orders and ' +
    'because you would be inventing an action nobody described. If something ' +
    'is waiting on them, say that it is waiting on them.\n\n' +
    'Write like a person, in one or two short sentences. Contractions. No ' +
    'greeting, no sign-off, no "just checking in" — they can see who it is ' +
    'from.\n\n' +
    // The whole point. Said twice because it is the instruction most likely to
    // be ignored, and the one this function exists for.
    'You send this kind of note often. Do NOT reach for the same phrasing ' +
    'every time — vary how you open, what you lead with, and how much you ' +
    'bother to say. Some days it is worth a remark; most days it is worth a ' +
    'few words.\n\n' +
    `Under ${String(words)} words. Never invent a number, a name or an ` +
    'outcome that is not in the facts. If a fact is missing, leave it out ' +
    'rather than guessing at it.\n\n' +
    'Never write: "I hope this helps", "Let me know if", "Just a quick", ' +
    '"Certainly", "As an AI", "Here is a summary". Do not sign your name.'

  const user =
    `${options.purpose}\n\nThe facts, all of them true and none of them to be ` +
    `changed:\n${options.facts.map((f) => `- ${f}`).join('\n')}`

  try {
    const completion = await router.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Room for the model to think and still answer. 0150's lesson: these
      // models count reasoning tokens in the same budget, and a tight ceiling
      // produces an empty completion rather than a short message.
      maxTokens: 1_500,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.job === undefined
        ? {}
        : { jobId: options.job.jobId, correlationId: options.job.correlationId }),
    })
    // Scaffolding out before the numeric guard: a control token is not a
    // number, and a reply that is nothing but one should fall back.
    const said = scrub(completion.content)
    if (said === '') return options.fallback

    // Every number in the sentence has to have come from the facts.
    //
    // The first live preview produced "We finished 96 pieces yesterday, two
    // failed" — correct — and, in the same paragraph, "No one else needs a
    // meeting", which nobody had said anything about. §11 draws a hard line
    // between a measured figure and a modelled one, and a free-tier model told
    // not to invent will still occasionally invent.
    //
    // A prose check is not possible; a NUMBER check is, and numbers are the
    // dangerous class. A stray clause is embarrassing. A stray figure is a lie
    // about the state of his business, and it arrives looking exactly like the
    // true ones beside it.
    const known = new Set(numbersIn(options.facts.join(' ')))
    const invented = numbersIn(said).filter((n) => !known.has(n))
    if (invented.length > 0) return options.fallback

    return said
  } catch {
    return options.fallback
  }
}

/**
 * Every number in a string, as written.
 *
 * Words as well as digits, because "two failed" and "2 failed" are the same
 * claim and a check that only saw digits would pass the one that was spelled
 * out. Small words only: nobody writes "three hundred and seventy-one" in a
 * status note, and the digits catch that case anyway.
 */
const WORD_NUMBERS: Readonly<Record<string, string>> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
}

const numbersIn = (text: string): string[] => {
  const digits = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0].replace(/\.0+$/, ''))
  const words = [...text.toLowerCase().matchAll(/\b[a-z]+\b/g)]
    .map((m) => WORD_NUMBERS[m[0]])
    .filter((n): n is string => n !== undefined)
  return [...digits, ...words]
}

/**
 * The common case: look the person up and let them say it.
 *
 * A handler holds a `db` and usually a router; it should not also hold a copy
 * of the roster query. Returns the fallback unchanged when there is no router,
 * no such person, or nothing to say — so a caller can use it unconditionally
 * and let the options decide.
 */
export async function sayAs(
  db: SqlExecutor,
  router: ProviderRouter | null,
  slug: string,
  options: SayOptions,
): Promise<string> {
  if (router === null) return options.fallback
  const [who, model] = await Promise.all([speaker(db, slug), writingModel(db)])
  return await say(router, who, { ...options, model })
}

/**
 * The model that writes what Grant reads, if one has been named.
 *
 * Empty — the default — means the ordinary failover order, which today is
 * whatever free models OpenRouter has. Those are enough to vary a sentence and
 * not enough to reliably write a good one: two previews of the same morning
 * note came back as "One decision is waiting on you. We logged 96 items
 * yesterday, but 2 failed…" and "Decision: review the two unsent messages…".
 * The first reads like Claire. The second does not.
 *
 * That gap is a model, not a prompt, and closing it costs money — which is
 * decision D2, still open, and Grant's. This setting is here so the answer is
 * a config change rather than a code change: name a model and the writing
 * path uses it, while everything else stays free.
 */
const writingModel = async (db: SqlExecutor): Promise<string | undefined> => {
  const { rows } = await db.execute(`
    select value #>> '{}' as m from public.system_config where key = 'voice.writing_model'
  `)
  const model = String((rows[0] as { m?: string } | undefined)?.m ?? '')
  return model === '' ? undefined : model
}
