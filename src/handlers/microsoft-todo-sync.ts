/**
 * The duty behind `microsoft.todo_sync`: keeping Grant's To Do list in step with the office's tasks.
 *
 * The same engine as `tasks.sync` (Vikunja), with three differences a reader needs to know:
 *
 *   - the credential is a delegated refresh token, and Microsoft ROTATES it, so a round that gets a new one stores it
 *     before anything else can fail;
 *   - the list is chosen by the office, not typed in: when none is set, the round uses Microsoft's default list and
 *     remembers which one it was;
 *   - the duty is disabled until Grant connects, and `app.hq_store_microsoft_refresh` is what enables it.
 *
 * Silent unless it has something to say, and "not connected" is not an error, both as in `tasks-sync.ts`.
 */
import { readCredential } from '../credentials/deployment.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { MicrosoftTodoProvider } from '../tasks/microsoft-todo.ts'
import { ProviderAuthError, ProviderDownError, type TaskProvider } from '../tasks/provider.ts'
import { type SyncGate, type SyncReport, syncOnce } from '../tasks/sync.ts'
import { governEffect } from './approval-gate.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const asJson = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

/** Questions about deletions one round may raise; the rest are asked on the next. */
const MAX_DELETE_QUESTIONS_PER_ROUND = 5

export function microsoftTodoSyncBody(r: SyncReport): string {
  if (r.down !== null && r.downKind === 'refused') {
    return `Microsoft To Do turned the connection down (${r.down}). Nothing was changed here. Connect it again in Settings, under Your tasks in another app.`
  }
  if (r.down !== null)
    return `Microsoft To Do could not be reached (${r.down}). Nothing was changed here.`
  const said: string[] = []
  if (r.pushed > 0) said.push(`sent ${String(r.pushed)}`)
  if (r.created > 0) said.push(`took ${String(r.created)} new one${r.created === 1 ? '' : 's'}`)
  if (r.deleted > 0) said.push(`removed ${String(r.deleted)}`)
  if (r.conflicts > 0)
    said.push(`kept the copy here for ${String(r.conflicts)} that changed in both places`)
  if (r.failed > 0) said.push(`could not send ${String(r.failed)}`)
  if (r.held > 0)
    said.push(`${String(r.held)} waiting for your say before anything changes in Microsoft To Do`)
  return said.length === 0
    ? 'Your tasks and Microsoft To Do already agree.'
    : `Microsoft To Do: ${said.join(', ')}.`
}

/** What a round's outcome reads as in Settings: the same four words the Vikunja reading uses. */
const kindOf = (error: unknown): 'refused' | 'unreachable' | 'error' => {
  if (error instanceof ProviderAuthError) return 'refused'
  if (error instanceof ProviderDownError) return 'unreachable'
  return 'error'
}

/** A way to make the provider, for a suite that must see every call. The real one is Microsoft's Graph. */
export interface MicrosoftTodoSyncDeps {
  readonly provider?: (config: {
    readonly clientId: string
    readonly clientSecret: string
    readonly refreshToken: string
    readonly listId: string
    readonly onRefreshTokenRotated: (token: string) => Promise<void>
  }) => TaskProvider & {
    defaultList?: () => Promise<{ id: string; name: string } | null>
  }
}

export function microsoftTodoSyncHandler(
  db: SqlExecutor,
  deps: MicrosoftTodoSyncDeps = {},
): Handler {
  return {
    kind: 'microsoft.todo_sync',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`, 'db:tasks'],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }
      // The duty runs for one office: the claimed job's. Every read and write below is that office's and no other.
      const office = String(
        (await db.execute(`select app.job_office('${job.jobId}'::uuid) as o`)).rows[0]?.o ?? '',
      )
      const settings = asJson(
        (await db.execute(`select app.microsoft_todo_settings(${lit(office)}::uuid) as v`)).rows[0]
          ?.v,
      ) as { connected?: boolean; list_id?: string | null }
      if (settings.connected !== true) {
        return { ...base, announce: false, body: 'Microsoft To Do is not connected.' }
      }

      /*
        The two secrets are resolved HERE and never travel through `microsoft_todo_settings`, whose answer can end up on
        a page. Read once, used once, and not returned in anything this function produces.
      */
      const clientSecret = (await readCredential(db, 'microsoft.client_secret')) ?? ''
      const refreshToken = (await readCredential(db, 'microsoft_todo.refresh_token')) ?? ''
      const clientId = String(
        (
          await db.execute(
            `select value as v from public.system_config where key = 'microsoft.client_id'`,
          )
        ).rows[0]?.v ?? '',
      )
      if (clientSecret === '' || refreshToken === '' || clientId === '') {
        return { ...base, announce: false, body: 'Microsoft To Do is not connected.' }
      }

      /*
        Storing a rotated refresh token is the one write this duty makes that cannot wait for the round to finish: the
        old token may stop working at any moment after Microsoft issues the new one.
      */
      const onRefreshTokenRotated = async (token: string): Promise<void> => {
        await db.execute(
          `select app.microsoft_todo_rotate_refresh(${lit(office)}::uuid, ${lit(token)})`,
        )
      }

      const provider = (deps.provider ?? ((c) => new MicrosoftTodoProvider(c)))({
        clientId,
        clientSecret,
        refreshToken,
        listId: String(settings.list_id ?? ''),
        onRefreshTokenRotated,
      })

      /*
        With no list chosen, the round uses Microsoft's default list and remembers it, so the office has a list to
        write to without anybody having to pick one. The lookup is an outage like any other call: it is recorded and
        the round says so.
      */
      let listId = String(settings.list_id ?? '')
      let report: SyncReport
      let writeSaid = ''
      try {
        if (listId === '') {
          const found = provider.defaultList === undefined ? null : await provider.defaultList()
          if (found === null) {
            await db.execute(
              `select app.microsoft_todo_health_record(${lit(office)}::uuid, false, 'error', 'Microsoft To Do has no default list on this account.')`,
            )
            return {
              ...base,
              announce: true,
              body: 'Microsoft To Do has no default list on this account, so nothing was sent.',
            }
          }
          listId = found.id
          await db.execute(
            `select app.microsoft_todo_remember_list(${lit(office)}::uuid, ${lit(found.id)}, ${lit(found.name)})`,
          )
        }
        const round = await runRound(db, provider, office, job, listId)
        report = round.report
        writeSaid = round.writeSaid
      } catch (error) {
        // A round that THROWS is still a reading Settings must show. Recorded, then re-thrown so the job's failure path
        // says what it always said.
        await db
          .execute(
            `select app.microsoft_todo_health_record(${lit(office)}::uuid, false, ${lit(kindOf(error))}, ${lit(String((error as Error).message ?? '').slice(0, 140))})`,
          )
          .catch(() => undefined)
        throw error
      }

      const healthy = report.down === null
      await db.execute(
        `select app.microsoft_todo_health_record(${lit(office)}::uuid, ${healthy ? 'true' : 'false'}, ${lit(
          report.down === null ? 'ok' : report.downKind === 'refused' ? 'refused' : 'unreachable',
        )}, ${lit(report.down ?? '')})`,
      )

      const moved =
        report.pushed +
        report.created +
        report.deleted +
        report.conflicts +
        report.failed +
        report.held
      return {
        ...base,
        /*
          Silent when the two already agree, which is almost every tick. An outage speaks, because a copy drifting
          behind a list Grant believes is connected is the failure a projection may not have quietly.
        */
        announce: report.down !== null || moved > 0,
        body:
          writeSaid === ''
            ? microsoftTodoSyncBody(report)
            : `${microsoftTodoSyncBody(report)} ${writeSaid}`,
      } satisfies HandlerOutput
    },
  }
}

/*
  The round itself, with the gate built from the authorisation policy, exactly as `tasks-sync.ts` does it. Write is
  decided once per round, because connecting the list is the standing yes for that list. Delete is an exact question for
  each task, and a refusal holds it on both sides.
*/
async function runRound(
  db: SqlExecutor,
  provider: TaskProvider,
  office: string,
  job: Job,
  listId: string,
): Promise<{ report: SyncReport; writeSaid: string }> {
  const board = `microsoft_todo:${listId}`
  let writeOk: boolean | null = null
  let writeSaid = ''
  let asked = 0
  const gate: SyncGate = {
    mayWrite: async () => {
      if (writeOk === null) {
        const d = await governEffect(db, job, {
          tool: 'task.board.write',
          material: { board },
          scope: board,
          summary: 'Keep your tasks in step with your Microsoft To Do list',
          agent: 'operations-director',
        })
        writeOk = d.ok
        if (!d.ok) writeSaid = d.said
      }
      return writeOk
    },
    mayDelete: async ({ title, externalId }) => {
      const d = await governEffect(db, job, {
        tool: 'task.board.delete',
        material: { provider: 'microsoft_todo', board, externalId },
        summary: `Delete "${title.slice(0, 80)}" from Microsoft To Do? You deleted it here and Microsoft To Do still holds it.`,
        detail:
          'Nothing is deleted there without your yes. If you say no, it stays there and is not asked about again for a while.',
        agent: 'operations-director',
        noQuestion: asked >= MAX_DELETE_QUESTIONS_PER_ROUND,
        onYes: { yes: 'Yes, delete it in Microsoft To Do', no: 'No, leave it there' },
      })
      if (d.ok) return true
      if (d.blocker !== null && !d.quiet) asked += 1
      return false
    },
  }
  const report = await syncOnce(db, provider, gate, { office })
  // A refused write is said after the round's own words, and only when the round reached the list at all.
  return { report, writeSaid: writeOk === false && report.down === null ? writeSaid : '' }
}
