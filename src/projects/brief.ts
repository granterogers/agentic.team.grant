/**
 * Initial project briefs.
 *
 * This is the first thing in the system that reads knowledge and produces
 * judgement, and it is deliberately the cheapest possible version of that:
 * cached source text in, one free-model completion out, provenance recorded.
 *
 * ## Why it costs no Notebook quota
 *
 * §7's plan is to *"pull each source's text once via fulltext/guide retrieval;
 * cache in Postgres, fingerprinted. Agents reason over cached text on the
 * normal inference provider — **zero Notebook quota**. Reserve Notebook chats
 * for genuine cross-source synthesis."*
 *
 * A brief is a summary of sources already read, not a question that needs
 * Notebook's own retrieval, so it reads `documents` and calls the
 * provider router. Gate 2 proved the cache can be filled (94,490 characters
 * from one source); this is the half that spends it.
 *
 * If briefs went through `chat.ask` instead, one per project per change would
 * exhaust a 30/day budget by mid-morning on a busy day. The distinction
 * between "synthesis across sources Notebook can see" and "summarising text we
 * already hold" is the whole quota design, and this is where it is applied.
 *
 * ## Why the brief is `inferred`, never `verified`
 *
 * §12 requires showing Verified/Inferred/Speculative. A brief is a model's
 * reading of source text: the sources are verified, the reading is not.
 * Labelling it `verified` because the inputs were would be the category error
 * §12 exists to prevent.
 */
import type { SqlExecutor } from '../db/executor.ts'
import { EmptyCompletionError, type ProviderRouter } from '../providers/router.ts'
import { scrub } from '../text/scrub.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * How much cached text to put in front of the model.
 *
 * Free models have small context windows and the router refuses paid ones, so
 * a brief over a 94,000-character source has to be selective. Taking the head
 * of each source rather than one whole source is deliberate: a brief that
 * describes one of five sources in detail is worse than one that describes all
 * five in outline, and the head of a document is where its subject usually is.
 */
const CHARS_PER_SOURCE = 2_000
const MAX_SOURCES = 12

export interface BriefResult {
  readonly briefId: string
  readonly body: string
  readonly sourcesUsed: number
  readonly model: string
  readonly skipped: string | null
}

export class NoSourcesError extends Error {
  constructor(readonly projectId: string) {
    super(`project ${projectId} has no cached sources to brief from`)
    this.name = 'NoSourcesError'
  }
}

interface CachedSource {
  readonly title: string
  readonly fingerprint: string
  readonly excerpt: string
  readonly chars: number
}

/** Read what the sync has already cached. No Notebook call. */
export const cachedSources = async (
  db: SqlExecutor,
  projectId: string,
): Promise<readonly CachedSource[]> => {
  const { rows } = await db.execute(`
    select coalesce(title, 'untitled') as title,
           content_fingerprint,
           left(content, ${String(CHARS_PER_SOURCE)}) as excerpt,
           content_chars
    from public.documents
    where project_id = ${lit(projectId)}::uuid
      and content is not null
    order by content_chars desc
    limit ${String(MAX_SOURCES)}
  `)
  return rows.map((r) => ({
    title: String(r.title),
    fingerprint: String(r.content_fingerprint),
    excerpt: String(r.excerpt),
    chars: Number(r.content_chars),
  }))
}

/**
 * Has anything changed since the last brief?
 *
 * Compared by the set of source fingerprints, not by a timestamp. A ten-minute
 * cycle that re-briefed on every tick would spend inference to produce the
 * same paragraph 144 times a day; comparing content means a brief is
 * regenerated when the knowledge changed and not when the clock moved.
 */
export const briefIsStale = async (
  db: SqlExecutor,
  projectId: string,
  currentFingerprints: readonly string[],
): Promise<boolean> => {
  const { rows } = await db.execute(`
    select source_fingerprints::text as fps
    from public.project_briefs
    where project_id = ${lit(projectId)}::uuid
    order by generated_at desc limit 1
  `)
  if (rows.length === 0) return true

  // Postgres renders a text[] as {a,b,c}. Parsed rather than compared as a
  // string because array ordering is not guaranteed to match ours.
  const previous = new Set(
    String(rows[0]?.fps ?? '{}')
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((s) => s.replace(/^"|"$/g, ''))
      .filter((s) => s !== ''),
  )
  const current = new Set(currentFingerprints)
  if (previous.size !== current.size) return true
  for (const fp of current) if (!previous.has(fp)) return true
  return false
}

const PROMPT_HEADER =
  'You are writing a short orientation brief about a project, for someone who ' +
  'has not read its source material.\n\n' +
  'Write 3 short paragraphs of plain prose:\n' +
  '1. What this project is about.\n' +
  '2. What the sources actually cover, and what they disagree on if anything.\n' +
  '3. What is conspicuously missing, if anything.\n\n' +
  'Rules: no preamble, no headings, no bullet points, no meta-commentary about ' +
  'being an AI or about the sources being excerpts. If the sources are too thin ' +
  'to support a claim, say so plainly rather than padding.\n\n'

/**
 * Generate and store a brief.
 *
 * Skips rather than throws when nothing has changed: the caller is a
 * ten-minute cron, and "nothing to do" is the common case rather than an
 * exceptional one.
 */
export const generateBrief = async (
  db: SqlExecutor,
  router: ProviderRouter,
  projectId: string,
  options: { force?: boolean } = {},
): Promise<BriefResult> => {
  const sources = await cachedSources(db, projectId)
  if (sources.length === 0) throw new NoSourcesError(projectId)

  const fingerprints = sources.map((s) => s.fingerprint)
  if (options.force !== true && !(await briefIsStale(db, projectId, fingerprints))) {
    return {
      briefId: '',
      body: '',
      sourcesUsed: sources.length,
      model: '',
      skipped: 'the sources are unchanged since the last brief',
    }
  }

  const project = await db.execute(`
    select name from public.projects where project_id = ${lit(projectId)}::uuid
  `)
  const name = String(project.rows[0]?.name ?? 'this project')

  const body =
    `${PROMPT_HEADER}Project: ${name}\n\n` +
    sources
      .map(
        (s, i) =>
          `--- source ${String(i + 1)}: ${s.title} (${String(s.chars)} chars, excerpt) ---\n${s.excerpt}`,
      )
      .join('\n\n')

  /*
    No `jobId`, deliberately (#268).

    Every other caller of `complete` in `src/` attributes its call so it lands
    under a job KIND in `public.model_record`. This one has no job to name:
    `generateBrief` is reached only from `scripts/projects/brief.ts`, which a
    person runs. Inventing a job for it would put harness traffic into a
    measurement, which is what 0395 was written to undo.

    So the call is counted under `(unattributed)`, which is true.
  */
  const completion = await router.complete({
    messages: [{ role: 'user', content: body }],
    // Generous, because free models on this tier are reasoning models and
    // reasoning tokens come out of the completion budget — a small limit
    // returns an empty completion, which the router raises rather than
    // silently returning as blank text.
    maxTokens: 2_000,
  })

  const text = scrub(completion.content)
  // The database CHECK requires 50 characters. Failing here with a clear
  // message beats a constraint violation that names a column.
  if (text.length < 50) {
    throw new EmptyCompletionError(completion.model, 'too short to be a brief', 0)
  }

  const { rows } = await db.execute(`
    insert into public.project_briefs
      (project_id, body, sources_used, source_fingerprints, model, confidence)
    values
      (${lit(projectId)}::uuid, ${lit(text)}, ${String(sources.length)},
       array[${fingerprints.map((f) => lit(f)).join(', ')}]::text[],
       ${lit(completion.model)},
       -- Inferred, never verified. See the note in this file's header.
       'inferred')
    returning brief_id::text as brief_id
  `)

  return {
    briefId: String(rows[0]?.brief_id),
    body: text,
    sourcesUsed: sources.length,
    model: completion.model,
    skipped: null,
  }
}
