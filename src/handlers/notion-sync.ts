/**
 * Pull in the Notion pages Grant has shared, on a schedule.
 *
 * The connector works and is verified (`verify:notion`, 13/13). Nothing has
 * ever called it outside a verification run, so `documents` holds nine
 * notebook sources, one MCP page, and no Notion at all — while the Set up page
 * says *"Your own notes — 0 page(s) synced"* and offers "Share a page with the
 * integration", which Grant already did. Twenty items are shared and none of
 * them have been read.
 *
 * That is the same shape as `office.sync` before 0138 and the arrival trigger
 * before 0107: every segment works, nothing traverses it.
 *
 * ## The one thing it will not decide
 *
 * Which project the pages belong to. `syncNotion` takes a project id, and
 * choosing one is a filing decision about somebody's own notes — the wrong
 * choice puts his personal pages into a work project and starts the team
 * reading them.
 *
 * It used to be one global setting, `notion.project_slug`, which was wrong in
 * two ways at once. It could only ever name ONE project, and its name did not
 * describe what it held — Grant: *"Configuration and database fields must use
 * terminology that reflects what they actually reference."*
 *
 * The mapping belongs per project, and the place for it already existed:
 * a `project_attachments` row with `connector = 'notion'`. A project with a
 * Notion attachment is synced; a project without one is skipped rather than
 * guessed at. 0161 removed the global key.
 *
 * ## Teamspaces, and why none of this stores a teamspace id
 *
 * Grant's model is that a top-level Agentic project corresponds to a Notion
 * Teamspace, with Notion "Projects" as initiatives inside it. That is the
 * canonical hierarchy and it stays canonical — but Notion's public API exposes
 * no teamspace whatsoever: no endpoint, no field, and a database living in a
 * teamspace reports its parent as the workspace. Probed on both 2022-06-28 and
 * 2025-09-03 before this was designed.
 *
 * So the durable handles are the DATABASE ids in `project_attachments`, and the
 * teamspace is carried as a name on the project for the human mapping. A column
 * called `teamspace_id` would have repeated the exact mistake being fixed.
 *
 * ## What happens the first time it runs
 *
 * Nothing convenes. 0107's arrival trigger ignores the first documents of a
 * project — *"attaching a notebook with forty pages in it is an import; the
 * fortieth page is not an event"* — so a first sync of twenty pages is an
 * import, and the twenty-first page later is news. That is the behaviour that
 * makes this safe to switch on unattended.
 */

import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotionClient } from '../notion/api.ts'
import { syncNotion } from '../notion/sync.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count, list } from '../text/plain.ts'
import { sayAs } from '../text/voice.ts'

export function notionSyncHandler(db: SqlExecutor, router: ProviderRouter | null = null): Handler {
  return {
    kind: 'office.notion_sync',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      const settings = (
        await db.execute(`
          select
            -- knowledge_connectors, which is where §8's kill-switch actually
            -- lives for a connector. There is no notion.enabled in
            -- system_config and inventing one would have made a switch that
            -- looked real and turned nothing off.
            coalesce((select enabled from public.knowledge_connectors
              where connector = 'notion'), false) as enabled,
            (select disabled_reason from public.knowledge_connectors
              where connector = 'notion') as disabled_reason,
            (select decrypted_secret from vault.decrypted_secrets
              where name = 'notion.integration_token') as token
        `)
      ).rows[0] as {
        enabled?: boolean
        disabled_reason?: string | null
        token?: string | null
      }

      // §17's kill-switch first, as everywhere else.
      if (settings.enabled !== true) {
        return {
          ...base,
          body:
            'Notion is switched off, so nothing was read' +
            (settings.disabled_reason === null || settings.disabled_reason === undefined
              ? '.'
              : `: ${String(settings.disabled_reason)}`),
          announce: false,
        } satisfies HandlerOutput
      }

      const token = String(settings.token ?? '')
      if (token === '') {
        return {
          ...base,
          body:
            'There is no Notion token in the vault, so the pages you have shared ' +
            'cannot be read.',
          announce: true,
        } satisfies HandlerOutput
      }

      // Every project that has said where its Notion lives. Not one global
      // setting: a system with four top-level projects has four teamspaces, and
      // a single key could only ever name one of them.
      const attached = (
        await db.execute(`
          select distinct p.project_id::text as id, p.name
            from public.projects p
            join public.project_attachments a using (project_id)
           where p.status = 'active' and a.connector = 'notion' and a.enabled
           order by p.name
        `)
      ).rows as { id: string; name: string }[]

      if (attached.length === 0) {
        return {
          ...base,
          body:
            'Your Notion pages are shared and ready to read, and no project says ' +
            'which of them are its own.\n\n' +
            'Attach a Notion database to a project on the Projects page and I will ' +
            'keep it up to date from then on.',
          // Said once, where he will find it, rather than every two hours on two
          // surfaces. A question repeated hourly is not more likely to be
          // answered; it is less.
          announce: false,
        } satisfies HandlerOutput
      }

      // Summed across projects, because the duty runs once and reports once.
      const client = new NotionClient(token)
      const result = { added: 0, changed: 0, shared: 0, skipped: [] as string[] }
      const filed: string[] = []
      for (const project of attached) {
        const one = await syncNotion(db, client, project.id)
        result.added += one.added
        result.changed += one.changed
        result.shared += one.shared
        result.skipped.push(...one.skipped)
        if (one.added > 0 || one.changed > 0) filed.push(project.name)
      }
      const project = {
        name: filed.length > 0 ? filed.join(' and ') : attached.map((a) => a.name).join(' and '),
      }

      const parts: string[] = []
      if (result.added > 0) parts.push(count(result.added, 'new page', 'new pages'))
      if (result.changed > 0) parts.push(count(result.changed, 'change', 'changes'))

      const plain =
        (parts.length === 0
          ? `Read through ${count(result.shared, 'shared page', 'shared pages')}. Nothing new.`
          : `${list(parts)} from ${count(result.shared, 'shared page', 'shared pages')}, ` +
            `filed under ${String(project.name)}.`) +
        // Named rather than counted. "3 skipped" tells him nothing he can act
        // on; the titles and reasons tell him whether it matters.
        (result.skipped.length === 0
          ? ''
          : `\n\n${count(result.skipped.length, 'page was', 'pages were')} left out: ` +
            `${result.skipped.slice(0, 4).join('; ')}.`)

      const announce = parts.length > 0 || result.skipped.length > 0
      return {
        ...base,
        /*
          Read from the record (0489). This return spends a model whenever
          `announce` is true, and `base` claims `deterministic_retrieval` —
          which `enforce_deterministic_claim` refuses on any correlation that
          recorded an inference, so the output was discarded and the job
          FAILED. `office.sync` did exactly that twice, most recently 08:02 on
          18 September.

          Overridden here rather than in `base`: the OTHER returns in this
          handler are templated and the exemption is true for them, and losing
          it everywhere would send routine hourly output through quality
          review for nothing.
        */
        path: await howComposed(db, job.jobId),
        body: announce
          ? await sayAs(db, router, 'operations-director', {
              purpose:
                'Tell Grant what came in from his Notion pages. He writes notes ' +
                'there; this is you noticing them, not announcing a milestone.',
              facts: [
                `${String(result.shared)} page(s) are shared with the integration`,
                `${String(result.added)} were new`,
                `${String(result.changed)} had changed since last time`,
                `they are filed under the project "${String(project.name)}"`,
                ...(result.skipped.length === 0
                  ? []
                  : [`these were left out: ${result.skipped.slice(0, 4).join('; ')}`]),
              ],
              fallback: plain,
              // #268: attributed, so the call lands under this job KIND rather than under (unattributed).
              job: { jobId: job.jobId, correlationId: job.correlationId },
              words: 50,
            })
          : plain,
        announce,
      } satisfies HandlerOutput
    },
  }
}
