import { channelsHandler } from '../../src/handlers/channels.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { lit, policyWorld } from '../isolated/policy-lib.ts'
const w = await policyWorld('rev1')
const { db, one, rows } = w
await db.execute(`insert into public.slack_workspaces (team_id, team_name, bot_user_id) values ('T-ISOLATED','isolated','U0ISOLATED') on conflict do nothing`)
let n = 0
const calls: string[] = []
const stub: typeof fetch = async (input) => {
  const m = String(input).split('/').pop()?.split('?')[0] ?? ''
  calls.push(m)
  if (m === 'conversations.create') { n++; return new Response(JSON.stringify({ ok: true, channel: { id: `C0${n}`.padEnd(10,'0'), name: `chan-${n}` } }), { headers: { 'content-type': 'application/json' } }) }
  return new Response(JSON.stringify({ ok: true, channels: [] }), { headers: { 'content-type': 'application/json' } })
}
const slack = new SlackClient('x'.repeat(20), { fetchImpl: stub, sleep: async () => undefined })
const handler = (k='office.provision_channels') => channelsHandler({ db, botToken: 'x'.repeat(20), teamId: 'T-ISOLATED', slack }, k)
const mk = async (l: string) => { const name=`Rev proof ${l} ${w.run}`; await one(`select app.hq_create_project(${lit(name)}, 'upload', ${lit('r-'+l+w.run)}, ${lit(name)}, true) as r`); return String((await one(`select project_id::text as id from public.projects where name=${lit(name)}`)).id) }
const sweep = async (p: string) => w.jobOf(String((await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id) values ('office.provision_channels','hq',${lit(p)}::uuid,'prov-'||gen_random_uuid(),gen_random_uuid()) returning job_id::text as id`)).id))
// 1. dial = act
await one(`insert into public.autonomy_settings(level,set_by,reason) values ('act','grant','a long enough reason for the check') returning 1 as x`)
const A = await mk('dialact')
const o = await handler().handle(await sweep(A), db)
console.log('DIAL ACT unprompted sweep: channels created =', n, '|', o.body.slice(0,100))
await db.execute(`delete from public.autonomy_settings where set_by='grant' and reason='a long enough reason for the check'`)
// 2. stale authority: person-made project, failed first attempt, stays valid
const B = await mk('stale')
await one(`insert into public.slack_channel_authority(project_id, authorized_by, authorized_via) values (${lit(B)}::uuid,'grant','project_creation') returning 1 as x`)
await one(`update public.slack_channel_authority set created_at = now() - interval '200 days' where project_id=${lit(B)}::uuid returning 1 as x`)
const before = n
await handler().handle(await sweep(B), db)
console.log('200-day-old unconsumed authority still spends:', n - before)
// 3. rename after creation, before provisioning: name differs from what he created
const C = await mk('ren')
await one(`insert into public.slack_channel_authority(project_id, authorized_by, authorized_via) values (${lit(C)}::uuid,'grant','project_creation') returning 1 as x`)
await one(`update public.projects set name='Totally different name ${w.run}' where project_id=${lit(C)}::uuid returning 1 as x`)
const b2 = n
await handler().handle(await sweep(C), db)
console.log('renamed before provisioning, created under old authority:', n - b2, (await rows(`select channel_name from public.slack_channel_map where project_id=${lit(C)}::uuid`)))
await db.end?.()
