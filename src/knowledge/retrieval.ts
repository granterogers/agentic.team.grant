/**
 * Retrieval over the documents the system holds.
 *
 * ADR-0013 point 4: *"'Ask a question of my documents' is that search plus a
 * model call, and the provider router already does the second half."* The
 * second half has been done since Phase 2. This is the first half, and until it
 * existed the knowledge layer was a corpus nothing read — `npm run ask` sent
 * questions to a model with no context from the documents at all.
 *
 * ## What it does not do, and why that is deliberate
 *
 * **It does not claim the answer is verified.** §10 makes `verified` mean *a
 * reader can go and check*, and it requires sources. The tempting move is to
 * mark a retrieval-grounded answer `verified` because it has sources now. That
 * would be a lie of exactly the kind §10 exists to prevent: giving a model
 * documents makes an answer *grounded*, not *checked*, and nothing here reads
 * the answer to see whether the documents support it.
 *
 * So a grounded answer is `inferred` **with** sources. That combination is
 * legal, and it is the honest one: a model wrote this, and here is what it was
 * given. The sources are what was actually retrieved, never what the model says
 * it used — a model's own citation list is a claim, and this one is a record.
 *
 * ## Budget
 *
 * Documents run to tens of thousands of characters (the one real source in the
 * corpus is 69,121). A context window is finite and free models have the
 * smallest ones, so each hit contributes a bounded excerpt and the whole block
 * is capped. Truncation says it truncated.
 */

import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Per-document budget. Enough for a few paragraphs of a real answer. */
export const EXCERPT_CHARS = 1_500
/** Whole-block budget, well inside the smallest free context window. */
export const CONTEXT_CHARS = 8_000
export const DEFAULT_LIMIT = 5

export interface Hit {
  readonly documentId: string
  readonly title: string
  readonly connector: string
  readonly rank: number
  readonly excerpt: string
}

/**
 * The documents most relevant to a question.
 *
 * Returns `[]` rather than throwing when nothing matches, because an empty
 * corpus and an unmatched query are both normal and neither is an error. The
 * caller's job is to say so in the answer rather than to pretend it searched.
 */
export async function retrieve(
  db: SqlExecutor,
  query: string,
  projectId: string | null = null,
  limit: number = DEFAULT_LIMIT,
): Promise<readonly Hit[]> {
  const { rows } = await db.execute(`
    select s.document_id::text as document_id, coalesce(s.title, '(untitled)') as title,
           s.connector, s.rank,
           left(coalesce(d.content, ''), ${String(EXCERPT_CHARS)}) as excerpt
      -- 'any', not the default 'all'. A question is not a search box: ANDing
      -- every word of "what does our material say about the difference between
      -- coaching and mentoring" requires "material" and "say" to appear, and it
      -- matched nothing against a corpus whose one document is about exactly
      -- that. 0060 has the measurement.
      from app.search_documents(${lit(query)}, ${projectId === null ? 'null' : `${lit(projectId)}::uuid`}, ${String(limit)}, 'any') s
      join public.documents d on d.document_id = s.document_id
  `)
  return (
    rows as {
      document_id: string
      title: string
      connector: string
      rank: number
      excerpt: string
    }[]
  ).map((r) => ({
    documentId: r.document_id,
    title: r.title,
    connector: r.connector,
    rank: Number(r.rank),
    excerpt: r.excerpt,
  }))
}

/**
 * The hits, as a prompt fragment.
 *
 * Each is numbered and titled so the model can refer to one, and the caller
 * records the same list as `sources`. Returns `''` for no hits, so the caller
 * can tell "nothing was found" from "here is what was found" without inspecting
 * an array — and must then say so in the prompt rather than silently asking an
 * ungrounded question.
 */
export function contextBlock(hits: readonly Hit[], budget = CONTEXT_CHARS): string {
  if (hits.length === 0) return ''
  const parts: string[] = []
  let used = 0
  let dropped = 0

  for (const [index, hit] of hits.entries()) {
    const header = `[${String(index + 1)}] ${hit.title} (${hit.connector})\n`
    const piece = `${header}${hit.excerpt.trim()}\n`
    if (used + piece.length > budget) {
      dropped += 1
      continue
    }
    parts.push(piece)
    used += piece.length
  }

  // Said, not silent. A context block that quietly dropped half the evidence
  // would make the answer look better sourced than it is.
  const note =
    dropped === 0
      ? ''
      : `\n(${String(dropped)} further document(s) matched but did not fit the context budget.)\n`
  return `${parts.join('\n')}${note}`
}

/** What goes in `outputs.sources`: a record of what was retrieved. */
export function sourceRefs(hits: readonly Hit[]): readonly string[] {
  return hits.map((h) => `${h.connector}:${h.documentId} ${h.title}`)
}

/** What the index covers for a project, and what it does not (#257). */
export interface Coverage {
  /** Every attached connector with nothing indexed. */
  readonly blank: readonly string[]
  /** True only when every attached connector has fed something in. */
  readonly complete: boolean
  /** How many documents the project holds in total. */
  readonly documents: number
}

/**
 * Ask the index what it can and cannot speak for.
 *
 * #257's line, and the reason this exists rather than a boolean somewhere:
 * *"Connector failure/staleness is represented honestly rather than becoming a
 * false 'document does not exist' answer."*
 *
 * A search that found nothing is legitimate evidence for "there is nothing in
 * our documents" — `provenance.ts` is built on exactly that, and it is right
 * whenever the index covers what is attached. It stops being right the moment
 * a connector is attached and unindexed, and until now nothing anywhere could
 * tell the difference.
 *
 * An unreadable answer is treated as INCOMPLETE, never as complete: a reader
 * that cannot say what it covers must not be allowed to imply it covers
 * everything, which is the same direction `mayAct` leans for the same reason.
 */
export async function coverageOf(db: SqlExecutor, projectId: string | null): Promise<Coverage> {
  if (projectId === null) return { blank: [], complete: true, documents: 0 }
  try {
    const { rows } = await db.execute(`select app.project_knowledge(${lit(projectId)}::uuid) as k`)
    const raw = rows[0]?.k
    const k = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      blank?: unknown
      complete?: unknown
      documents?: unknown
    }
    return {
      blank: Array.isArray(k.blank) ? k.blank.map((x) => String(x)) : [],
      complete: k.complete === true,
      documents: typeof k.documents === 'number' ? k.documents : 0,
    }
  } catch {
    return { blank: [], complete: false, documents: 0 }
  }
}

/** Connector names as a person would say them, for a sentence the model reads. */
const SAID_AS: Readonly<Record<string, string>> = {
  notebooklm: 'the Google Notebook',
  drive: 'Google Drive',
  notion: 'Notion',
  github: 'GitHub',
  upload: 'the files you uploaded',
  mcp: 'the connected tool',
}

/**
 * What the office may and may not conclude from having found nothing.
 *
 * Returns `''` when the index covers everything attached, because a sentence
 * saying "I searched all of it" on every turn is noise that teaches a model to
 * skim the block it sits in.
 */
export function coverageNote(c: Coverage): string {
  if (c.blank.length === 0) return ''
  /*
    Mail is separated out, because it is not attached and the sentence would
    lie if it said so (#172).

    Every other entry in `blank` is a connector the project READS FROM with
    nothing indexed. Mail is a cache the whole office shares that has stopped
    being refreshed, so "your email is attached to this project and nothing
    from it has been indexed" is wrong twice in one clause. Its own sentence,
    and it survives alone: a project whose only gap is the mail still gets a
    caveat.
  */
  const mailNote = c.blank.includes('mail')
    ? 'The office has not been able to read the mail recently, so it can say ' +
      'nothing at all about whether something is in your email — never that ' +
      'there is nothing there. '
    : ''
  const connectors = c.blank.filter((x) => x !== 'mail')
  if (connectors.length === 0) return mailNote.trimEnd()
  const named = connectors.map((x) => SAID_AS[x] ?? x)
  const list =
    named.length === 1
      ? (named[0] ?? '')
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`
  return (
    mailNote +
    `What you searched is everything the office has INDEXED for this project ` +
    `(${String(c.documents)} document(s)). ${list} ${
      named.length === 1 ? 'is' : 'are'
    } attached to this project and nothing from ${
      named.length === 1 ? 'it' : 'them'
    } has been indexed yet. So if you found nothing, say that you found nothing ` +
    `in what you can see AND that ${list} ${
      named.length === 1 ? 'has' : 'have'
    } not been read — never that the thing does not exist.`
  )
}

/*
  The correspondence (#172, ADR-0037).

  Kept in this module rather than a new one because it answers the same
  question `retrieve` does — what does the office hold that bears on this — and
  a second module would be a second place for the project scope to be
  forgotten. It is a SEPARATE function rather than more rows from `retrieve`
  because the two are not the same kind of evidence and must not arrive in one
  undifferentiated list: a document is material the project was given, and a
  message is correspondence that mentions it.
*/

/** One cached message the office may cite for this project. */
export interface MailHit {
  readonly messageId: string
  readonly subject: string
  readonly from: string
  readonly sentAt: string
  readonly excerpt: string
  /** `contact` — the sender is on this project. `named` — an alias was in the subject. */
  readonly why: string
  /** The contact or the phrase that matched, so a mis-association is visible. */
  readonly matched: string
}

/**
 * The correspondence that belongs to a dashboard project.
 *
 * Returns `[]` for a job with no project and never reads the whole inbox,
 * which is the isolation rule of ADR-0037 rather than a default: a question
 * about one project may only see that project's mail, because a retrieval bug
 * here leaks something between contexts rather than merely being wrong.
 *
 * Swallows a failure into `[]` for the same reason `retrieve` returns `[]` on
 * no match — and `coverageOf` is what makes that honest, because a read that
 * failed leaves mail in `blank` and the office says so.
 */
export async function correspondence(
  db: SqlExecutor,
  projectId: string | null,
  query = '',
  limit = 6,
): Promise<readonly MailHit[]> {
  if (projectId === null) return []
  try {
    /*
      Both readers in one statement, because they answer half a question each.

      `mail_for_project` says WHICH messages belong to this project and WHY,
      and orders them by date. `mail_search` says which of them bear on the
      question that was asked, and orders them by that. A question about
      renewals wants the second and still needs the first's `why`, so the
      relevant set is taken in the search's order and the tier is joined on.

      One round trip rather than two, and the scope is stated twice on purpose:
      the search is given the project as well, so a change to one reader cannot
      quietly widen the other.
    */
    const { rows } = await db.execute(
      `select app.mail_for_project(${lit(projectId)}::uuid, 100) as belongs,
              app.mail_search(${lit(query)}, ${lit(projectId)}::uuid, ${String(limit)}) as matches`,
    )
    const asList = (raw: unknown): Record<string, unknown>[] => {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
    }
    const belongs = asList(rows[0]?.belongs)
    if (belongs.length === 0) return []

    const read = (x: Record<string, unknown>): MailHit => ({
      excerpt: String(x.excerpt ?? ''),
      from: String(x.from ?? 'unknown'),
      matched: String(x.matched ?? ''),
      messageId: String(x.message_id ?? ''),
      sentAt: String(x.sent_at ?? ''),
      subject: String(x.subject ?? '(no subject)'),
      why: String(x.why ?? 'named'),
    })
    const byId = new Map(belongs.map((x) => [String(x.message_id ?? ''), read(x)]))

    /*
      The relevant ones first, then the newest to fill the room.

      Never ONLY the search: "is there anything in my email about this project"
      contains no word any message holds, and answering it with nothing when
      six messages belong to the project would be the found-nothing failure
      this repository keeps paying for.
    */
    const relevant = asList(rows[0]?.matches)
      .map((x) => byId.get(String(x.message_id ?? '')))
      .filter((h): h is MailHit => h !== undefined)
    const seen = new Set(relevant.map((h) => h.messageId))
    const rest = [...byId.values()].filter((h) => !seen.has(h.messageId))
    return [...relevant, ...rest].slice(0, limit)
  } catch {
    return []
  }
}

/**
 * The correspondence, as a prompt fragment.
 *
 * Every line says WHY the message is here, because the two tiers are different
 * strengths of evidence and a model handed them flat will cite the weaker one
 * as confidently as the stronger. The instruction at the end is the important
 * part: a subject line and a hundred characters of snippet is not a thread, and
 * an answer that summarises what "the email says" from a snippet is inventing.
 */
/** A thread on this project that nobody has spoken in for a while (#172). */
export interface Waiting {
  readonly subject: string
  /** Who it is with. Never Grant, even on a thread he spoke last in. */
  readonly with: string
  readonly days: number
  /** Which way round. The two need different things from him. */
  readonly waiting: 'no reply to you' | 'you have not replied'
}

/**
 * What this project is waiting on (#172).
 *
 * Grant's hardest question on that Issue is *"are there outstanding
 * commitments I have forgotten?"*, and most of it cannot be answered here:
 * `src/google/mail.ts` fetches `format=metadata`, so there are no message
 * bodies in this system and a commitment extractor over subject lines would
 * be a model guessing about his own business.
 *
 * What IS a fact is the shape of a thread — who spoke last, and how long ago.
 * `app.mail_awaiting` derives it from ADR-0037's project association, so it
 * inherits that decision's isolation and its six negative controls rather
 * than restating them.
 *
 * Returns `[]` on any failure, deliberately. This is a helpful aside on a turn
 * about something else; a reader that threw would take the answer with it.
 */
export async function awaiting(
  db: SqlExecutor,
  projectId: string | null,
  days = 7,
  limit = 3,
): Promise<readonly Waiting[]> {
  if (projectId === null) return []
  try {
    const { rows } = await db.execute(
      `select app.mail_awaiting(${lit(projectId)}::uuid, ${String(days)}, ${String(limit)}) as w`,
    )
    const raw = rows[0]?.w
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(list)) return []
    return (list as Record<string, unknown>[]).map((x) => ({
      subject: String(x.subject ?? ''),
      with: String(x.with ?? 'unknown'),
      days: typeof x.days === 'number' ? x.days : 0,
      waiting: x.waiting === 'no reply to you' ? 'no reply to you' : 'you have not replied',
    }))
  } catch {
    return []
  }
}

/**
 * The waiting threads as a sentence the model can use, or nothing at all.
 *
 * Empty when there is nothing waiting, for the reason every caveat in this
 * file is conditional: a line that appears on every turn is a line nobody
 * reads, and this one is only worth its space when it has something to say.
 *
 * It states the SHAPE and refuses the conclusion. "Nobody has replied" is a
 * fact about a thread; "you owe them something" is an inference about a body
 * this office has never seen, and the difference is the whole reason the
 * derivation stops where it does.
 */
export function waitingBlock(items: readonly Waiting[]): string {
  if (items.length === 0) return ''
  const lines = items.map(
    (w) =>
      `- "${w.subject}" with ${w.with}: ${w.waiting}, ${String(w.days)} day${
        w.days === 1 ? '' : 's'
      } now`,
  )
  return (
    `Threads on this project that have gone quiet:\n${lines.join('\n')}\n\n` +
    `This is the SHAPE of the thread — who wrote last and when — and nothing ` +
    `about what was said, because the office holds no message bodies. You may ` +
    `say a thread has gone quiet. You may NOT say what was promised in it.`
  )
}

/** What the office can and cannot see in the inbox, for a project (#172). */
export interface MailCoverage {
  /** Messages the office holds at all, across every project. */
  readonly cached: number
  /** Contacts on THIS project — the strongest association tier. */
  readonly contacts: number
  /** Phrases that route to this project, the other tier. */
  readonly aliases: number
}

/**
 * Why an empty answer is empty (#172, #257).
 *
 * `mailBlock` returned '' when nothing matched, so the model was told NOTHING
 * about mail and any absence it stated — *"there is nothing in your email
 * about that"* — was a claim about a search whose shape it had never been
 * given. #257's rule, in the one domain #257 did not cover: a search that
 * found nothing is evidence of an absence only when the index covers what is
 * attached.
 *
 * It matters most here because of a fact ADR-0037 records and nothing acted
 * on: `public.contacts` holds **zero rows**, and a contact match is "the
 * strongest statement of relevance the database holds". So the strong tier
 * has never fired on real data, and every one of Grant's projects associates
 * nothing out of 206 cached messages. An office that answers "nothing in your
 * email" in that state is confidently wrong.
 *
 * Empty when coverage is complete, because a caveat on every turn is one
 * nobody reads — the same rule `app.project_knowledge` follows.
 */
export function mailCoverageNote(coverage: MailCoverage | null): string {
  if (coverage === null) return ''
  // Nothing cached at all is a different fact from nothing matching, and it
  // points at a different fix: connect or sync, rather than add a contact.
  if (coverage.cached === 0) {
    return (
      'The office holds no cached mail at all, so it has not looked at any ' +
      'correspondence. Say that you cannot see his email rather than that ' +
      'there is nothing in it.'
    )
  }
  if (coverage.contacts > 0 || coverage.aliases > 0) return ''
  return (
    `The office holds ${String(coverage.cached)} cached messages and can associate ` +
    'NONE of them with this project: mail reaches a project through a contact on ' +
    'it or a subject naming it, and this project has neither. So you may say you ' +
    'cannot connect any of his correspondence to this project, and you may NOT ' +
    'say there is nothing in his email about it — you have not established that.'
  )
}

export function mailBlock(hits: readonly MailHit[], coverage: MailCoverage | null = null): string {
  if (hits.length === 0) return mailCoverageNote(coverage)
  const lines = hits.map((h, i) => {
    const why =
      h.why === 'contact'
        ? `${h.matched} is a contact on this project`
        : `the subject names "${h.matched}"`
    return `[m${String(i + 1)}] ${h.subject} — from ${h.from}, ${h.sentAt.slice(0, 10)} (${why})\n${h.excerpt.trim()}`
  })
  return (
    `Correspondence the office holds for this project:\n\n${lines.join('\n\n')}\n\n` +
    `These are subject lines and short previews from the cached inbox — NOT the ` +
    `bodies, which the office never fetches. You may say that a message exists, ` +
    `who sent it and when, and you may quote the preview. You may NOT say what ` +
    `the message went on to say, or summarise a thread, because you have not ` +
    `read one.`
  )
}

/** What goes in `outputs.sources` for the mail that was read. */
export function mailRefs(hits: readonly MailHit[]): readonly string[] {
  return hits.map((h) => `mail:${h.messageId} ${h.subject}`)
}
