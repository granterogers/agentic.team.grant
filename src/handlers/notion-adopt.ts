/**
 * Wiring a project up to the Notion it already has.
 *
 * The office side of `connectRequest`. Grant said *"there is only one current
 * notion teamspace you have access to already… just work with what you have for
 * now"*, and nothing could act on it, because attaching a data source to a
 * project was a configuration change only a terminal could make.
 *
 * This is `scripts/notion/adopt.ts` as a job. The script stays — it is how a
 * person does it deliberately, and how this got debugged — but the office no
 * longer needs one.
 *
 * ## What it will and will not decide
 *
 * It matches the shared data sources by name against the roles a project needs:
 * Projects, Tasks, Docs. Where exactly one matches, it attaches. Where two
 * match — which is what happens with two teamspaces each holding a "Tasks" — it
 * attaches neither and says which ones it could not choose between, because
 * writing a curriculum into the wrong teamspace is silent and tedious to undo.
 *
 * It never creates anything in Notion. Adopting is pointing at what is already
 * there; if nothing is shared, the answer is a sentence about sharing it.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotionClient } from '../notion/api.ts'
import { listDataSources, schemaOf } from '../notion/structure.ts'
import { count } from '../text/plain.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Which shared database plays which role for a project. */
const WANTED = [
  { names: ['Projects'], kind: 'artifact' },
  { names: ['Tasks'], kind: 'task' },
  { names: ['Docs', 'Documents'], kind: 'document' },
] as const

export interface NotionAdoptDeps {
  readonly db: SqlExecutor
}

export function notionAdoptHandler(deps: NotionAdoptDeps): Handler {
  const { db } = deps
  return {
    kind: 'office.notion_adopt',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      if (job.projectId === null || job.projectId === undefined) {
        return {
          ...base,
          body: 'I do not know which project to wire up. Say which one and I will do it.',
          announce: true,
        } satisfies HandlerOutput
      }

      const setup = (
        await db.execute(`
          select
            (select decrypted_secret from vault.decrypted_secrets
              where name = 'notion.integration_token') as token,
            (select name from public.projects
              where project_id = ${lit(job.projectId)}::uuid) as project_name
        `)
      ).rows[0] as { token?: string | null; project_name?: string | null }

      const token = String(setup.token ?? '')
      if (token === '') {
        return {
          ...base,
          body: 'There is no Notion token in the vault, so there is nothing to attach to.',
          announce: true,
          severity: 'important',
        } satisfies HandlerOutput
      }

      const client = new NotionClient(token)
      const shared = await listDataSources(client)
      if (shared.length === 0) {
        return {
          ...base,
          body:
            'Nothing is shared with the Notion integration yet, so there is nowhere to ' +
            'attach. In Notion, open the database you want us to use, then Share → ' +
            'invite the Agentic integration.',
          announce: true,
        } satisfies HandlerOutput
      }

      const attached: string[] = []
      const unclear: string[] = []
      const absent: string[] = []

      for (const want of WANTED) {
        const matches = shared.filter((s) =>
          want.names.some((n) => s.title.toLowerCase() === n.toLowerCase()),
        )
        if (matches.length === 0) {
          absent.push(want.names[0])
          continue
        }
        if (matches.length > 1) {
          // Two teamspaces, two databases called Tasks, nothing to tell them
          // apart. Naming them is more use than picking one.
          unclear.push(`${String(matches.length)} called "${String(matches[0]?.title)}"`)
          continue
        }
        const only = matches[0]
        if (only === undefined) continue
        await db.execute(`
          insert into public.project_attachments
            (project_id, connector, external_ref, display_name, role, artifact_kind, ref_kind)
          values (${lit(job.projectId)}::uuid, 'notion', ${lit(only.id)},
                  ${lit(only.title)}, 'home', ${lit(want.kind)}, 'data_source')
          on conflict (project_id, connector, external_ref, role) do update
            set enabled = true, disabled_reason = null, updated_at = app.now_utc()
        `)
        attached.push(only.title)
      }

      if (attached.length > 0) {
        // The prompt asked for exactly this, so it stops asking.
        await db.execute(`
          delete from public.project_connector_choices
           where project_id = ${lit(job.projectId)}::uuid and connector = 'notion'
        `)
      }

      // The schemas, in the answer. Whoever writes next needs the real property
      // names and the real select options, and finding them out by being
      // rejected is the slow way.
      const described: string[] = []
      for (const title of attached) {
        const source = shared.find((s) => s.title === title)
        if (source === undefined) continue
        const schema = await schemaOf(client, source.id)
        const options = schema.properties
          .filter((p) => p.type === 'select' || p.type === 'status')
          .map((p) => `${p.name}: ${p.options.join(' / ')}`)
        described.push(`${title} — ${options.join('; ') || 'no status field'}`)
      }

      const project = String(setup.project_name ?? 'this project')
      const parts: string[] = []
      if (attached.length > 0) {
        parts.push(
          `${project} is now wired to ${count(attached.length, 'Notion database', 'Notion databases')}: ` +
            `${attached.join(', ')}.`,
        )
        parts.push(described.join('\n'))
      }
      if (unclear.length > 0) {
        parts.push(
          `I could not choose between ${unclear.join(' and ')} — same name, different ` +
            'teamspaces. Tell me which and I will attach it.',
        )
      }
      if (absent.length > 0) {
        parts.push(
          `Nothing is shared called ${absent.join(' or ')}, so ${project} has nowhere to ` +
            'put those. Share it in Notion and say the word.',
        )
      }
      if (parts.length === 0) parts.push('Nothing to attach — it is already wired up.')

      /*
        Grant: *"can't it list the available teamspaces and ask me which one to
        use?"*

        Not teamspaces — Notion's API has no such object, on any version. A
        database inside a teamspace reports its parent as `workspace` and the
        words `teamspace`, `space_id` and `section` appear nowhere in the
        payload, so there is nothing to enumerate and I will not invent a list
        that looks authoritative and is guesswork.

        What IS enumerable is every database shared with the integration, which
        is the thing a write actually needs. So the answer to his question is
        yes, one level down: here is the real list, and if the right one is not
        on it the reason is that it has not been shared, which is the sentence
        that follows.
      */
      const placed = new Set(attached)
      const rest = shared.filter((s) => !placed.has(s.title))
      if (rest.length > 0) {
        parts.push(
          `Everything else shared with us: ${rest.map((s) => s.title).join(', ')}. Say the ` +
            'word if one of those should be the Projects, Tasks or Docs database instead — ' +
            'Notion has no teamspace in its API, so these databases are as far as I can see.',
        )
      }

      return {
        ...base,
        body: parts.join('\n\n'),
        announce: attached.length > 0 || unclear.length > 0,
      } satisfies HandlerOutput
    },
  }
}
