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
import { credentialSql } from '../credentials/deployment.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotionApiError, NotionClient } from '../notion/api.ts'
import { listShared, syncNotion } from '../notion/sync.ts'
import { currentPerson } from '../office/person.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count, list } from '../text/plain.ts'
import { sayAs } from '../text/voice.ts'

/**
 * What is said when Notion refuses the sync for a reason retrying cannot change. Composed in code, never by a model:
 * the moment an integration fails is when a model is least trustworthy to word things, and a reworded notice defeats
 * the once-a-day dedupe. The wording follows Grant's rules for incident notices: what happened to HIM first, what still
 * works, then what to do, and never "press" something that is not there.
 */
export const refusedNotice = (
  error: NotionApiError,
): Pick<HandlerOutput, 'body' | 'announce' | 'topic'> =>
  error.kind === 'auth'
    ? {
        body:
          'Notion has stopped accepting the connection I use to read your notes, so I cannot sync your pages right now.\n\n' +
          'What this affects: new and changed Notion pages will not show up in Team HQ until it is fixed.\n' +
          'What still works: everything already saved, including the Notion pages I had already read.\n\n' +
          'What to do: open Team HQ, go to Settings, then Setting up, and connect Notion again.',
        announce: true,
        topic: 'notion.token_refused',
      }
    : {
        body:
          `Notion turned down my request to read your pages (HTTP ${String(error.status)}), and trying again will not change that, so nothing was synced.\n\n` +
          'What still works: everything already saved. I will try again at the next sync.',
        announce: true,
        topic: 'notion.sync_refused',
      }

/**
 * How long one run may keep reading Notion. The edge worker stops STARTING jobs at 60 s into its pass and is killed well
 * after 150 s, so a job begun at the last moment has to finish inside that: 60 s of reading plus one in-flight request
 * (20 s at most) plus the writes is under the limit with room to spare.
 */
export const RUN_BUDGET_MS = 60_000

export interface NotionSyncOptions {
  readonly runBudgetMs?: number
  /** Milliseconds, monotonic enough for a budget. A test passes its own. */
  readonly clock?: () => number
}

export function notionSyncHandler(
  db: SqlExecutor,
  router: ProviderRouter | null = null,
  options: NotionSyncOptions = {},
): Handler {
  const runBudgetMs = options.runBudgetMs ?? RUN_BUDGET_MS
  const clock = options.clock ?? Date.now
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
            ${credentialSql('notion.integration_token')} as token
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
           where p.office_id = app.job_office('${job.jobId}'::uuid)
             and p.status = 'active' and a.connector = 'notion' and a.enabled
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
      const result = { added: 0, changed: 0, shared: 0, skipped: [] as string[], deferred: 0 }
      const filed: string[] = []
      /*
        BOUNDED BY CONSTRUCTION. The edge worker has a wall-clock limit and only declines to START a job past its deadline,
        so a run with no bound of its own could outlive the host, die mid-run and be retried into the same crawl until five
        attempts were spent. The workspace is listed ONCE for all the projects (it used to be listed, and every page's block
        tree fetched, once per attached project), and the whole run reads for at most `runBudgetMs`. What it did not reach
        is read first next time: finished pages are skipped while Notion says they are unedited, so progress is the
        documents themselves and needs no cursor to lose.
      */
      const startedAt = clock()
      const budget = { expired: () => clock() - startedAt >= runBudgetMs }
      try {
        const shared = await listShared(client)
        for (const project of attached) {
          if (budget.expired()) {
            result.deferred += shared.length
            continue
          }
          const one = await syncNotion(db, { jobId: job.jobId }, client, project.id, {
            shared,
            budget,
          })
          result.added += one.added
          result.changed += one.changed
          result.shared += one.shared
          result.skipped.push(...one.skipped)
          result.deferred += one.deferred
          if (one.added > 0 || one.changed > 0) filed.push(project.name)
        }
      } catch (error) {
        /*
          A refusal that no retry can change is REPORTED, not thrown (M2).

          A revoked or removed integration (401) and a request Notion will never accept (a 4xx, as an API-version
          drift produces) were thrown from here, so each run retried the same doomed call to the job's attempt
          ceiling, failed, wrote an impediment nobody reads and said nothing to anybody; two hours later the duty fired
          again, for ever. A duty that cannot work says so, once a day (topic, so `app.say_once` holds the repeats),
          and completes. Anything TRANSIENT (429, 5xx, a timeout, a malformed reply) still throws, because the next
          attempt can succeed.
        */
        if (error instanceof NotionApiError && error.kind !== 'transient') {
          return { ...base, ...refusedNotice(error) } satisfies HandlerOutput
        }
        throw error
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
            `${result.skipped.slice(0, 4).join('; ')}.`) +
        // Said in the run's own report so a partial pass is never mistaken for a complete one.
        (result.deferred === 0
          ? ''
          : `\n\n${count(result.deferred, 'page was', 'pages were')} not read this time (the run's time was spent); ` +
            'they come first at the next sync.')

      const announce = parts.length > 0 || result.skipped.length > 0
      /*
        THE BODY FIRST, AND THAT ORDER IS THE WHOLE FIX.

        0489 moved this return off `base`'s hardcoded
        `deterministic_retrieval` and onto `howComposed`, which counts the
        inferences recorded against the job's correlation. Correct question,
        asked one step too early: `path` and `body` were both properties of
        one object literal, and an object literal evaluates in SOURCE ORDER —
        so `howComposed` counted zero, answered `deterministic_retrieval`, and
        then `sayAs` on the next line spent a model and recorded one.

        By the time the output was inserted the correlation had an inference
        and `enforce_deterministic_claim` refused it, so the job FAILED. It
        failed every two hours from at least 17:54 to 23:55 on 18 September —
        twelve of the office's sixteen failures in a day — and Notion mirroring
        was silently not running. Nothing caught it: the fix was in the
        repository, the worker was deployed, and the defect was in the
        evaluation order of two lines that read correctly one after the other.

        Hoisting the body out of the literal makes the sequence what it always
        had to be: spend the model, THEN ask the record what was spent.
      */
      const body = announce
        ? await sayAs(db, router, 'operations-director', {
            purpose:
              `Tell ${currentPerson().name} what came in from their Notion pages. They write notes ` +
              'there; this is you noticing them, not announcing a milestone.',
            facts: [
              `${String(result.shared)} page(s) are shared with the integration`,
              `${String(result.added)} were new`,
              `${String(result.changed)} had changed since last time`,
              `they are filed under the project "${String(project.name)}"`,
              ...(result.skipped.length === 0
                ? []
                : [`these were left out: ${result.skipped.slice(0, 4).join('; ')}`]),
              ...(result.deferred === 0
                ? []
                : [`${String(result.deferred)} page(s) are still to be read at the next sync`]),
            ],
            fallback: plain,
            // #268: attributed, so the call lands under this job KIND rather than under (unattributed).
            job: { jobId: job.jobId, correlationId: job.correlationId },
            words: 50,
          })
        : plain

      return {
        ...base,
        // Asked AFTER the body, for the reason above.
        path: await howComposed(db, job.jobId),
        body,
        announce,
      } satisfies HandlerOutput
    },
  }
}
