/**
 * Asking a registered provider what it offers, and writing it down (#265).
 *
 * The job that joins `src/mcp/client.ts` to 0440's tables, and it is
 * deliberately thin: everything interesting is on either side of it.
 *
 * It discovers and it does NOT offer. A provider advertising `contacts.delete`
 * produces a row in `mcp_discovered_tools` classified `destructive` and
 * nothing else — no `tool_permissions` row, no agent able to reach it, no
 * approval requested. Offering is a separate, deliberate act
 * (`app.offer_mcp_tool`) and even that produces a DISABLED row.
 *
 * That gap is the Issue's core invariant and it is worth one more sentence
 * because it is the thing a future change will erode: it is tempting, having
 * just discovered forty useful tools, to offer them all. Discovery is a survey
 * of possible reach. Reach is granted by a person.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { discoverTools } from '../mcp/client.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const json = (v: unknown): string => lit(JSON.stringify(v ?? []))

export interface McpDiscoverDeps {
  readonly db: SqlExecutor
}

export function mcpDiscoverHandler(deps: McpDiscoverDeps): Handler {
  const { db } = deps
  return {
    kind: 'mcp.discover',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        contradictions: null,
        evidence: 'verified' as const,
        model: null,
        path: 'deterministic_retrieval' as const,
        sources: [`job:${job.jobId}`],
      }
      const say = (body: string, announce = true): HandlerOutput =>
        ({ ...base, announce, body }) satisfies HandlerOutput

      const payload = (
        (
          await db.execute(
            `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown> } | undefined
      )?.pinned_config
      const name = String(payload?.provider ?? '').trim()
      if (name === '') return say('I was asked to survey a provider and not told which one.')

      /*
        The credential is resolved HERE and passed in, so importing the client
        cannot give anybody the ability to authenticate. Same rule the file
        store states about the service key.
      */
      const row = (
        await db.execute(`
          select p.provider_id::text as id, p.endpoint, p.enabled, p.revoked_at is not null as gone,
                 app.resolve_secret(p.credential_ref) as bearer
            from public.mcp_providers p
           where p.office_id = app.job_office(${lit(job.jobId)}::uuid)
             and p.name = ${lit(name)}`)
      ).rows[0] as
        | { id: string; endpoint: string; enabled: boolean; gone: boolean; bearer: string | null }
        | undefined

      if (row === undefined) return say(`There is no provider registered as “${name}”.`)
      if (row.gone || !row.enabled) {
        return say(`${name} is disconnected, so I have not asked it anything.`)
      }

      const found = await discoverTools(row.endpoint, {
        bearer: row.bearer ?? undefined,
      })

      if (!found.ok) {
        /*
          A provider that cannot be reached is a health fact, not a failure of
          this job. Recorded on the provider so the inventory shows it, and the
          job completes — the same §18 degradation the Google readers make.
        */
        await db.execute(`
          update public.mcp_providers
             set last_probe_at = app.now_utc(), last_probe_ok = false,
                 last_probe_detail = ${lit(String(found.error ?? 'it did not answer').slice(0, 400))},
                 updated_at = app.now_utc()
           where provider_id = ${lit(row.id)}::uuid`)
        return say(
          `I could not get an answer out of ${name}: ${String(found.error ?? 'no reason given')}. ` +
            'Nothing has changed about what the office can do.',
        )
      }

      await db.execute(`
        update public.mcp_providers
           set server_name = ${found.serverName === null ? 'null' : lit(found.serverName)},
               server_version = ${found.serverVersion === null ? 'null' : lit(found.serverVersion)},
               protocol_version = ${found.protocolVersion === null ? 'null' : lit(found.protocolVersion)},
               updated_at = app.now_utc()
         where provider_id = ${lit(row.id)}::uuid`)

      const recorded = (
        await db.execute(
          `select app.record_mcp_tools(${lit(row.id)}::uuid, ${json(found.tools)}::jsonb) as r`,
        )
      ).rows[0] as { r?: unknown } | undefined
      const result = (typeof recorded?.r === 'string' ? JSON.parse(recorded.r) : recorded?.r) as {
        seen?: number
        vanished?: number
        error?: string
      }
      if (typeof result?.error === 'string') {
        return say(`I asked ${name} and could not write down what it said: ${result.error}.`)
      }

      const reach = (
        await db.execute(`
          select reach, count(*)::int as n from public.mcp_discovered_tools
           where provider_id = ${lit(row.id)}::uuid and vanished_at is null
           group by reach order by reach`)
      ).rows as { reach: string; n: number }[]
      const shape =
        reach.length === 0 ? 'nothing' : reach.map((r) => `${String(r.n)} ${r.reach}`).join(', ')

      return {
        ...base,
        announce: true,
        body:
          `${name} offers ${String(result?.seen ?? 0)} tool(s): ${shape}. ` +
          `${
            Number(result?.vanished ?? 0) > 0
              ? `${String(result?.vanished)} it used to offer are gone. `
              : ''
          }` +
          'None of them is usable by anybody — discovering what a provider can do is not the ' +
          'same as letting the office do it. Say which you want offered and it will appear ' +
          'as a switched-off capability for you to approve.',
      }
    },
  }
}
