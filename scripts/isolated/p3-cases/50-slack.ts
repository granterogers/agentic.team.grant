/**
 * Slack (migration 0685), through the REAL slack-events handler running against the clone: the sender's office decides whose
 * message it is, and a channel that belongs to another office's project is refused like a stranger's.
 */
import { computeSignature } from '../../../src/slack/signature.ts'
import { type Ctx, lit } from '../p3-app-lib.ts'
import { startEdge } from '../edge-emulator.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const SECRET = `p3-signing-${run}`
  const TEAM = `T0A${run.toUpperCase()}XX`
  const TEAM_B = `T0B${run.toUpperCase()}XX`
  const ua = `U0A${run.toUpperCase()}1`
  const ub = `U0B${run.toUpperCase()}1`
  const stranger = `U0S${run.toUpperCase()}1`
  const chA = `C0A${run.toUpperCase()}A`
  const chB = `C0B${run.toUpperCase()}B`

  // The installed workspace, two people (one per office), and a channel mapped to each office's own project.
  for (const [office, team] of [[A, TEAM], [B, TEAM_B]] as const) {
    await c.db.execute(`insert into public.slack_app_credentials (office_id, slack_app_id, team_id, app_name) values ('${office}', ${lit(`A0${team}`)}, ${lit(team)}, 'p3 attack')`)
    await c.db.execute(`insert into public.slack_workspaces (office_id, team_id, team_name, installed, bot_user_id, app_id) values ('${office}', ${lit(team)}, 'p3 attack', true, 'U0BOT', ${lit(`A0${team}`)})`)
  }
  for (const [office, actor, tag] of [[A, ua, 'a'], [B, ub, 'b']] as const) {
    await c.db.execute(`insert into public.subject_identities (origin_channel, actor, subject, office_id, note) values ('slack', ${lit(actor)}, ${lit(`${tag}-${run}`)}, '${office}', 'p3 attack')`)
  }
  const proj = async (office: string, slug: string): Promise<string> => {
    await c.db.execute(`insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'paused', '${office}') on conflict do nothing`)
    return String((await q(`select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`))[0]?.project_id)
  }
  const pa = await proj(A, `slack-${run}`)
  const pb = await proj(B, `slack-${run}`)
  for (const [ch, p, team] of [[chA, pa, TEAM], [chB, pb, TEAM_B]] as const) {
    await c.db.execute(`insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, active) values (${lit(ch)}, ${lit(team)}, '${p}', ${lit(`room-${ch}`)}, true) on conflict do nothing`)
  }

  const edge = await startEdge({
    db: c.db as never,
    edgeFile: 'supabase/functions/slack-events/index.ts',
    beside: [
      ['src/slack/events.ts', 'events.ts'],
      ['src/slack/interactions.ts', 'interactions.ts'],
      ['src/slack/signature.ts', 'signature.ts'],
    ],
    env: { SLACK_SIGNING_SECRET: SECRET, SLACK_BOT_USER_ID: 'U0BOT', SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key' },
  })
  let seq = 0
  const post = async (user: string, channel: string, text: string, team = TEAM, ts = `${Math.floor(Date.now() / 1000)}.${String(100000 + ++seq)}`) => {
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: `Ev${run}${seq}`,
      team_id: team,
      event: { type: 'message', user, text, channel, ts, event_ts: ts, channel_type: 'channel' },
    })
    const stamp = String(Math.floor(Date.now() / 1000))
    const sig = await computeSignature(SECRET, stamp, body)
    const r = await edge.call(new Request('https://door.invalid/functions/v1/slack-events', { method: 'POST', headers: { 'X-Slack-Signature': sig, 'X-Slack-Request-Timestamp': stamp, 'Content-Type': 'application/json' }, body }))
    const t = await r.text()
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(t) as Record<string, unknown> } catch { parsed = { raw: t } }
    return { status: r.status, body: parsed }
  }
  const stored = async (text: string) => q(`select office_id, command_id, project_id from public.inbound_commands where instruction = ${lit(text)}`)
  const bridgeBefore = (await q(`select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('inbound_commands')`))[0]?.n

  // ---- each sender's message is their own office's ---------------------------------------------------------------------------
  const t1 = `slack hello A ${run}`
  const t2 = `slack hello B ${run}`
  const r1 = await post(ua, chA, t1)
  const r2 = await post(ub, chB, t2, TEAM_B)
  c.check(r1.status === 200 && r2.status === 200, 'both senders are accepted in their own channels', `${String(r1.status)} ${String(r2.status)} ${JSON.stringify(r1.body).slice(0, 60)}`)
  const s1 = await stored(t1)
  const s2 = await stored(t2)
  c.check(s1[0]?.office_id === A && s2[0]?.office_id === B, 'each message is stored in its sender\'s office', `${String(s1[0]?.office_id).slice(0, 8)} ${String(s2[0]?.office_id).slice(0, 8)}`)
  const j1 = (await c.exec('p2_worker', `select app.enqueue_inbound('${String(s1[0]?.command_id)}')`)) as { job_id: string }
  const jr = (await q(`select office_id, project_id from public.jobs where job_id = '${j1.job_id}'`))[0]
  c.check(jr?.office_id === A && jr?.project_id === pa, 'the job is A\'s, in A\'s project (the channel\'s)', '')

  // ---- A cannot post into B's channel; it is refused like a stranger and nothing is stored -----------------------------------------------
  const t3 = `slack A into B's room ${run}`
  const r3 = await post(ua, chB, t3, TEAM_B)
  c.check(r3.status === 200 && String(r3.body.ignored ?? '').length > 0 && (await stored(t3)).length === 0, 'a member of one office posting in another office\'s project channel is acknowledged and stored nowhere', JSON.stringify(r3.body).slice(0, 80))

  // ...nor in a channel of B's workspace that maps to no project at all: the installation is B's, whatever the channel.
  const t3b = `slack A into B's unmapped room ${run}`
  const r3b = await post(ua, `C0Z${run.toUpperCase()}ZZ`, t3b, TEAM_B)
  c.check(r3b.status === 200 && String(r3b.body.ignored ?? '').length > 0 && (await stored(t3b)).length === 0, 'and not in an unmapped channel of another office\'s workspace either', JSON.stringify(r3b.body).slice(0, 80))

  // ---- a stranger is nobody ------------------------------------------------------------------------------------------------------------
  const t4 = `slack stranger ${run}`
  const r4 = await post(stranger, chA, t4)
  c.check(String(r4.body.ignored ?? '').includes('unrecognised') && (await stored(t4)).length === 0, 'an unrecognised Slack user is acknowledged and stored nowhere', JSON.stringify(r4.body).slice(0, 80))

  // ---- a duplicate delivery is one command -------------------------------------------------------------------------------------------------
  const t5 = `slack twice ${run}`
  const ts5 = `${Math.floor(Date.now() / 1000)}.777777`
  await post(ua, chA, t5, TEAM, ts5)
  await post(ua, chA, t5, TEAM, ts5)
  c.check((await stored(t5)).length === 1, 'the same event delivered twice is one command', String((await stored(t5)).length))

  // ---- a message the database refuses is not acknowledged as a duplicate ---------------------------------------------------------------------
  const t6 = `slack would be lost ${run}`
  try {
    await c.db.execute(`alter table public.inbound_commands disable trigger a0_project_default;
      alter table public.inbound_commands alter column project_id set default app.unnamed_project()`)
    const r6 = await post(ua, chA, t6)
    c.check(r6.status === 503 && (await stored(t6)).length === 0, 'a message the database refuses (foreign key) is answered 503 so Slack retries - not 200 as though it were a duplicate', `status ${String(r6.status)}`)
  } finally {
    await c.db.execute(`alter table public.inbound_commands alter column project_id drop default;
      alter table public.inbound_commands enable trigger a0_project_default`)
  }

  const bridgeAfter = (await q(`select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('inbound_commands')`))[0]?.n
  c.check(bridgeAfter === bridgeBefore, 'the Slack path did not use the compatibility bridge', `${String(bridgeBefore)} -> ${String(bridgeAfter)}`)
}
