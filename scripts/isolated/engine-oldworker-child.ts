// biome-ignore-all format: a dense proof helper kept readable as written
/**
 * The worker that predates Hermes, run as itself (Hermes, stale-worker prevention; used by engine-gate.ts).
 *
 * This file is copied into a worktree of the PINNED PRE-HERMES COMMIT and run there, so every import below resolves to the OLD source tree:
 * the old `src/jobs/worker.ts` claim, the old `office.instruction` handler, the old router. Nothing of the Hermes work is in that tree. It
 * claims whatever the database will give it, exactly as a worker that was never redeployed would, and runs the old team handler against a
 * model that is a stub: any model call it makes is counted, and a team ANSWER would be a team-side effect the proof then looks for.
 *
 *   npx tsx scripts/isolated/engine-oldworker-child.ts <replica-db> <worker-id>
 *
 * It prints one JSON line: { claimedBy, modelCalls }. It never reaches anything but the replica (the guard refuses a socket that is not local).
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { drain, type Handler, type Reviewer } from '../../src/jobs/worker.ts'
import { ProviderRouter } from '../../src/providers/router.ts'
import { isolated } from './guard.ts'

const [database = 'post', workerId = 'old-worker'] = process.argv.slice(2)
const db = await isolated(database)
const modelCalls: string[] = []
const modelFetch = (async (url: string) => {
  modelCalls.push(String(url))
  return new Response(JSON.stringify({ error: { message: 'no model in this proof' } }), { status: 500 })
}) as unknown as typeof fetch
const router = new ProviderRouter(db, 'k', modelFetch, 4, { requestTimeoutMs: 2_000 })
const review: Reviewer = async () => ({ status: 'approved', notes: 'old worker proof' })
const handlers: Handler[] = [instructionHandler({ db, router })]
await drain(db, workerId, handlers, review, 5, { canTranscribe: false, canSubprocess: false })
const claimed = (await db.execute(`select job_id::text as j from public.jobs where leased_by = '${workerId.replace(/'/g, "''")}' or state_reason like 'dequeued by ${workerId.replace(/'/g, "''")}%'`)).rows
console.log(JSON.stringify({ claimedBy: claimed.map((r) => String((r as { j: string }).j)), modelCalls: modelCalls.length }))
await db.end()
process.exit(0)
