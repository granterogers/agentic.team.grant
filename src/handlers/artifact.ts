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

import { type Block, type Report, renderReport } from '../artifacts/report.ts'
import { filenameFor, storeArtifact } from '../artifacts/store.ts'
import { validatePdf } from '../artifacts/validate.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import {
  contextBlock,
  correspondence,
  mailBlock,
  retrieve,
  sourceRefs,
} from '../knowledge/retrieval.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { scrub } from '../text/scrub.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface ArtifactDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter | null
  readonly projectRef: string
  readonly serviceKey: string
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
export function readReport(text: string): { title: string; blocks: Block[] } | null {
  const cleaned = scrub(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: { title?: unknown; blocks?: unknown }
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as { title?: unknown; blocks?: unknown }
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
  return { blocks, title }
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
  'Write for a person who will read this on paper. Open with one lead paragraph ' +
  'saying where things stand. Use a table when you are comparing things and a ' +
  'chart when you are counting them — never for decoration, and never with ' +
  'numbers the material does not contain. Between eight and thirty blocks.\n\n' +
  'Use ONLY what the material below says. Where it does not answer something, ' +
  'write that it does not, in the report, rather than filling the gap. Do not ' +
  'invent a figure, a date, a name or a quotation. A short honest report is ' +
  'worth more than a long invented one.'

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

      const payload = (
        (
          await db.execute(
            `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown> } | undefined
      )?.pinned_config
      const brief = String(payload?.brief ?? payload?.instruction ?? '').trim()

      /*
        The material, through the unified retrieval layer (#258's last section).

        Grant does not say whether the source is in NotebookLM, Notion, Drive
        or his mail, and should not have to: `retrieve` searches the project's
        index whatever fed it, and `correspondence` adds the messages that
        belong to the project. Two calls rather than one because a document and
        an email are different kinds of evidence and #172 keeps them apart on
        purpose.
      */
      const hits = await retrieve(db, brief, job.projectId, 8)
      const mail = await correspondence(db, job.projectId, brief, 4)
      if (hits.length === 0 && mail.length === 0) {
        return say(
          'I have nothing read in on this project to write a report FROM. Attach a ' +
            'source or point me at a document and I will start. I have not made a file.',
        )
      }

      const completion = await router.complete({
        correlationId: job.correlationId,
        jobId: job.jobId,
        maxTokens: 6_000,
        messages: [
          { content: BRIEF, role: 'system' },
          {
            content:
              `What was asked for: ${brief}\n\n` +
              `${contextBlock(hits, 40_000)}\n\n${mailBlock(mail)}`,
            role: 'user',
          },
        ],
      })

      const drafted = readReport(completion.content)
      if (drafted === null) {
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
          model: completion.model,
        }
      }

      const report: Report = {
        author: 'Agentic Team',
        blocks: drafted.blocks,
        created: new Date(),
        sources: [
          ...hits.map((h) => ({ label: h.title, ref: `${h.connector}:${h.documentId}` })),
          ...mail.map((m) => ({ label: m.subject, ref: `mail:${m.messageId}` })),
        ],
        subtitle: brief.slice(0, 400),
        title: drafted.title,
      }
      const { bytes, problems } = renderReport(report)
      const verdict = validatePdf(bytes, { layoutProblems: problems })
      if (!verdict.ok) {
        return {
          ...base,
          body:
            'I wrote the report and the file it produced did not pass its own checks, so ' +
            `I have not sent it: ${verdict.problems.slice(0, 2).join('; ')}. Nothing was ` +
            'stored and nothing was delivered.',
          model: completion.model,
        }
      }

      const stored = await storeArtifact(
        db,
        { projectRef: deps.projectRef, serviceKey: deps.serviceKey },
        {
          bytes,
          extension: 'pdf',
          jobId: job.jobId,
          mime: 'application/pdf',
          producedBy: String(payload?.by ?? 'chief-of-staff'),
          projectId: job.projectId,
          title: report.title,
        },
      )
      if (!stored.ok) {
        /*
          Written, validated, and not kept. Said in exactly those words,
          because "I could not create the report" would be false and the
          difference tells Grant whether to ask again or to fix storage.
        */
        return {
          ...base,
          body:
            `I wrote “${report.title}” — ${String(verdict.pages)} pages — and could ` +
            `not store it: ${String(stored.error)}. It is not in the project and I have not ` +
            'sent it, so ask again once that is fixed rather than assuming it is there.',
          model: completion.model,
        }
      }

      return {
        ...base,
        /*
          The file rides on this message (#66's rule, one artifact later).

          `reply.ts` turns `attachFile` into one `sendDocument` with this
          sentence as its caption, so Grant gets one thing rather than a file
          and a message about the file.
        */
        attachFile: {
          bytes,
          filename: filenameFor(report.title, 'pdf'),
          mime: 'application/pdf',
        },
        body:
          `${report.title} — ${String(verdict.pages)} pages, from ${String(
            report.sources.length,
          )} source(s). It is in the project’s documents as well, so you can open it ` +
          'from the dashboard or ask me to send it anywhere else.',
        evidence: 'verified',
        model: completion.model,
        sources: [...sourceRefs(hits), ...mail.map((m) => `mail:${m.messageId} ${m.subject}`)],
      }
    },
  }
}
