/**
 * Reading a source that just arrived.
 *
 * §22's scenario A opens with *"Grant adds a source to the Money Mastery
 * Notebook from his phone → detected within the sync interval → **Research
 * analyzes**"*, and until 0107 nothing joined those two clauses. The sync wrote
 * a `documents` row and stopped, 586 times.
 *
 * 0107's trigger makes the job. This makes the finding.
 *
 * ## Why Emma, and not the router's choice
 *
 * The router picks a roster from an INSTRUCTION — what Grant asked for decides
 * who is needed. Nobody asked for this: a document arrived and the system
 * noticed. §9 gives that to Research without ambiguity — *"gathers and weighs
 * evidence, tracks source provenance, and reports what the sources actually
 * support rather than what would be convenient"* — so the roster is recorded as
 * a decision with that reason rather than inferred from prose that does not
 * exist.
 *
 * It still goes through `recordDecision`, because that row is what the notifier
 * reads to choose a face (0103) and what `#the_floor` narrates. A job with no
 * decision is a job that arrives from nobody.
 *
 * ## What it must not do
 *
 * Summarise. A summary of a document Grant has just read himself is the least
 * useful thing this team could produce, and it is the thing a model will
 * produce by default. The prompt asks the one question worth a notification:
 * *what does this change?* — against the rest of the corpus, which is why the
 * retrieval runs at all.
 *
 * And it must be allowed to say "nothing". A source that confirms what we
 * already had is a real outcome, and a system that manufactures significance
 * from every arriving PDF teaches Grant to ignore it.
 */

import { recordDecision } from '../agents/router.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { contextBlock, retrieve, sourceRefs } from '../knowledge/retrieval.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { scrub } from '../text/scrub.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Enough of the document to judge it; the corpus excerpts carry the rest. */
const DOCUMENT_CHARS = 6_000

interface Doc {
  title: string | null
  content: string
  connector: string
  external_ref: string | null
  project_name: string | null
}

export function sourceHandler(deps: {
  readonly db: SqlExecutor
  readonly router: ProviderRouter
}): Handler {
  return {
    kind: 'knowledge.read_source',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const { rows } = await deps.db.execute(
        `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
      )
      const payload = ((rows[0] as { pinned_config?: Record<string, unknown> } | undefined)
        ?.pinned_config ?? {}) as { document_id?: string }
      const documentId = String(payload.document_id ?? '')
      if (documentId === '') throw new Error('no document to read')

      const found = await deps.db.execute(`
        select d.title, left(d.content, ${String(DOCUMENT_CHARS)}) as content,
               d.connector, d.external_ref, p.name as project_name
          from public.documents d
          left join public.projects p using (project_id)
         where d.document_id = ${lit(documentId)}::uuid
      `)
      const doc = found.rows[0] as Doc | undefined
      if (doc === undefined) {
        // Deleted between the trigger firing and the worker picking it up.
        // Not a failure: the right outcome is to stop, and to say why.
        throw new Error('that source is no longer in the corpus')
      }

      const who = (
        await deps.db.execute(`
          select name, title, communication_style, responsibilities
            from public.staff where slug = 'research-director' and active
        `)
      ).rows[0] as
        | {
            name: string
            title: string
            communication_style: string | null
            responsibilities: string | null
          }
        | undefined
      if (who === undefined) throw new Error('there is no active Research Director to read it')

      // What we already hold on this subject. The title is the query because it
      // is the one part of a document written to say what it is about — and a
      // full-text search seeded with six thousand characters of body matches
      // everything and ranks nothing.
      const hits = (
        await retrieve(deps.db, { jobId: job.jobId }, String(doc.title ?? ''), job.projectId, 6)
      ).filter((h) => h.documentId !== documentId)
      const context = contextBlock(hits)

      await recordDecision(deps.db, job.jobId, {
        // `light_investigation`, from §5's fixed vocabulary. Not 'research',
        // which is a role rather than an intent — and the compiler said so.
        // The distinction matters: this is the smallest class that justifies
        // convening anyone, which is exactly what an unrequested source
        // deserves.
        intent: 'light_investigation',
        confident: true,
        intentReason:
          'A source arrived in an established project. Nobody asked a question, so there is ' +
          'no intent to classify — reading what arrived IS the work.',
        searchTerms: [String(doc.title ?? '')],
        candidates: [],
        unroutedLiveJobs: 0,
        resolution: 'none_found',
        linkedJobId: null,
        distinctJustification: null,
        roster: ['research-director'],
        rosterReason:
          '§9 gives Research the weighing of evidence and the tracking of provenance. No ' +
          'other role is justified by a document simply arriving, and convening one would ' +
          'be a meeting nobody called.',
        clarificationNeeded: false,
      })

      const completion = await deps.router.complete({
        messages: [
          {
            role: 'system',
            content:
              `You are ${who.name}, ${who.title} on a small team. ` +
              (who.responsibilities === null ? '' : `Your remit: ${who.responsibilities} `) +
              (who.communication_style === null
                ? ''
                : `How you talk: ${who.communication_style} `) +
              'A new source has just landed in the project. Grant did not ask you anything — ' +
              'you are telling him it arrived and whether it matters.\n\n' +
              'Answer one question: WHAT DOES THIS CHANGE? Not what it says. If it confirms ' +
              'what we already had, say that plainly and stop — "nothing new here, it agrees ' +
              'with the pricing note" is a complete and useful answer, and inventing ' +
              'significance is worse than finding none. If it contradicts something we hold, ' +
              'lead with the contradiction.\n\n' +
              'Under 100 words, first person, no headings, no summary of ' +
              'the document. Never write "I hope this helps", "Here is a summary", "As an ' +
              'AI". Do not sign your name. ' +
              // #209, narrowed harder here than in the conversational handler
              // and deliberately so. This answers ONE question — what does
              // this change — and one answer is a sentence. The list case is
              // real but rare: a source that contradicts three things we hold
              // is three findings, and running them together is what makes a
              // notification unreadable. Same numbered form as everywhere
              // else, so the shape does not change per surface.
              'If it changes three or more separate things, number them "1. ", "2. ", "3. " ' +
              'one per line, so he can reply about one of them. Otherwise write prose.' +
              (context === ''
                ? ' We hold nothing else on this subject, so say that this is the first thing ' +
                  'we have on it.'
                : ' Numbered excerpts from what we already hold follow. Cite them as [1], [2].'),
          },
          ...(context === ''
            ? []
            : [{ role: 'system' as const, content: `What we already hold:\n\n${context}` }]),
          {
            role: 'user',
            content:
              `A source called “${String(doc.title ?? 'untitled')}” arrived in ` +
              `${String(doc.project_name ?? 'the project')} via ${doc.connector}.\n\n` +
              `${doc.content}`,
          },
        ],
        maxTokens: 2_000,
        correlationId: job.correlationId,
        jobId: job.jobId,
      })

      return {
        body: scrub(completion.content),
        // The document is in front of it; the comparison is a judgement.
        confidence: hits.length === 0 ? 'medium' : 'high',
        evidence: 'inferred',
        sources: [
          `${doc.connector}:${String(doc.external_ref ?? documentId)} ${String(doc.title ?? '')}`,
          ...sourceRefs(hits),
        ],
        contradictions: null,
        path: 'inference',
        model: completion.model,
      } satisfies HandlerOutput
    },
  }
}
