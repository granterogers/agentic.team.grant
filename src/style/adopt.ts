/**
 * The worker's one caller of `app.style_adopt_from_document` (0970, HQ-STYLE-018).
 *
 * The dashboard's button reaches that function through the gateway (`hq_style_adopt_from_document`, channel
 * `teamhq`). A person who says it in a conversation reaches the SAME function from here, naming the channel the
 * message came in on. There is no second implementation of "keep this report's style": no other code in this
 * repository writes `style_profiles` from a report, and `tests/style/adopt-is-one-door.test.ts` holds that.
 *
 * Both callers - the conversation, asking, and the `style.adopt` job, performing a confirmed replacement - use this.
 */
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORD = /^[a-z][a-z0-9_]{0,31}$/

export interface AdoptRequest {
  /** The job the work is done for; the office is that job's. */
  readonly jobId: string
  readonly slug: string
  readonly documentId: string
  /** True only when the person has said yes to replacing a style the project already has. */
  readonly confirm: boolean
  /** The channel the person spoke on, written as a fact about the door. */
  readonly channel?: string | null
  readonly by?: string | null
}

export interface AdoptResult {
  readonly ok?: boolean
  readonly error?: string
  readonly adopted?: boolean
  readonly unchanged?: boolean
  readonly needs_confirmation?: boolean
  readonly replaces?: readonly string[]
  readonly replaced_existing?: boolean
  readonly dropped?: readonly string[]
  readonly no_snapshot?: boolean
  readonly message?: string
}

export async function adoptStyleFromDocument(
  db: SqlExecutor,
  req: AdoptRequest,
): Promise<AdoptResult> {
  if (!UUID.test(req.jobId) || !UUID.test(req.documentId)) {
    return { error: 'that is not a report I can find' }
  }
  const channel =
    req.channel !== undefined && req.channel !== null && WORD.test(req.channel) ? req.channel : null
  const by = req.by === undefined || req.by === null || req.by.trim() === '' ? null : req.by.trim()
  const { rows } = await db.execute(`
    select app.style_adopt_from_document(
             app.job_office(${lit(req.jobId)}::uuid), ${lit(req.slug)}, ${lit(req.documentId)}::uuid,
             ${req.confirm ? 'true' : 'false'},
             ${channel === null ? 'null' : lit(channel)}, ${by === null ? 'null' : lit(by)}) as r`)
  const r = (rows[0] as { r?: unknown } | undefined)?.r
  const parsed = typeof r === 'string' ? (JSON.parse(r) as unknown) : r
  return parsed !== null && typeof parsed === 'object'
    ? (parsed as AdoptResult)
    : { error: 'no answer' }
}

/** The sentence for what happened, for the person. Wording lives here once. */
export function saidAboutAdoption(title: string, r: AdoptResult): string {
  if (r.adopted === true) {
    return (
      `Saved. The style of “${title}” is now this project's report style, so reports made here from now on are set in it.` +
      (r.replaced_existing === true ? ' It replaced the style the project had.' : '') +
      (r.dropped !== undefined && r.dropped.length > 0
        ? ' One thing could not come across: the logo it used is not held by this project, so it was left out.'
        : '')
    )
  }
  if (r.unchanged === true) {
    return `This project already has exactly the style of “${title}”, so there was nothing to change.`
  }
  const why = r.error ?? r.message ?? 'it was not accepted'
  return `I did not save a style: ${why}${/nothing (?:was|has been) changed/i.test(why) ? '' : ' Nothing was changed.'}`
}
