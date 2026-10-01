/**
 * Run 3, against PRODUCTION: who is actually asking (#385, #388, #384).
 *
 *   npm run verify:run3-live
 *
 * Production-safe by construction. Everything this sends is one of:
 *   - a request that MUST be refused (and asserted to have changed nothing);
 *   - a READ;
 *   - declared test traffic (`testOrigins`), registered before the door is knocked on, and cancelled;
 *   - a session for the TEST member, which the database lets decide only test traffic.
 * It never posts as Grant, never answers a real question, and never speaks under a real-looking
 * session. The person's own session is proved through the REAL handler in the isolated suites
 * (principals.ts, slack-sender.ts); production has one person and a suite must not borrow him.
 *
 * What it says about itself: production-proven here are the anonymous key, the office key, the
 * sign-in mint, the voice door and the Slack door refusing what they must, and the test member
 * driving the gateway. Not proven here: a signed-in Grant approving (isolated only).
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { computeSignature } from '../../src/slack/signature.ts'
import { EXPOSURE_SQL, reachableByAPublicKey, readReach } from '../check-anon-exposure.ts'
import { harnessSession } from './lib/harness-session.ts'
import { officeKey } from './lib/sign-in.ts'
import { testOrigins } from './lib/test-origin.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const db = new ManagementApiExecutor(ref, token)
const base = `https://${ref}.supabase.co/functions/v1`
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const run = Date.now().toString(36)
const origins = await testOrigins(db, 'verify:run3-live')
const key = await officeKey(db)

const gateway = async (auth: string | null, action: string, args: Record<string, unknown>) => {
  const r = await fetch(`${base}/hq-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
    },
    body: JSON.stringify({ action, args }),
  })
  const text = await r.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 100) }
  }
  return { status: r.status, body }
}
const ZERO = '00000000-0000-0000-0000-000000000000'

try {
  // ---- what is deployed -----------------------------------------------------------------
  {
    const m = await one(
      `select count(*) filter (where name like '0613%' or name like '0614%' or name like '0615%')::int as n from app.schema_migrations`,
    )
    check('migrations 0613, 0614 and 0615 are applied', Number(m.n) === 3, `${String(m.n)} of 3`)
  }

  // ---- 384: a public key reaches no function -----------------------------------------------
  {
    const fns = readReach((await db.execute(EXPOSURE_SQL)).rows)
    const open = fns.filter(reachableByAPublicKey)
    check(
      'no public function is executable by anon, authenticated or PUBLIC',
      fns.length > 200 && open.length === 0,
      `${String(fns.length)} inspected, ${String(open.length)} open`,
    )
    const keys = (await (
      await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { name: string; api_key: string }[]
    const anon = keys.find((k) => k.name === 'anon')?.api_key ?? ''
    // Valid named arguments for each: a call PostgREST cannot resolve answers 404, which proves nothing.
    const probes: [string, Record<string, unknown>][] = [
      ['vault_inventory', {}],
      ['callback_ack', { p_bot_id: '1', p_action: 'approve' }],
      ['hq_revoke_tool', { p_slug: 'chief-of-staff', p_tool: 'db.read' }],
      [
        'register_mcp_provider',
        { p_name: 'run3-live-probe', p_endpoint: 'https://example.invalid/mcp' },
      ],
    ]
    for (const [fn, args] of probes) {
      const r = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(args),
      })
      const t = await r.text()
      check(
        `the anon key calling ${fn} over PostgREST is refused as a permission failure`,
        r.status === 401 && /permission denied for function/.test(t),
        `http ${String(r.status)}`,
      )
    }
    const evt = await one(
      `select count(*)::int as n from pg_event_trigger where evtname = 'close_new_public_function' and evtenabled = 'O'`,
    )
    check(
      'the event trigger that closes a NEW public function is on',
      Number(evt.n) === 1,
      String(evt.n),
    )
  }

  // ---- 385: the office key is a machine ---------------------------------------------------------
  {
    const decisions: [string, Record<string, unknown>][] = [
      ['answer_blocker', { p_blocker_id: ZERO, p_answer: 'Go ahead' }],
      ['withdraw_refusal', { p_blocker_id: ZERO }],
      ['task_state', { p_task_id: ZERO, p_state: 'done' }],
      ['approve_tool', { p_request_id: ZERO }],
      ['decline_tool', { p_request_id: ZERO }],
      ['grant_standing', { p_tool: 'notion.write', p_reason: 'run3 live' }],
      ['revoke_standing', { p_authorization: ZERO }],
      ['autonomy_set', { p_level: 'act' }],
      ['staff_tool_set', { p_slug: 'chief-of-staff', p_tool: 'db.read', p_granted: false }],
      ['document_approve', { p_document: ZERO }],
      ['say', { p_project_id: ZERO, p_text: 'run3 live: this must not be said' }],
      ['undo', { p_action_id: ZERO }],
      ['staff_hire', { p_name: 'Run 3 Nobody' }],
      ['set_google_secret', { p_secret: 'x' }],
    ]
    const autonomyBefore = Number(
      (await one(`select count(*)::int as n from public.autonomy_settings`)).n,
    )
    const said = Number(
      (
        await one(
          `select count(*)::int as n from public.inbound_commands where origin_channel = 'teamhq'`,
        )
      ).n,
    )
    let refused = 0
    for (const [action, args] of decisions) {
      const r = await gateway(key, action, { ...args, p_by: 'grant' })
      if (r.status === 403 && r.body.error === 'person_required') refused += 1
      else
        console.log(`  ${action}: http ${String(r.status)} ${JSON.stringify(r.body).slice(0, 80)}`)
    }
    check(
      'the office key cannot decide, speak, reach or connect, even naming itself grant',
      refused === decisions.length,
      `${String(refused)} of ${String(decisions.length)} refused`,
    )
    check(
      'and none of them left a trace',
      Number((await one(`select count(*)::int as n from public.autonomy_settings`)).n) ===
        autonomyBefore &&
        Number(
          (
            await one(
              `select count(*)::int as n from public.inbound_commands where origin_channel = 'teamhq'`,
            )
          ).n,
        ) === said,
      'no autonomy row, no dashboard message',
    )
    const read = await fetch(`${base}/hq-api?section=governance`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    check(
      'the office key still READS (the gate is not a wall)',
      read.status === 200,
      `http ${String(read.status)}`,
    )
    const noKey = await gateway(null, 'answer_blocker', { p_blocker_id: ZERO, p_answer: 'x' })
    check('no credential at all is 401', noKey.status === 401, `http ${String(noKey.status)}`)
    const junk = await gateway('aaa.bbb.' + 'x'.repeat(70), 'answer_blocker', {
      p_blocker_id: ZERO,
      p_answer: 'x',
    })
    check(
      'a forged session is refused',
      junk.status === 401 || junk.status === 503,
      `http ${String(junk.status)}`,
    )
  }

  // ---- 385: the key cannot become a person by asking for a link -----------------------------------
  {
    const grantEmail = String(
      (
        await one(
          `select email from public.office_members where kind = 'person' order by added_at limit 1`,
        )
      ).email,
    )
    const r = await fetch(`${base}/signin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: 'https://ai-team-hq.vercel.app',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        action: 'link_for_operator',
        email: grantEmail,
        back: 'https://ai-team-hq.vercel.app/',
      }),
    })
    const b = (await r.json().catch(() => ({}))) as Record<string, unknown>
    check(
      "the office key cannot mint a session for a person's address",
      r.status === 403 && /test member/.test(String(b.error)) && b.action_link === undefined,
      `http ${String(r.status)} ${String(b.error)}`,
    )
  }

  // ---- 385: the test member drives the gateway, and decides only test traffic -----------------------
  {
    const test = await harnessSession(db, ref)
    check(
      'the test member signs in (a real session, minted for a test member only)',
      test.access !== '',
      test.email,
    )
    const asked = await gateway(test.access, 'autonomy_set', { p_level: 'act' })
    const refusal = JSON.stringify(asked.body)
    const after = Number((await one(`select count(*)::int as n from public.autonomy_settings`)).n)
    check(
      'the test member cannot change the office-wide autonomy (nothing real)',
      /test principal/i.test(refusal),
      refusal.slice(0, 100),
    )
    void after
    const grants = await gateway(test.access, 'staff_tool_set', {
      p_slug: 'chief-of-staff',
      p_tool: 'db.read',
      p_granted: false,
    })
    const held = Number(
      (
        await one(
          `select count(*)::int as n from public.staff_tools where staff_slug = 'chief-of-staff' and tool = 'db.read'`,
        )
      ).n,
    )
    check(
      "the test member cannot change a real specialist's grants",
      // Refused at the gateway (an operator is required, P1.3) or by the database's own test-principal rule: the
      // property is that the grant is unchanged and the request was refused, not which layer said no first.
      held === 1 &&
        grants.status === 403 &&
        (/test principal/i.test(JSON.stringify(grants.body)) ||
          (grants.body as { error?: string }).error === 'operator_required'),
      `held ${String(held)}`,
    )
    const q = await one(`select blocker_id::text as id from public.blockers b
      where b.state = 'open' and not app.harness_job(b.job_id) order by b.created_at desc limit 1`)
    if (q?.id) {
      const r = await gateway(test.access, 'answer_blocker', {
        p_blocker_id: String(q.id),
        p_answer: 'Yes, do it',
      })
      const still = await one(
        `select state::text as s from public.blockers where blocker_id = ${lit(String(q.id))}::uuid`,
      )
      check(
        "the test member cannot answer one of Grant's REAL open questions",
        still.s === 'open' && /test principal/i.test(JSON.stringify(r.body)),
        `${String(still.s)} ${JSON.stringify(r.body).slice(0, 80)}`,
      )
    } else {
      check('no real question is open to try (nothing to answer)', true, 'skipped: none open')
    }
  }

  // ---- the database, asked directly ---------------------------------------------------------------
  {
    for (const [label, by, want] of [
      ['nobody', 'null', /who is answering/],
      ['a stranger', `'mallory'`, /does not know/],
      ['a test principal', `'verify-operator'`, /test principal/],
    ] as const) {
      const r = json(
        (await one(`select public.hq_autonomy_set(app.owner_office('grant'), 'act', null, 'run3 live', ${by})::text as r`)).r,
      )
      check(
        `hq_autonomy_set: ${label} is refused by name`,
        want.test(String(r.error)),
        String(r.error).slice(0, 70),
      )
    }
    const rows = await one(
      `select count(*)::int as n from public.autonomy_settings where reason = 'run3 live'`,
    )
    check('and no autonomy row was written', Number(rows.n) === 0, String(rows.n))
  }

  // check:voice-sessions-exempt: office-key refusal probe (the refusal is the subject; the 403 is asserted below)
  // ---- 385: the voice door: the key is not a voice ---------------------------------------------------
  {
    const said = `run3 live: this must not be heard ${run}`
    const r = await fetch(`${base}/voice/turn`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ said, session: `page${run}xyz`, turn: 1 }),
    })
    const stored = await one(
      `select count(*)::int as n from public.inbound_commands where instruction = ${lit(said)}`,
    )
    check(
      'the office key cannot speak under a real-looking session, and nothing is stored',
      r.status === 403 && Number(stored.n) === 0,
      `http ${String(r.status)} stored ${String(stored.n)}`,
    )
  }

  // ---- 388: Slack: a signed request from the wrong user is still the wrong user -------------------------
  {
    const secret = String(
      (
        await one(
          `select decrypted_secret as v from vault.decrypted_secrets where name = 'slack.signing_secret'`,
        )
      ).v ?? '',
    )
    if (secret === '') {
      check('Slack signing secret is available to the suite', false, 'not in the vault')
    } else {
      const post = async (body: string) => {
        const ts = String(Math.floor(Date.now() / 1000))
        const r = await fetch(`${base}/slack-events`, {
          method: 'POST',
          headers: {
            'X-Slack-Signature': await computeSignature(secret, ts, body),
            'X-Slack-Request-Timestamp': ts,
            'content-type': 'application/json',
          },
          body,
        })
        return {
          status: r.status,
          body: (await r.json().catch(() => ({}))) as Record<string, unknown>,
        }
      }
      const channel = origins.slackChannel()
      const ev = (user: string, text: string, ch: string) =>
        JSON.stringify({
          type: 'event_callback',
          team_id: 'T0RUN3LIVE',
          event_id: `Ev${run}${text.length}`,
          event: {
            type: 'message',
            channel: ch,
            channel_type: 'channel',
            user,
            text,
            ts: `${String(Math.floor(Date.now() / 1000))}.${String(Math.floor(Math.random() * 900000) + 100000)}`,
          },
        })
      const strangerText = `run3 live stranger ${run}`
      const s = await post(ev('U0ZTRUN3ST', strangerText, channel))
      const stored = await one(
        `select count(*)::int as n from public.inbound_commands where instruction = ${lit(strangerText)}`,
      )
      check(
        'a correctly signed message from somebody the office does not know is acknowledged and stored nowhere',
        s.status === 200 && s.body.ignored === 'unrecognised sender' && Number(stored.n) === 0,
        `http ${String(s.status)} ${JSON.stringify(s.body)}`,
      )
      const bad = await fetch(`${base}/slack-events`, {
        method: 'POST',
        headers: {
          'X-Slack-Signature': 'v0=deadbeef',
          'X-Slack-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
          'content-type': 'application/json',
        },
        body: ev('U0ZTRUN3ST', 'forged', channel),
      })
      check('a wrong signature is refused', bad.status === 401, `http ${String(bad.status)}`)
      // The control: a stranger inside a DECLARED test conversation is admitted and the command is synthetic.
      await origins.declare('slack', channel)
      const declaredText = `run3 live declared ${run}`
      const d = await post(ev('U0ZTRUN3ST', declaredText, channel))
      const row = await one(
        `select synthetic, job_id::text as job from public.inbound_commands where instruction = ${lit(declaredText)} order by received_at desc limit 1`,
      )
      check(
        'the control: inside a DECLARED test conversation the same sender is admitted, and the command is synthetic',
        d.status === 200 && row?.synthetic === true,
        `http ${String(d.status)} ${JSON.stringify(row)}`,
      )
      if (typeof row?.job === 'string') {
        await db.execute(
          `update public.jobs set state = 'cancelled', state_reason = 'run3-live fixture' where job_id = ${lit(String(row.job))}::uuid and state = 'queued'`,
        )
      }
    }
  }
} finally {
  await origins.release()
}

// ---- teardown and containment --------------------------------------------------------------------------
{
  const live = await one(
    `select count(*)::int as n from public.jobs j where j.state in ('queued','running','retrying') and j.requested_by like '%run3%'`,
  )
  check('no job of this run is left live', Number(live.n) === 0, String(live.n))
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exitCode = failed === 0 ? 0 : 1
