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
 * So it is `notion.project_slug` in `system_config`, unset by default, and
 * this handler says so in a sentence rather than guessing. A duty that reports
 * "tell me where these should go" every hour is mildly annoying; a duty that
 * picks for him is a mess to undo.
 *
 * ## What happens the first time it runs
 *
 * Nothing convenes. 0107's arrival trigger ignores the first documents of a
 * project — *"attaching a notebook with forty pages in it is an import; the
 * fortieth page is not an event"* — so a first sync of twenty pages is an
 * import, and the twenty-first page later is news. That is the behaviour that
 * makes this safe to switch on unattended.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotionClient } from '../notion/api.ts'
import { syncNotion } from '../notion/sync.ts'
import { count, list } from '../text/plain.ts'

export function notionSyncHandler(db: SqlExecutor): Handler {
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
            (select value #>> '{}' from public.system_config
              where key = 'notion.project_slug') as slug,
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
        slug?: string | null
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
        } satisfies HandlerOutput
      }

      const token = String(settings.token ?? '')
      if (token === '') {
        return {
          ...base,
          body:
            'There is no Notion token in the vault, so the pages you have shared ' +
            'cannot be read.',
        } satisfies HandlerOutput
      }

      const slug = String(settings.slug ?? '')
      if (slug === '') {
        return {
          ...base,
          body:
            'Your Notion pages are shared and ready to read, and nobody has said ' +
            'which project they belong to.\n\n' +
            'Tell me the project and I will keep it up to date from then on — it is ' +
            'the `notion.project_slug` setting.',
        } satisfies HandlerOutput
      }

      const project = (
        await db.execute(`
          select project_id::text as id, name from public.projects
           where slug = '${slug.replace(/'/g, "''")}' and status = 'active'
        `)
      ).rows[0] as { id?: string; name?: string } | undefined

      if (project?.id === undefined) {
        return {
          ...base,
          body:
            `The project set for Notion pages, "${slug}", is not an active project. ` +
            'Nothing was read — pointing this at the wrong place is worse than ' +
            'pointing it nowhere.',
        } satisfies HandlerOutput
      }

      const result = await syncNotion(db, new NotionClient(token), project.id)

      const parts: string[] = []
      if (result.added > 0) parts.push(count(result.added, 'new page', 'new pages'))
      if (result.changed > 0) parts.push(count(result.changed, 'change', 'changes'))

      return {
        ...base,
        body:
          (parts.length === 0
            ? `Read through ${count(result.shared, 'shared page', 'shared pages')}. Nothing new.`
            : `${list(parts)} from ${count(result.shared, 'shared page', 'shared pages')}, ` +
              `filed under ${String(project.name)}.`) +
          // Named rather than counted. "3 skipped" tells him nothing he can act
          // on; the titles and reasons tell him whether it matters.
          (result.skipped.length === 0
            ? ''
            : `\n\n${count(result.skipped.length, 'page was', 'pages were')} left out: ` +
              `${result.skipped.slice(0, 4).join('; ')}.`),
      } satisfies HandlerOutput
    },
  }
}
