// biome-ignore-all lint/suspicious/noExplicitAny: rows from the replica are untyped
// biome-ignore-all format: a dense measurement helper kept readable as written
/**
 * Volume for the cross-office read-cost proof (phase 8, F3): other offices' busy history, copied set-based from one template
 * office, so a replica holds hundreds of thousands of rows that belong to somebody else.
 *
 * Disposable replica only: the copy runs with `session_replication_role = replica` (no triggers, no foreign keys), which no product
 * writer can do. Every copied job gets a new id, the target office and the target project; every dependent row follows its job.
 * What is NOT copied (blockers, routing decisions, inbound commands, impediments, pauses) is not what dominates the volume.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const columns = async (db: PgExecutor, table: string): Promise<string[]> =>
  (await db.execute(`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = ${lit(table)}
                       and is_generated <> 'ALWAYS' order by ordinal_position`)).rows.map((r: any) => String(r.c))

/** Copy `jobs` of the template office (and what hangs off each) into `target`, `times` over. Returns the rows written. */
export async function cloneVolume(db: PgExecutor, template: string, target: string, project: string, times: number, jobLimit = 1_000_000): Promise<{ jobs: number; transitions: number; usage: number; deliveries: number; outputs: number }> {
  const jc = await columns(db, 'jobs')
  const tc = await columns(db, 'job_state_transitions')
  const uc = await columns(db, 'inference_usage')
  const dc = await columns(db, 'deliveries')
  const oc = await columns(db, 'outputs')
  const rc = await columns(db, 'routing_decisions')
  const ic = await columns(db, 'job_impediments')
  const pc = await columns(db, 'job_pauses')
  const sel = (cols: string[], alias: string, over: Record<string, string>) => cols.map((c) => over[c] ?? `${alias}.${c}`).join(', ')
  const totals = { jobs: 0, transitions: 0, usage: 0, deliveries: 0, outputs: 0 }
  for (let n = 0; n < times; n++) {
    const sql = `
      begin;
      set local session_replication_role = replica;
      create temp table m on commit drop as
        select j.job_id as old, gen_random_uuid() as new, gen_random_uuid() as corr from public.jobs j where j.office_id = ${lit(template)}::uuid and not j.synthetic order by j.created_at limit ${jobLimit};
      insert into public.jobs (${jc.join(', ')})
        select ${sel(jc, 'j', { job_id: 'm.new', office_id: `${lit(target)}::uuid`, project_id: `${lit(project)}::uuid`, correlation_id: 'm.corr',
          idempotency_key: `'scale-' || m.new::text`, parent_job_id: '(select m2.new from m m2 where m2.old = j.parent_job_id)',
          root_job_id: '(select m2.new from m m2 where m2.old = j.root_job_id)', origin_command_id: 'null::uuid', origin_channel: 'null::text' })}
          from public.jobs j join m on m.old = j.job_id;
      insert into public.job_state_transitions (${tc.join(', ')})
        select ${sel(tc, 't', { transition_id: 'gen_random_uuid()', job_id: 'm.new' })} from public.job_state_transitions t join m on m.old = t.job_id;
      insert into public.inference_usage (${uc.join(', ')})
        select ${sel(uc, 'u', { usage_id: 'gen_random_uuid()', job_id: 'm.new', office_id: `${lit(target)}::uuid`, correlation_id: 'm.corr' })} from public.inference_usage u join m on m.old = u.job_id;
      insert into public.deliveries (${dc.join(', ')})
        select ${sel(dc, 'd', { delivery_id: 'gen_random_uuid()', job_id: 'm.new', office_id: `${lit(target)}::uuid`, correlation_id: 'm.corr', dedupe_key: `'scale-' || gen_random_uuid()::text`, blocker_id: 'null::uuid' })} from public.deliveries d join m on m.old = d.job_id;
      insert into public.outputs (${oc.join(', ')})
        select ${sel(oc, 'o', { output_id: 'gen_random_uuid()', job_id: 'm.new' })} from public.outputs o join m on m.old = o.job_id;
      insert into public.routing_decisions (${rc.join(', ')})
        select ${sel(rc, 'r', { decision_id: 'gen_random_uuid()', job_id: 'm.new', linked_job_id: 'null::uuid' })} from public.routing_decisions r join m on m.old = r.job_id;
      insert into public.job_impediments (${ic.join(', ')})
        select ${sel(ic, 'i', { impediment_id: 'gen_random_uuid()', job_id: 'm.new', project_id: `${lit(project)}::uuid` })} from public.job_impediments i join m on m.old = i.job_id;
      insert into public.job_pauses (${pc.join(', ')})
        select ${sel(pc, 'p', { pause_id: 'gen_random_uuid()', job_id: 'm.new' })} from public.job_pauses p join m on m.old = p.job_id;
      commit;`
    await db.execute(sql)
  }
  const count = async (q: string) => Number(((await db.execute(q)).rows[0] as any).c)
  totals.jobs = await count(`select count(*) as c from public.jobs where office_id = ${lit(target)}::uuid`)
  totals.transitions = await count(`select count(*) as c from public.job_state_transitions t join public.jobs j on j.job_id = t.job_id where j.office_id = ${lit(target)}::uuid`)
  totals.usage = await count(`select count(*) as c from public.inference_usage where office_id = ${lit(target)}::uuid`)
  totals.deliveries = await count(`select count(*) as c from public.deliveries where office_id = ${lit(target)}::uuid`)
  totals.outputs = await count(`select count(*) as c from public.outputs o join public.jobs j on j.job_id = o.job_id where j.office_id = ${lit(target)}::uuid`)
  return totals
}
