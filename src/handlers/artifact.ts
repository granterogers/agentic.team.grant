/**
 * Request in, finished PDF out, through the channel that asked (#258).
 *
 * Grant asked the office to read a document, research the subject, produce a
 * beautifully illustrated PDF and send it back on Telegram, and was told the
 * office had no means. This is the means, and it is the whole chain rather
 * than the interesting part of it: retrieve, draft, render, VALIDATE, store,
 * deliver.
 *
 * ## The invariant that shapes every branch
 *
 *   > *"The office must never claim an artifact was created or delivered
 *   > unless canonical storage/delivery evidence says it was."*
 *
 * So there is no path through this handler that reports success without a
 * document id from `record_file_document`, and no path that renders a file
 * without putting it through `validatePdf` first. A failure at any step says
 * what failed and what survived — a report that was written and could not be
 * stored is not the same as one that was never written, and Grant can act on
 * the difference.
 *
 * ## Provider-independent, which the Issue asks for by name
 *
 * Nothing here knows which model answered. The router picks, `inference_usage`
 * records what it picked, and the pipeline below it — layout, validation,
 * storage, delivery — never sees a provider name. The one place a model is
 * involved is composing the report's CONTENT, and if no model is available the
 * handler says so rather than producing an empty document.
 *
 * ## Structure from a model, guarded hard
 *
 * The model returns the report as JSON blocks. That is the same bargain
 * `extract-tasks` makes and it carries the same risk, so `readReport` is
 * exported and tested without a model: every block is validated, anything
 * unrecognised is dropped rather than rendered as a guess, and a reply that
 * parses to nothing is a failure rather than an empty PDF with a cover on it.
 */

import { howComposed } from '../agents/provenance.ts'
import { applyDesign, type Design, designBrief, effectiveStyle } from '../artifacts/design.ts'
import { type FetchLogoBytes, loadLogo, storageFetcher } from '../artifacts/logo.ts'
import { type Block, coverTakes, type Report, renderReport } from '../artifacts/report.ts'
import { resolveSourceDocument, revisesEarlier, sourcePhrase } from '../artifacts/source.ts'
import { filenameFor, storeArtifact } from '../artifacts/store.ts'
import { loadResolvedStyle, type StyleProfile, styleSnapshot } from '../artifacts/style.ts'
import { validatePdf } from '../artifacts/validate.ts'
import {
  madeHead,
  provenanceOf,
  recordProvenance,
  reviseMade,
  styleHash,
  styleUpdatedAt,
  versionNote,
} from '../artifacts/versions.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { runSteps } from '../jobs/checkpoint.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import {
  citedSource,
  contextBlock,
  correspondence,
  type Hit,
  type MailCoverage,
  mailBlock,
  retrieve,
} from '../knowledge/retrieval.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { scrub } from '../text/scrub.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface ArtifactDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter | null
  readonly projectRef: string
  readonly serviceKey: string
  /** How a logo's bytes are had. Tests inject a fixture; production reads the project's storage. */
  readonly fetchLogoBytes?: FetchLogoBytes
}

/** More than this is a model padding, not a report. */
const MOST_BLOCKS = 60

/**
 * What the model proposed, kept only where it is renderable.
 *
 * Exported and tested without a model or a database, because this is the
 * whole of the risk: every surviving block is drawn onto a page Grant
 * receives, and a block with a missing field is a hole in a document rather
 * than an exception somebody sees.
 */
export function readReport(
  text: string,
): { title: string; blocks: Block[]; design?: unknown } | null {
  const cleaned = scrub(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: { title?: unknown; blocks?: unknown; design?: unknown }
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      title?: unknown
      blocks?: unknown
      design?: unknown
    }
  } catch {
    return null
  }
  const title = String(parsed.title ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  /*
    Truncated at a WORD, and it says it was.

    The first real report the office wrote ended a table cell "client
    independe", because the cap cut mid-word — which is precisely the clipped
    content #258 forbids, arriving through the guard rather than through the
    layout. A cell that stops at a word with an ellipsis reads as a summary; a
    cell that stops mid-word reads as a bug, and it was one.
  */
  const words = (v: unknown, cap: number): string => {
    const all = String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (all.length <= cap) return all
    const cut = all.slice(0, cap)
    const lastSpace = cut.lastIndexOf(' ')
    return `${(lastSpace > cap * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '')}\u2026`
  }
  const list = (v: unknown, cap: number): string[] =>
    (Array.isArray(v) ? v : [])
      .map((x) => words(x, cap))
      .filter((x) => x !== '')
      .slice(0, 20)

  const blocks = (Array.isArray(parsed.blocks) ? parsed.blocks : [])
    .map((raw): Block | null => {
      const b = raw as Record<string, unknown>
      switch (String(b.kind ?? '')) {
        case 'heading': {
          const text_ = words(b.text, 120)
          if (text_ === '') return null
          return { kind: 'heading', level: b.level === 2 ? 2 : 1, text: text_ }
        }
        case 'paragraph': {
          const text_ = words(b.text, 2_400)
          if (text_ === '') return null
          return { kind: 'paragraph', text: text_, ...(b.lead === true ? { lead: true } : {}) }
        }
        case 'bullets':
        case 'numbers': {
          const items = list(b.items, 600)
          if (items.length === 0) return null
          return { kind: b.kind === 'numbers' ? 'numbers' : 'bullets', items }
        }
        case 'quote': {
          const text_ = words(b.text, 800)
          if (text_ === '') return null
          const who = words(b.attribution, 120)
          return { kind: 'quote', text: text_, ...(who === '' ? {} : { attribution: who }) }
        }
        case 'table': {
          const columns = list(b.columns, 60).slice(0, 6)
          const rows = (Array.isArray(b.rows) ? b.rows : [])
            .map((r) => list(r, 320).slice(0, columns.length))
            /*
              A row with fewer cells than the table has columns renders as a
              gap nobody can explain, so it is padded rather than dropped: the
              row is data the model found and the missing cell is what it did
              not find.
            */
            .map((r) => [...r, ...Array.from({ length: columns.length - r.length }, () => '')])
            .filter((r) => r.some((c) => c !== ''))
            .slice(0, 40)
          if (columns.length < 2 || rows.length === 0) return null
          const caption = words(b.caption, 200)
          return { kind: 'table', columns, rows, ...(caption === '' ? {} : { caption }) }
        }
        case 'chart': {
          const bars = (Array.isArray(b.bars) ? b.bars : [])
            .map((x) => {
              const bar = x as Record<string, unknown>
              const label = words(bar.label, 60)
              const value = Number(bar.value)
              // A bar with no number is not a bar. Rendering it as zero would
              // put a chart in front of Grant asserting something nobody said.
              return label === '' || !Number.isFinite(value) ? null : { label, value }
            })
            .filter((x): x is { label: string; value: number } => x !== null)
            .slice(0, 12)
          const title_ = words(b.title, 120)
          if (bars.length < 2 || title_ === '') return null
          const caption = words(b.caption, 200)
          return { kind: 'chart', title: title_, bars, ...(caption === '' ? {} : { caption }) }
        }
        default:
          return null
      }
    })
    .filter((b): b is Block => b !== null)
    .slice(0, MOST_BLOCKS)

  if (title === '' || blocks.length === 0) return null
  // A design SUGGESTION, kept raw: `designBrief` validates it against what the renderer can draw.
  return { blocks, ...(parsed.design === undefined ? {} : { design: parsed.design }), title }
}

const BRIEF =
  'You write the office’s reports. Reply with JSON only — no preamble, no code ' +
  'fence, no commentary.\n\n' +
  'Shape: {"title":"...","blocks":[ ... ]}\n\n' +
  'A block is one of:\n' +
  '  {"kind":"heading","level":1|2,"text":"..."}\n' +
  '  {"kind":"paragraph","text":"...","lead":true}   (lead only for the opening summary)\n' +
  '  {"kind":"bullets","items":["...","..."]}\n' +
  '  {"kind":"numbers","items":["...","..."]}\n' +
  '  {"kind":"quote","text":"...","attribution":"..."}\n' +
  '  {"kind":"table","columns":["..."],"rows":[["..."]],"caption":"..."}\n' +
  '  {"kind":"chart","title":"...","bars":[{"label":"...","value":3}],"caption":"..."}\n\n' +
  'Optionally add "design":{"title_page":"band"|"standard","density":"comfortable"|"compact","charts":true|false} ' +
  'if you have a view; anything else in it is ignored, and the house style outranks it.\n\n' +
  'Write for a person who will read this on paper. Open with one lead paragraph ' +
  'saying where things stand. Use a table when you are comparing things and a ' +
  'chart when you are counting them — never for decoration, and never with ' +
  'numbers the material does not contain. Between eight and thirty blocks.\n\n' +
  'Use ONLY what the material below says. Where it does not answer something, ' +
  'write that it does not, in the report, rather than filling the gap. Do not ' +
  'invent a figure, a date, a name or a quotation. A short honest report is ' +
  'worth more than a long invented one.'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Documents named by id - the resolved source, or the sources an earlier version cited - as hits, in the order given.
 * Only documents with text are returned: a source that holds none cannot be read from, and the caller says so.
 */
async function explicitHits(
  db: SqlExecutor,
  jobId: string,
  ids: readonly string[],
): Promise<readonly Hit[]> {
  if (ids.length === 0) return []
  const { rows } = await db.execute(
    `select d.document_id::text as id, d.title, d.connector, d.origin, d.content
       from public.documents d
      where d.office_id = app.job_office(${lit(jobId)}::uuid)
        and d.document_id = any (array[${ids.map((i) => `${lit(i)}::uuid`).join(',')}])
        and coalesce(d.content_chars, 0) > 0`,
  )
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  return ids.flatMap((id, index): Hit[] => {
    const r = byId.get(id)
    if (r === undefined) return []
    return [
      {
        connector: typeof r.connector === 'string' ? r.connector : null,
        documentId: id,
        excerpt: String(r.content ?? '').slice(0, 30_000),
        origin: String(r.origin ?? 'source'),
        rank: 1_000 - index,
        title: String(r.title ?? ''),
      },
    ]
  })
}

/**
 * The renderer's inputs, decided once from the draft: the blocks with the design applied, and the style with the
 * design's choices laid over it. Deterministic - called again on a resume it gives the same answer.
 */
export function compose(
  draft: { readonly blocks: readonly Block[]; readonly design?: unknown },
  style: StyleProfile | null,
): { blocks: Block[]; style: StyleProfile; design: Design } {
  const design = designBrief({ blocks: draft.blocks, proposal: draft.design, style })
  return {
    blocks: applyDesign(draft.blocks, design.choice),
    design,
    style: effectiveStyle(style, design.choice),
  }
}

/** The question the office asks instead of guessing which document was meant. Never names a file it did not find. */
export function askWhich(
  phrase: string,
  status: string,
  candidates: readonly { title: string }[],
): string {
  const list = candidates.map((c, i) => `${String(i + 1)}. ${c.title}`).join('\n')
  if (status === 'unreadable') {
    return (
      `I found "${candidates[0]?.title ?? phrase}" for "${phrase}", but I hold no text from it, so I cannot ` +
      'write a report from it yet. Nothing was created. Ask me to read it in, or point me at another document.'
    )
  }
  if (candidates.length === 0) {
    return (
      `I could not find a document matching "${phrase}" in this project, and nothing was created. ` +
      'Tell me which document you mean, or attach it, and I will start.'
    )
  }
  return (
    (status === 'ambiguous'
      ? `More than one document could be "${phrase}". `
      : `Nothing in this project matched "${phrase}" exactly. `) +
    `Which one do you want turned into a PDF?\n${list}\nNothing was created yet.`
  )
}

export function artifactHandler(deps: ArtifactDeps): Handler {
  const { db, router } = deps
  return {
    kind: 'artifact.report',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        announce: true,
        confidence: 'medium' as const,
        contradictions: null,
        evidence: 'inferred' as const,
        model: null,
        path: 'inference' as const,
        sources: [] as readonly string[],
      }
      const say = (body: string): HandlerOutput => ({ ...base, body }) satisfies HandlerOutput

      if (job.projectId === null || job.projectId === undefined) {
        return say(
          'I need to know which project the report is about before I can write one. ' +
            'Say which, and I will start it.',
        )
      }
      if (router === null) {
        return say(
          'I cannot write a report just now — the office has no model to think with. ' +
            'Nothing was created.',
        )
      }

      // raw-sql[2]: keyed by the claimed job; it reads the payload of the job the worker holds.
      const payload = (
        (
          await db.execute(
            `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown> } | undefined
      )?.pinned_config
      const brief = String(payload?.brief ?? payload?.instruction ?? '').trim()
      /*
        Captured once, because a closure loses the narrowing.

        `job.projectId` is `string | null` and the guard above proves it is
        not null — but the step closures below run later, so TypeScript has to
        be told again. A const says it once rather than a non-null assertion
        saying it four times.
      */
      const projectId: string = job.projectId
      // The house style (0923): the office's, with this project's fields over it. Fails open to the default look.
      const resolvedStyle = await loadResolvedStyle(db, job.jobId, projectId)
      const style = resolvedStyle.profile
      const where = (
        await db.execute(
          `select app.job_office(${lit(job.jobId)}::uuid)::text as office,
                  (select p.slug from public.projects p
                    where p.project_id = ${lit(projectId)}::uuid
                      and p.office_id = app.job_office(${lit(job.jobId)}::uuid)) as slug`,
        )
      ).rows[0] as { office?: string; slug?: string } | undefined
      const office = String(where?.office ?? '')
      const projectSlug = String(where?.slug ?? '')
      /*
        The style's logo, as bytes, or the reason it is not here. Loaded once: both renders (the stored file and the
        re-render for delivery) draw the same logo. Never fails the report.
      */
      const assets = await loadLogo(
        db,
        { office },
        style,
        deps.fetchLogoBytes ?? storageFetcher(deps.projectRef, deps.serviceKey),
      )

      /*
        Run as checkpointed steps (#263).

        Three of them, and the middle one is why: drafting spends a model call
        over eight documents, and a worker restart, a deployment or a 150-second
        wall clock between drafting and storing would otherwise buy it twice.
        With a checkpoint the second attempt reads the draft back and goes
        straight to rendering.

        Each step declares what it does OUTSIDE the office before it does it,
        because that declaration is what a later attempt reads:

          gather  none  -- two reads
          draft   none  -- a model call, expensive and repeatable
          store   local -- writes bytes and a row, and BOTH are idempotent:
                           the storage path is keyed on this job id with
                           upsert, and `record_file_document` returns the
                           existing row for a path it already has. Calling it
                           `external` would park a job that is perfectly safe
                           to retry, which is the cautious mistake rather than
                           the free one.

        Rendering is not a step. It is deterministic from the draft and takes
        milliseconds, so checkpointing it would store a megabyte to save
        nothing.
      */
      const run = await runSteps(
        db,
        job.jobId,
        'artifact.report@1',
        [
          {
            name: 'gather',
            run: async () => {
              /*
                Which document is meant, decided before any search. A named source ("the latest customer research
                report") is resolved over the project's logical documents; when it cannot be, the job ASKS rather
                than writing a beautiful PDF of the wrong one. A revision names the earlier version it revises.
              */
              const phrase = sourcePhrase(brief)
              let source: { id: string; title: string } | null = null
              let ask: {
                phrase: string
                status: string
                candidates: { id: string; title: string }[]
              } | null = null
              if (phrase !== null) {
                const res = await resolveSourceDocument(db, {
                  office,
                  phrase,
                  project: projectSlug,
                }).catch(() => null)
                if (res?.status === 'resolved') {
                  source = { id: res.document.id, title: res.document.title }
                } else if (res !== null) {
                  ask = {
                    candidates: res.candidates.map((c) => ({ id: c.id, title: c.title })),
                    phrase,
                    status: res.status,
                  }
                }
              }
              const head = revisesEarlier(brief)
                ? await madeHead(db, { office, projectId }).catch(() => null)
                : null
              const prior =
                head === null
                  ? null
                  : await provenanceOf(db, { documentId: head.documentId, office }).catch(
                      () => null,
                    )
              const priorIds =
                source === null && prior !== null
                  ? prior.sources.flatMap((x) => UUID.exec(x.ref)?.[0] ?? [])
                  : []
              const explicit = await explicitHits(db, job.jobId, [
                ...(source === null ? [] : [source.id]),
                ...priorIds,
              ])
              if (source !== null && explicit.length === 0 && ask === null) {
                ask = {
                  candidates: [{ id: source.id, title: source.title }],
                  phrase: phrase ?? '',
                  status: 'unreadable',
                }
              }
              const rest = await retrieve(db, { jobId: job.jobId }, brief, projectId, 8)
              const have = new Set(explicit.map((h) => h.documentId))
              const found = [...explicit, ...rest.filter((h) => !have.has(h.documentId))]
              const post = await correspondence(db, { jobId: job.jobId }, projectId, brief, 4)
              // raw-sql[2]: reads the address of documents this job's own retrieval just returned, scoped by the claimed job's office.
              const browsed = found
                .filter((h) => h.connector === 'browser')
                .map((h) => h.documentId)
              const urls = new Map<string, string>(
                browsed.length === 0
                  ? []
                  : (
                      (
                        await db.execute(
                          `select d.document_id::text as id, d.external_ref as url
                             from public.documents d
                            where d.document_id in (${browsed.map((i) => `'${i}'::uuid`).join(',')})
                              and d.office_id = app.job_office('${job.jobId}'::uuid)
                              and d.connector = 'browser' and d.external_ref is not null`,
                        )
                      ).rows as { id: string; url: string }[]
                    ).map((r) => [r.id, r.url]),
              )
              return {
                outcome: {
                  ask,
                  revises:
                    head === null
                      ? null
                      : {
                          id: head.documentId,
                          state: head.state,
                          title: head.title,
                          version: head.version,
                        },
                  explicitIds: explicit.map((h) => h.documentId),
                  source,
                  /*
                  References, not contents. The Issue asks for "safe tool
                  inputs/outputs or references to them" and a document's text
                  is the one thing here that is already stored elsewhere under
                  its own id — copying it into a checkpoint would put the same
                  bytes in two places and make the row enormous.
                */
                  documents: found.map((h) => ({
                    connector: h.connector,
                    id: h.documentId,
                    // Where a web page lives, so the sources page says so (see citedSource).
                    url: urls.get(h.documentId) ?? null,
                    // Carried so the citation can say `made` where the office
                    // made it, rather than printing the word null on the
                    // sources page of a PDF Grant reads.
                    origin: h.origin,
                    title: h.title,
                  })),
                  mail: post.map((m) => ({ id: m.messageId, subject: m.subject })),
                },
              }
            },
          },
          {
            name: 'draft',
            run: async (done) => {
              if (done.gather?.ask !== null && done.gather?.ask !== undefined) {
                return { outcome: { asked: true } }
              }
              const documents = (done.gather?.documents ?? []) as {
                connector: string
                id: string
                title: string
              }[]
              const mail = (done.gather?.mail ?? []) as { id: string; subject: string }[]
              if (documents.length === 0 && mail.length === 0) {
                return {
                  outcome: { nothing: true },
                }
              }
              /*
              Re-read by id rather than carrying the text through the
              checkpoint. On a first run this is a second read of documents
              `gather` just had, which is a few milliseconds against a model
              call — and on a resume it is the only way the text is available
              at all.
            */
              const gathered_ = done.gather as
                | {
                    source?: { id: string; title: string } | null
                    revises?: { title: string; version: number } | null
                    explicitIds?: string[]
                  }
                | undefined
              const first = await explicitHits(db, job.jobId, gathered_?.explicitIds ?? [])
              const rest = await retrieve(db, { jobId: job.jobId }, brief, projectId, 8)
              const seen = new Set(first.map((h) => h.documentId))
              const hits = [...first, ...rest.filter((h) => !seen.has(h.documentId))]
              const post = await correspondence(db, { jobId: job.jobId }, projectId, brief, 4)
              /*
              WHAT THE OFFICE COULD NOT LOOK AT, not merely what it found.

              This call passed `post` alone for the life of the feature, so the
              coverage note never reached the prompt that WRITES A DOCUMENT --
              while `instruction.ts` has passed it since #172. Its comment
              there says what the gap costs: any "there is nothing in your
              email" the model produced was a claim about a search it had never
              been shown. Every project associates zero of the cached messages
              today, because `public.contacts` is empty and the contact tier is
              the strong one, so the no-hits branch is the only branch this
              path takes.
            */
              const cover =
                ((
                  await db
                    .execute(
                      `select app.mail_coverage(app.job_office(${lit(job.jobId)}::uuid), ${lit(projectId)}::uuid) as c`,
                    )
                    .catch(() => ({ rows: [] as Record<string, unknown>[] }))
                ).rows[0]?.c as MailCoverage | undefined) ?? null
              const completion = await router.complete({
                correlationId: job.correlationId,
                jobId: job.jobId,
                maxTokens: 6_000,
                messages: [
                  { content: BRIEF, role: 'system' },
                  {
                    content:
                      `What was asked for: ${brief}\n\n` +
                      (gathered_?.source
                        ? `The source document to turn into the report: "${gathered_.source.title}" ([1] below).\n\n`
                        : '') +
                      (gathered_?.revises
                        ? `This revises version ${String(gathered_.revises.version)} of "${gathered_.revises.title}": ` +
                          'keep its subject and apply the changes asked for.\n\n'
                        : '') +
                      `${contextBlock(hits, 40_000)}\n\n${mailBlock(post, cover)}`,
                    role: 'user',
                  },
                ],
              })
              const read = readReport(completion.content)
              return {
                outcome: {
                  blocks: read?.blocks ?? [],
                  design: read?.design ?? null,
                  model: completion.model,
                  title: read?.title ?? '',
                  unreadable: read === null,
                },
              }
            },
          },
          {
            name: 'store',
            effect: 'local',
            run: async (done) => {
              const draft = done.draft ?? {}
              if (draft.nothing === true || draft.unreadable === true || draft.asked === true) {
                return { outcome: { skipped: true } }
              }
              const sources = [
                ...(
                  (done.gather?.documents ?? []) as {
                    connector: string | null
                    id: string
                    origin?: string
                    title: string
                    url?: string | null
                  }[]
                ).map(citedSource),
                ...((done.gather?.mail ?? []) as { id: string; subject: string }[]).map((m) => ({
                  label: m.subject,
                  ref: `mail:${m.id}`,
                })),
              ]
              // Design is decided here by rule (design.ts); the model only proposed. Same inputs, same bytes.
              const composed = compose(
                { blocks: draft.blocks as Block[], design: draft.design },
                style,
              )
              const report: Report = {
                author: 'Agentic Team',
                blocks: composed.blocks,
                created: new Date(),
                sources,
                // The document's own opening, not the request that asked for it.
                // See `coverLine`: every report so far printed Grant's
                // instruction on its cover above two thirds of an empty page.
                subtitle: coverTakes(composed.blocks).line,
                title: String(draft.title ?? 'Report'),
              }
              const { bytes, problems, notes } = renderReport(report, composed.style, assets)
              const verdict = validatePdf(bytes, { layoutProblems: problems })
              if (!verdict.ok) {
                return { outcome: { failed: verdict.problems.slice(0, 2) } }
              }
              const kept = await storeArtifact(
                db,
                { projectRef: deps.projectRef, serviceKey: deps.serviceKey },
                {
                  bytes,
                  extension: 'pdf',
                  jobId: job.jobId,
                  mime: 'application/pdf',
                  producedBy: String(payload?.by ?? 'chief-of-staff'),
                  projectId,
                  title: report.title,
                },
              )
              if (!kept.ok) {
                return { outcome: { pages: verdict.pages, stored: false, why: kept.error } }
              }
              /*
                How it was made, kept: the job (documents.produced_by_job already holds it), the style in force (a
                hash, and when it last changed), the design chosen and the sources cited. A failure to record is
                said in the outcome and never fails the file - the PDF is stored and valid either way.
              */
              const hash = styleHash(style)
              const stamped = await styleUpdatedAt(db, { office, projectId })
              const provenanceProblem =
                kept.documentId === null
                  ? 'no document id'
                  : await recordProvenance(
                      db,
                      { documentId: kept.documentId, office },
                      {
                        design: { ...composed.design.choice, reasons: composed.design.reasons },
                        jobId: job.jobId,
                        sources,
                        styleHash: hash,
                        styleSnapshot: styleSnapshot(resolvedStyle.raw, composed.design.choice),
                        styleUpdatedAt: stamped,
                      },
                    ).catch((e: unknown) => String((e as Error).message))
              /*
                A revision is a NEW VERSION of the document it revises, not a second document. First creation is
                version 1 and needs no link. Idempotent on the new document, so a retry cannot make version 3.
              */
              const revises = (done.gather?.revises ?? null) as {
                id: string
                title: string
                version: number
              } | null
              let version = 1
              let versionProblem: string | null = null
              let versionPending = false
              if (revises !== null && kept.documentId !== null && revises.id !== kept.documentId) {
                const made = await reviseMade(
                  db,
                  { headId: revises.id, newId: kept.documentId, office },
                  versionNote({ instruction: brief, jobId: job.jobId, sources, styleHash: hash }),
                ).catch((e: unknown) => ({
                  already: false,
                  error: String((e as Error).message),
                  ok: false,
                  pending: false,
                  version: null,
                }))
                if (made.ok) {
                  version = made.version ?? revises.version + 1
                  versionPending = made.pending
                } else versionProblem = made.error
              }
              return {
                effectRef: `document:${kept.documentId ?? ''}`,
                outcome: {
                  design: composed.design.reasons,
                  documentId: kept.documentId,
                  provenanceProblem,
                  styleHash: hash,
                  logoNote: notes.find((x) => x.startsWith('the logo was not drawn')) ?? null,
                  version,
                  versionPending,
                  versionProblem,
                  revisedFrom: revises?.title ?? null,
                  pages: verdict.pages,
                  /*
                  AND WHERE THE BYTES ARE (#258).

                  The step's outcome is the only thing the composing code below
                  can read — a checkpointed step is re-read from the ledger on a
                  resume, so anything not in here is gone. `storeArtifact`
                  returns `path` and this outcome did not carry it, so
                  `kept.path` was `undefined` at the point `attachFile` is
                  built, the `storagePath` spread produced nothing, and Slack's
                  notifier took its honest-degradation branch EVERY TIME:
                  *"I could not make a link to it from here."*

                  Both halves were right alone. The notifier mints a link from a
                  path, the store returns one, and nothing carried it between
                  them — which is the shape this repository keeps paying for,
                  and the unit tests were green throughout because they hand
                  `storagePath` to the renderer directly.

                  Found by asking for a report in a real Slack channel and
                  reading what landed in the room.
                */
                  path: kept.path,
                  sources: sources.length,
                  stored: true,
                  title: report.title,
                },
              }
            },
          },
        ],
        job,
      )

      if (run.kind === 'paused') {
        /*
          A pause is an outcome, not a failure.

          Returned as an ordinary answer so the attempt is not burned and the
          job sits in `paused` with a reason a person can read, rather than
          retrying into `failed` while it waits.
        */
        return {
          ...base,
          announce: false,
          body:
            `I stopped part way through the report, at "${run.at}": ${run.pause.detail} ` +
            `${run.pause.resumeWhen}`,
          evidence: 'verified',
          path: await howComposed(deps.db, job.jobId),
        }
      }

      if (run.kind === 'stopped') {
        return {
          ...base,
          announce: true,
          body:
            `You asked me to stop, so I did, at "${run.at}". ` +
            'Everything I had already finished is recorded, so asking again carries on ' +
            'from there rather than starting over.',
          evidence: 'verified',
          path: await howComposed(deps.db, job.jobId),
        }
      }

      const gathered = run.outcomes.gather ?? {}
      const drafted = run.outcomes.draft ?? {}
      const kept = run.outcomes.store ?? {}

      if (typeof gathered.ask === 'object' && gathered.ask !== null) {
        const a = gathered.ask as {
          phrase: string
          status: string
          candidates: { title: string }[]
        }
        // Asked, not guessed: no file was made and none was stored.
        return say(askWhich(a.phrase, a.status, a.candidates))
      }
      if (drafted.nothing === true) {
        return say(
          'I have nothing read in on this project to write a report FROM. Attach a ' +
            'source or point me at a document and I will start. I have not made a file.',
        )
      }
      if (drafted.unreadable === true) {
        /*
          A reply that could not be read is not an empty report.

          Rendering a cover with nothing behind it would satisfy every check
          below and hand Grant a two-page PDF saying nothing, which is worse
          than the refusal he already got once.
        */
        return {
          ...base,
          body:
            'I drafted the report and could not turn what came back into a document. ' +
            'Nothing was created and nothing was sent. Ask again and I will retry.',
          model: String(drafted.model ?? '') || null,
        }
      }
      if (Array.isArray(kept.failed)) {
        return {
          ...base,
          body:
            'I wrote the report and the file it produced did not pass its own checks, so ' +
            `I have not sent it: ${(kept.failed as string[]).join('; ')}. Nothing was ` +
            'stored and nothing was delivered.',
          model: String(drafted.model ?? '') || null,
        }
      }
      if (kept.stored !== true) {
        /*
          Written, validated, and not kept. Said in exactly those words,
          because "I could not create the report" would be false and the
          difference tells Grant whether to ask again or to fix storage.
        */
        return {
          ...base,
          body:
            `I wrote “${String(drafted.title ?? 'the report')}” and could not store it: ` +
            `${String(kept.why ?? 'storage refused it')}. It is not in the project and I ` +
            'have not sent it, so ask again once that is fixed rather than assuming it is there.',
          model: String(drafted.model ?? '') || null,
        }
      }

      /*
        Re-rendered for the delivery, because bytes do not go in a checkpoint.

        On a first run this is the same milliseconds the step already spent; on
        a RESUME it is what lets a job that stored the file yesterday still
        attach it today without asking the model again. The alternative —
        reading the object back out of Storage — is a network round trip to
        recover something that is deterministic from the draft.
      */
      const recomposed = compose(
        { blocks: drafted.blocks as Block[], design: drafted.design },
        style,
      )
      const finalReport: Report = {
        author: 'Agentic Team',
        blocks: recomposed.blocks,
        created: new Date(),
        sources: [
          ...(
            (gathered.documents ?? []) as {
              connector: string | null
              id: string
              origin?: string
              title: string
              url?: string | null
            }[]
          ).map(citedSource),
          ...((gathered.mail ?? []) as { id: string; subject: string }[]).map((m) => ({
            label: m.subject,
            ref: `mail:${m.id}`,
          })),
        ],
        // As above — the cover says what the report found, never what was asked.
        subtitle: coverTakes(recomposed.blocks).line,
        title: String(drafted.title ?? 'Report'),
      }
      const again = renderReport(finalReport, recomposed.style, assets)
      const versionLine =
        typeof kept.revisedFrom === 'string'
          ? typeof kept.versionProblem === 'string'
            ? ` I could not link it as a new version of \u201c${kept.revisedFrom}\u201d (${kept.versionProblem}), so it is saved as a separate document.`
            : kept.versionPending === true
              ? ` It is version ${String(kept.version)} of \u201c${kept.revisedFrom}\u201d, saved as a draft: the approved version stays the current one until you approve this.`
              : ` It is version ${String(kept.version)} of \u201c${kept.revisedFrom}\u201d; the earlier version is kept in its history.`
          : ''

      return {
        ...base,
        /*
          The file rides on this message (#66's rule, one artifact later).

          `reply.ts` turns `attachFile` into one `sendDocument` with this
          sentence as its caption, so Grant gets one thing rather than a file
          and a message about the file.
        */
        attachFile: {
          bytes: again.bytes,
          filename: filenameFor(finalReport.title, 'pdf'),
          mime: 'application/pdf',
          /*
            And where it already is, for Slack (#258).

            `storeArtifact` put the bytes at this path before this message was
            composed, so the file exists whether or not any channel attaches
            it. Slack cannot take bytes — no `files:write` — and mints a signed
            link from this instead.
          */
          ...(typeof kept.path === 'string' && kept.path !== '' ? { storagePath: kept.path } : {}),
        },
        body:
          `${finalReport.title} — ${String(kept.pages)} pages, from ${String(
            finalReport.sources.length,
          )} source(s).${versionLine}${
            typeof kept.logoNote === 'string'
              ? ` The style asks for a logo and I left it off: ${kept.logoNote.replace(/^the logo was not drawn: /, '')}.`
              : ''
          } It is in the project’s documents as well, so you can open it ` +
          'from the dashboard or ask me to send it anywhere else.',
        evidence: 'verified',
        model: String(drafted.model ?? '') || null,
        sources: finalReport.sources.map((x) => `${x.ref} ${x.label}`),
      }
    },
  }
}
