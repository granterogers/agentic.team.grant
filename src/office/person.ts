/**
 * WHO THE OFFICE IS TALKING TO (post-P4, #404).
 *
 * The office's wording used to say "Grant" wherever it meant "the person this office works for", which was right while
 * there was one person and wrong the moment there were two: a second person's agents wrote "Put on Grant's list" and
 * "report it to Grant". This is the one place that answers the question, and it answers it from the TRUSTED office - the
 * office a claimed job belongs to, fixed when the job was made - never from request text, a payload, a model's answer, an
 * email address or a default.
 *
 *   job -> office (app.job_office) -> public.offices.name -> the words
 *
 * `offices.name` is the canonical person name (Grant's office is named "Grant"); there is no second store of it.
 *
 * ## How it reaches the words
 *
 * Prompt builders are pure functions called from dozens of places, and most handlers are built once around a database
 * handle, so a person passed as a parameter would have to be threaded through every call chain. The worker already
 * records which job is running (`withJobScope`) in an ambient scope; this records WHO IT IS FOR in the same way, once,
 * at the one place handlers are invoked. `currentPerson()` is then read when a sentence is composed (never at import
 * time, which has no job).
 *
 * ## What it refuses to do
 *
 *   - It does not guess. An office that is not a person (the test office, the deployment's own, a sample) has no person
 *     to address, so the words are the neutral "the person you work for" - never "Grant", and never the name of a test
 *     office read aloud.
 *   - With no scope at all (an operator tool, a unit test) the same neutral words are used.
 *   - It does not infer pronouns. A name says nothing about them, so wording here uses the name or "they".
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SqlExecutor } from '../db/executor.ts'

export type Person = {
  /** What to call them: the office's name, or the neutral words when there is nobody to name. */
  readonly name: string
  /** Possessive of `name`, composed once so every sentence forms it the same way. */
  readonly possessive: string
  /** True only for a person office with a usable name. */
  readonly named: boolean
}

const NEUTRAL_NAME = 'the person you work for'

/** A character that is invisible or a control: kept out of a name that goes into a prompt. Compared by code point so no
 * formatter can rewrite a range of invisible characters into the characters themselves. */
const isInvisible = (code: number): boolean =>
  code <= 0x1f ||
  code === 0x7f ||
  (code >= 0x200b && code <= 0x200f) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0xfeff

const tidy = (raw: unknown): string =>
  typeof raw === 'string'
    ? Array.from(raw, (ch) => (isInvisible(ch.codePointAt(0) ?? 0) ? ' ' : ch))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
    : ''

/** Pure: the person for an office of this kind and name. Anything but a person office with a name is neutral. */
export const personFrom = (kind: unknown, name: unknown): Person => {
  const clean = tidy(name)
  if (kind !== 'person' || clean === '') {
    return { name: NEUTRAL_NAME, possessive: `${NEUTRAL_NAME}'s`, named: false }
  }
  return { name: clean, possessive: `${clean}'s`, named: true }
}

export const NOBODY: Person = personFrom(null, null)

const scope = new AsyncLocalStorage<Person>()

/** The person the running job is for; the neutral person when no job is in scope. */
export const currentPerson = (): Person => scope.getStore() ?? NOBODY

/** Run `work` for `person`. */
export const withPerson = <T>(person: Person, work: () => T): T => scope.run(person, work)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The person a claimed job is for, asked of the database through the job's own office. A job id that is not a uuid, a
 * job that does not exist and a query that fails all give the neutral person: the cost of not knowing is a plainer
 * sentence, never somebody else's name.
 */
export const personOfJob = async (db: SqlExecutor, jobId: string): Promise<Person> => {
  if (!UUID.test(jobId)) return NOBODY
  try {
    const { rows } = await db.execute(
      `select o.kind::text as kind, o.name as name from public.offices o
        where o.office_id = app.job_office('${jobId}'::uuid)`,
    )
    const row = rows[0] as { kind?: unknown; name?: unknown } | undefined
    return row === undefined ? NOBODY : personFrom(row.kind, row.name)
  } catch {
    return NOBODY
  }
}
