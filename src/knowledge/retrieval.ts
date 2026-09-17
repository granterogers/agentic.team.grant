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
  const named = c.blank.map((x) => SAID_AS[x] ?? x)
  const list =
    named.length === 1
      ? (named[0] ?? '')
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`
  return (
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
