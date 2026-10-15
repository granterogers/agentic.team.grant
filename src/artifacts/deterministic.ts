/**
 * When a document request is answered from the records and not drafted by a model.
 *
 * The correspondence summary (§19A) and the accommodation comparison (§19B) have fixed fields and must not have
 * their figures written by a model. So a request for either is answered from the records, deterministically, and the
 * model is not called for it. Everything else (a report, a brief, a one-pager) still goes through the drafting path.
 *
 * Recognised by the request's own words, the same way `artifactRequest` reads them: the document's name, not a
 * guess at the subject. A request that names neither falls through to the model, unchanged.
 */
import type { SqlExecutor } from '../db/executor.ts'
import { buildAccommodationReport } from './accommodation.ts'
import { buildCorrespondenceReport, loadCorrespondenceFacts } from './correspondence.ts'
import type { Block } from './report.ts'

export type DeterministicKind = 'correspondence' | 'accommodation'

export function deterministicKind(brief: string): DeterministicKind | null {
  if (/\bcorrespondence\s+summary\b/i.test(brief)) return 'correspondence'
  if (/\baccommodation\s+comparison\b/i.test(brief)) return 'accommodation'
  return null
}

/** The blocks and title for a deterministic request, or null when the request is not one of them. */
export async function deterministicDraft(
  db: SqlExecutor,
  jobId: string,
  project: string,
  brief: string,
  now: Date,
): Promise<{ kind: DeterministicKind; title: string; blocks: Block[] } | null> {
  const kind = deterministicKind(brief)
  if (kind === null) return null
  const { contacts, projectName } = await loadCorrespondenceFacts(db, jobId, project)
  const report =
    kind === 'correspondence'
      ? buildCorrespondenceReport(contacts, { name: projectName }, now)
      : buildAccommodationReport(contacts, { name: projectName }, now)
  return { kind, title: report.title, blocks: [...report.blocks] }
}
