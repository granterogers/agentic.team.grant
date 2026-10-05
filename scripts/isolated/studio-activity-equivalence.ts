/**
 * Proof: app.studio_activity (migration 1024) returns EXACTLY what the frozen 0920 definition returns.
 *
 *   npx tsx scripts/isolated/studio-activity-equivalence.ts [replica-db=post]
 *
 * The change replaces a per-row app.job_via_label call with the same three sources read as a join. The only way that can be wrong
 * is a via the old function would have produced differently, so the edge rows (rolled back) cover every branch of app.job_via:
 * an external assistant of each client kind (and an unknown client), a command recorded as chatgpt / claude / mcp / something else,
 * and the plain channel, plus a harness job whose outputs must stay out.
 *
 * Controls (a comparison that cannot fail proves nothing):
 *   1. the cases are not empty: answered lines exist and carry more than one distinct via;
 *   2. the frozen reference disagrees with a copy of the new function whose via is forced to the channel;
 *   3. a different limit disagrees somewhere.
 *
 * Runs only against the marked local replica; never touches production; spends no model call.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

await db.execute(
  readFileSync(new URL('./reference/studio-activity.0920.sql', import.meta.url), 'utf8'),
)

await db.execute('begin')
try {
  await db.execute('set local session_replication_role = replica')
  const office = (
    await rows(`select office_id::text id from public.offices where kind = 'person' limit 1`)
  )[0]?.id as string
  // Four clients, one of each kind the mapping distinguishes, so every arm of the via is reachable.
  await db.execute(`
    insert into public.mcp_clients (client_id, display_name, token_sha256, office_id, kind)
    select v.id, v.id, encode(sha256(convert_to(v.id, 'utf8')), 'hex'), '${office}', v.kind
      from (values ('edge-chatgpt','chatgpt'),('edge-claude','claude'),('edge-other','other')) as v(id, kind)`)
  // Commands carrying a recorded via of each accepted value, and one that carries something the mapping must ignore.
  await db.execute(`
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, processed_at,
                                         project_id, office_id, synthetic, context)
    select 'teamhq', 'edge:' || v.via, '1', 'edge', 'edge:cmd:' || v.via, now(), now(),
           (select project_id from public.projects where office_id = '${office}' and not is_fixture limit 1), '${office}', false,
           jsonb_build_object('via', v.via)
      from (values ('chatgpt'), ('claude'), ('mcp'), ('something-else')) as v(via)`)
  const projects = (await rows(
    `select project_id::text id from public.projects where not is_fixture order by project_id`,
  )) as { id: string }[]
  // Re-point real outputs' jobs at those sources. Each job is changed once, in a round-robin, so every project gets every case.
  await db.execute(`
    with picked as (
      select j.job_id, row_number() over (partition by j.project_id order by j.job_id) rn
        from public.jobs j join public.outputs o on o.job_id = j.job_id
       where j.project_id is not null and o.created_at > now() - interval '40 days'),
    plan as (
      select job_id, rn % 9 as k from picked where rn <= 90)
    update public.jobs j set
      requested_by = case plan.k when 0 then 'mcp:edge-chatgpt' when 1 then 'mcp:edge-claude' when 2 then 'mcp:edge-other'
                                 when 3 then 'mcp:edge-unknown' when 8 then 'verify:edge-harness' else j.requested_by end,
      origin_command_id = case plan.k
        when 4 then (select command_id from public.inbound_commands where dedupe_key = 'edge:cmd:chatgpt')
        when 5 then (select command_id from public.inbound_commands where dedupe_key = 'edge:cmd:claude')
        when 6 then (select command_id from public.inbound_commands where dedupe_key = 'edge:cmd:mcp')
        when 7 then (select command_id from public.inbound_commands where dedupe_key = 'edge:cmd:something-else')
        else j.origin_command_id end,
      origin_channel = case plan.k when 4 then 'telegram' when 5 then 'slack' when 6 then 'voice' when 7 then 'teamhq' else j.origin_channel end
      from plan where j.job_id = plan.job_id`)
  await db.execute('reset session_replication_role')

  let compared = 0
  let answeredLines = 0
  const vias = new Set<string>()
  for (const p of projects) {
    for (const limit of [12, 50, 500]) {
      const r = (
        await rows(
          `select app.studio_activity('${p.id}'::uuid, ${limit}) = proof_ref.studio_activity('${p.id}'::uuid, ${limit}) as eq`,
        )
      )[0]
      compared += 1
      if (r?.eq !== true)
        check(false, `studio_activity(${p.id}, ${limit}) differs from the frozen definition`)
    }
    const lines = (await rows(
      `select jsonb_array_elements(app.studio_activity('${p.id}'::uuid, 500)) as l`,
    )) as { l: { verb: string; via: string | null } }[]
    for (const x of lines) {
      if (x.l.verb === 'answered') {
        answeredLines += 1
        vias.add(String(x.l.via))
      }
    }
  }
  check(
    failed === 0 && compared > 0,
    `studio_activity equals the frozen definition for ${compared} project/limit pairs`,
  )

  // Control 1: not vacuous.
  check(
    answeredLines > 0 && vias.size >= 4,
    `control: ${answeredLines} answered lines carry ${vias.size} distinct via values (${[...vias].join(', ')})`,
  )

  // Control 2: a copy of the new function with the via forced to the channel must disagree with the reference.
  const src = (
    await rows(`select pg_get_functiondef('app.studio_activity(uuid,integer)'::regprocedure) as d`)
  )[0]?.d as string
  const sab = src
    .replace('app.studio_activity', 'proof_ref.sabotaged_activity')
    .replace(
      /app\.via_label\(case when j\.requested_by like 'mcp:%'[\s\S]*?end\) as via/,
      () => 'app.via_label(j.origin_channel) as via',
    )
  check(
    sab !== src.replace('app.studio_activity', 'proof_ref.sabotaged_activity'),
    'control: the sabotage text was applied to the copy',
  )
  await db.execute(sab)
  let differs = 0
  for (const p of projects) {
    const r = (
      await rows(
        `select proof_ref.sabotaged_activity('${p.id}'::uuid, 500) <> proof_ref.studio_activity('${p.id}'::uuid, 500) as d`,
      )
    )[0]
    if (r?.d === true) differs += 1
  }
  check(
    differs > 0,
    `control: a copy with the via forced to the channel disagrees with the reference in ${differs} of ${projects.length} projects`,
  )

  // Control 3: a different limit disagrees somewhere.
  let limitDiffers = 0
  for (const p of projects) {
    const r = (
      await rows(
        `select app.studio_activity('${p.id}'::uuid, 3) <> proof_ref.studio_activity('${p.id}'::uuid, 50) as d`,
      )
    )[0]
    if (r?.d === true) limitDiffers += 1
  }
  check(
    limitDiffers > 0,
    `control: a different limit disagrees with the reference in ${limitDiffers} of ${projects.length} projects`,
  )
} finally {
  await db.execute('rollback')
  await db.execute('drop schema if exists proof_ref cascade')
}

console.log(
  failed === 0
    ? '\nstudio activity equivalent: PASS'
    : `\nstudio activity equivalent: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)
