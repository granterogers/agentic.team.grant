import { instructionHandler } from '../../src/handlers/instruction.ts'
import { isolated } from './guard.ts'
const db = await isolated('rm_s1')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const O = `(select app.operator_office())`
const p1 = String((await db.execute(`select project_id::text as p from public.projects where office_id = ${O} limit 1`)).rows[0].p)
const handler = instructionHandler({ db, router: { complete: async () => ({ content: '{}', model: 'x' }) } as never, now: () => new Date() })
for (const said of process.argv.slice(3)) {
  const c = (await db.execute(`set local application_name = 'PostgREST 14.5'; insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context) values (${O}, ${lit(p1)}::uuid, 'teamhq', ${lit(`dbg${Math.random()}:1`)}, 'grant', ${lit(said)}, ${lit(`teamhq:message:dbg${Math.random()}`)}, 'grant', '{}'::jsonb) returning command_id::text as id`)).rows[0]
  const v = (await db.execute(`select app.enqueue_inbound(${lit(String(c.id))}::uuid) as v`)).rows[0].v
  const jobId = String((typeof v === 'string' ? JSON.parse(v) : v).job_id)
  const j = (await db.execute(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p, idempotency_key as k, office_id::text as o from public.jobs where job_id = ${lit(jobId)}::uuid`)).rows[0]
  const out = await handler.handle({ jobId: String(j.id), kind: String(j.kind), correlationId: String(j.c), projectId: j.p === null ? null : String(j.p), idempotencyKey: String(j.k), attempt: 1, officeId: String(j.o) } as never, db)
  console.log(JSON.stringify(said), '=>', JSON.stringify(out).slice(0, 700))
}
await db.end()
