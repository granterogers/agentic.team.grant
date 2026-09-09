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
import type { ProviderRouter } from '../providers/router.ts'

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
    'You are writing to Grant, who runs the place. He is a colleague you know ' +
    'well, not a customer.\n\n' +
    'Write like a person, in one or two short sentences. Contractions. No ' +
    'greeting, no sign-off, no "just checking in" — he can see who it is ' +
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
    })
    const said = completion.content.trim()
    return said === '' ? options.fallback : said
  } catch {
    return options.fallback
  }
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
  return await say(router, await speaker(db, slug), options)
}
