/**
 * Architecture Run 5 - production acceptance: exact question binding, forwarded content, fenced children, the CI ledger.
 *
 *   npx tsx scripts/verify/run5-live.ts
 *
 * Production-safe by construction (the same rules as run4-live):
 *   - every conversation is a DECLARED test chat (stamped synthetic at the door), so every job it makes is harness work
 *     by the office's own definition, and nothing here contacts a person;
 *   - a turn's job and every fixture child are held a day out (`not_before`) so no worker claims them while a proof moves
 *     their state; fixture kinds are ones the deployed worker holds no handler for (`verify.ask`);
 *   - a "delivery" is a ROW modelling a message that reached the chat: nothing is sent, and every such row is deleted at
 *     the end so the leak witness cannot read a fabricated row as harness traffic reaching a destination;
 *   - "a second worker" is a row update, not a process: what is proved is the fence the worker asks, in SQL
 *     (app.job_held / app.enqueue_child), not that the deployed worker was made to race;
 *   - the CI ledger is asked and the reservation released in the same breath; no workflow is dispatched.
 * What cannot be induced in production (a lost lease under a live handler) is proved in scripts/isolated/ and labelled
 * so in docs/ARCHITECTURE-RUN-5.md.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { harnessSession } from './lib/harness-session.ts'
import { testOrigins } from './lib/test-origin.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const db = new ManagementApiExecutor(ref, token)
const base = `https://${ref}.supabase.co`
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const run = Date.now().toString(36)
void (await harnessSession(db, ref))
const origins = await testOrigins(db, 'verify:run5-live')
const GRANT = String(
  (
    await one(
      `select actor from public.subject_identities where origin_channel = 'telegram' and subject = 'grant' limit 1`,
    )
  ).actor,
)
const webhookSecret = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'telegram.webhook_secret'`,
    )
  ).v,
)
const keys = (await (
  await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
).json()) as { name: string; api_key: string }[]
const made: string[] = []
const cancelLive = async () => {
  if (made.length === 0) return
  const ids = made.map(lit).join(',')
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'run5-live fixture', leased_by = null, leased_until = null
      where job_id = any (array[${ids}]::uuid[]) and state in ('queued','paused','retrying')`,
  )
  await db.execute(
    `update public.jobs set state = 'failed', state_reason = 'run5-live fixture', leased_by = null, leased_until = null
      where job_id = any (array[${ids}]::uuid[]) and state = 'running'`,
  )
}
const refused = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
    return ''
  } catch (e) {
    return String((e as Error).message)
  }
}

try {
  // ---- deployed ------------------------------------------------------------------------------------------
  {
    const m = await one(
      `select count(*) filter (where name ~ '^062[3-6]_')::int as n from app.schema_migrations`,
    )
    check(
      'migrations 0623, 0624, 0625 and 0626 are applied',
      Number(m.n) === 4,
      `${String(m.n)} of 4`,
    )
    const body = String(
      (
        await one(
          `select pg_get_functiondef('app.dequeue_job(text,boolean,boolean,text[],text)'::regprocedure) as d`,
        )
      ).d,
    )
    check(
      'the deployed dequeue_job bumps the claim on every claim',
      /claim_gen\s*=\s*greatest\(j\.claim_gen,\s*j\.attempt\)\s*\+\s*1/.test(body),
      'claim_gen = greatest(claim_gen, attempt) + 1',
    )
  }

  // ---- a declared test conversation through the DEPLOYED webhook --------------------------------------------------
  const chat = origins.telegramChat()
  await origins.declare('telegram', chat)
  let seq = Math.floor(Date.now() / 1000) % 1_000_000_000
  const turn = async (text: string, extra: Record<string, unknown> = {}) => {
    seq += 1
    await fetch(`${base}/functions/v1/telegram-webhook`, {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        update_id: seq,
        message: {
          message_id: seq,
          date: Math.floor(Date.now() / 1000),
          text,
          chat: { id: Number(chat), type: 'supergroup' },
          from: { id: Number(GRANT), first_name: 'Grant' },
          ...extra,
        },
      }),
    })
    await new Promise((r) => setTimeout(r, 1800))
    const row = await one(
      `select command_id::text as command, job_id::text as job, context::text as context from public.inbound_commands
        where origin_channel = 'telegram' and actor = ${lit(GRANT)} and origin_ref like ${lit(`${chat}:%`)} order by received_at desc limit 1`,
    )
    if (typeof row.job === 'string') {
      made.push(row.job)
      // Held, not cancelled: a job called off is given no children (0625), and the proof hangs fixtures on it.
      await db.execute(
        `update public.jobs set not_before = now() + interval '1 day' where job_id = ${lit(row.job)}::uuid and state = 'queued'`,
      )
    }
    return row
  }
  const child = async (parent: string, payload = '{}', caller = '') => {
    const id = String(
      (
        await one(
          `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'verify.ask', ${lit(payload)}::jsonb, interval '0', true, null${caller})::text as c`,
        )
      ).c,
    ).match(/[0-9a-f-]{36}/)?.[0] as string
    made.push(id)
    await db.execute(
      `update public.jobs set not_before = now() + interval '1 day' where job_id = ${lit(id)}::uuid and state = 'queued'`,
    )
    return id
  }
  const project = String((await one(`select app.unnamed_project(app.test_office())::text as p`)).p)
  const ask = async (job: string, what: string) =>
    String(
      (
        await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option)
          values (${lit(project)}::uuid, ${lit(job)}::uuid, ${lit(`Run 5 live ${what} ${run}`)}, 'run5-live fixture', 'nothing happens until answered', array['Yes','No'], 'chief-of-staff', false, 'No')
          returning blocker_id::text as id`)
      ).id,
    )
  let ref0 = 700_000 + Math.floor(Math.random() * 100_000)
  const show = async (turnCommand: string, job: string, blocker: string | null) => {
    ref0 += 1
    const d = String(
      (
        await one(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref)
          values ('telegram', ${lit(`run5-live-${crypto.randomUUID()}`)}, coalesce(app.command_account((select ic.office_id from public.inbound_commands ic where ic.command_id = ${lit(turnCommand)}::uuid), ${lit(turnCommand)}::uuid), 'run5-live'), ${lit(chat)}, 'blocker', ${lit(job)}::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), ${lit(String(ref0))})
          returning delivery_id::text as id`)
      ).id,
    )
    const bound =
      blocker === null
        ? null
        : (
            await one(
              `select app.bind_delivery((select office.office_id from public.deliveries office where office.delivery_id = ${lit(d)}::uuid), ${lit(d)}::uuid, ${lit(blocker)}::uuid) as b`,
            )
          ).b
    return { id: d, ref: String(ref0), bound }
  }
  const candidates = async (command: string) =>
    (
      await db.execute(
        `select id, bindable from app.open_questions_for_reply((select office.office_id from public.inbound_commands office where office.command_id = ${lit(command)}::uuid), ${lit(command)}::uuid)`,
      )
    ).rows.map((r) => ({
      id: String((r as { id: string }).id),
      bindable: (r as { bindable: boolean }).bindable,
    }))

  // ---- #396: a message names the question it asked ------------------------------------------------------------------
  const first = await turn(`run5-live ${origins.token}: start something`)
  const rootJob = String(first.job)
  const ja = await child(rootJob, '{"proof":"a"}')
  const jb = await child(rootJob, '{"proof":"b"}')
  const qa = await ask(ja, 'A')
  const qb = await ask(jb, 'B')
  const da = await show(String(first.command), ja, qa)
  const db2 = await show(String(first.command), jb, qb)
  {
    const forA = (
      await one(
        `select app.approval_for_delivery((select dl.office_id from public.deliveries dl where dl.delivery_id = ${lit(da.id)}::uuid), ${lit(da.id)}::uuid)::text as b`,
      )
    ).b
    const forB = (
      await one(
        `select app.approval_for_delivery((select dl.office_id from public.deliveries dl where dl.delivery_id = ${lit(db2.id)}::uuid), ${lit(db2.id)}::uuid)::text as b`,
      )
    ).b
    check(
      'each message answers the question it asked (a press on A resolves A, never the newer B)',
      forA === qa && forB === qb && da.bound === true && db2.bound === true,
      `${String(forA === qa)}/${String(forB === qb)}`,
    )
    const foreign = (
      await one(
        `select app.bind_delivery((select office.office_id from public.deliveries office where office.delivery_id = ${lit(da.id)}::uuid), ${lit(da.id)}::uuid, ${lit(qb)}::uuid) as b`,
      )
    ).b
    const rename = await refused(() =>
      db.execute(
        `update public.deliveries set blocker_id = ${lit(qb)}::uuid where delivery_id = ${lit(da.id)}::uuid`,
      ),
    )
    check(
      "a delivery cannot be re-pointed at another job's question, and the name is written once",
      foreign === false && /written once|not its own/.test(rename),
      `${String(foreign)} / ${rename.slice(0, 60)}`,
    )
    const bare = await turn('yes')
    const got = await candidates(String(bare.command))
    check(
      'two questions shown and open: a bare yes is bound to neither (both named, neither bindable)',
      got.length >= 2 &&
        got.every((g) => !g.bindable) &&
        got.some((g) => g.id === qa) &&
        got.some((g) => g.id === qb),
      `${String(got.length)} rows, bindable ${got.map((g) => String(g.bindable)).join('/')}`,
    )
    const replied = await turn('yes', { reply_to_message: { message_id: Number(da.ref) } })
    const rgot = await candidates(String(replied.command))
    // The deployed worker may take the reply turn before this line looks (that is the feature working end to end):
    // either the question is still offered as the one bindable candidate, or the worker has already answered exactly
    // A - and in both cases B is untouched.
    const stateOf = async (b: string) =>
      String(
        (
          await one(
            `select state::text as s from public.blockers where blocker_id = ${lit(b)}::uuid`,
          )
        ).s,
      )
    const exactlyA =
      (rgot.length === 1 && rgot[0]?.id === qa && rgot[0]?.bindable === true) ||
      (rgot.length === 0 && (await stateOf(qa)) === 'resolved')
    check(
      'the deployed webhook records the message a reply points at, and a yes replying to A answers exactly A (B untouched)',
      String(replied.context).includes(`"reply_to_message_id": "${da.ref}"`) &&
        exactlyA &&
        (await stateOf(qb)) === 'open',
      `${String(replied.context).slice(0, 60)} / ${JSON.stringify(rgot).slice(0, 50)} / A ${await stateOf(qa)}, B ${await stateOf(qb)}`,
    )
    const fwd = await turn('yes', {
      reply_to_message: { message_id: Number(da.ref) },
      forward_origin: { type: 'user', date: 1_700_000_000 },
    })
    const fgot = await candidates(String(fwd.command))
    check(
      'a FORWARDED yes answers nothing, even when it points at the question',
      String(fwd.context).includes('"forwarded": true') && fgot.length === 0,
      `${String(fwd.context).slice(0, 60)} / ${String(fgot.length)} rows`,
    )
    const stray = await turn('yes', { reply_to_message: { message_id: 1 } })
    check(
      'a reply to a message that asked nothing answers nothing',
      (await candidates(String(stray.command))).length === 0,
      'none',
    )
  }

  // ---- #397: forwarded content is not intent ----------------------------------------------------------------------------
  {
    const own = await turn(`run5-live ${origins.token}: an ordinary instruction`)
    const fw = await turn(`run5-live ${origins.token}: a forwarded instruction`, {
      forward_origin: { type: 'user', date: 1_700_000_000 },
    })
    const ownKid = await child(String(own.job), '{"proof":"own"}')
    const fwKid = await child(String(fw.job), '{"proof":"fwd"}')
    const may = async (job: string) =>
      JSON.parse(
        String(
          (
            await one(
              `select app.may_act(${lit(project)}::uuid, 'notebook.write', ${lit(job)}::uuid)::text as v`,
            )
          ).v,
        ),
      ) as { verdict: string; asked_for?: boolean }
    const a = await may(ownKid)
    const b = await may(fwKid)
    check(
      'work from his own words is asked-for and proceeds; the same work from a forwarded message asks',
      a.verdict === 'proceed' &&
        a.asked_for === true &&
        b.verdict === 'ask' &&
        b.asked_for !== true,
      `${a.verdict}/${b.verdict}`,
    )
    const f = await one(
      `select app.job_forwarded(${lit(fwKid)}::uuid) as f, app.job_forwarded(${lit(ownKid)}::uuid) as o`,
    )
    check(
      'the forwarded root reads forwarded down its children, his own does not',
      f.f === true && f.o === false,
      JSON.stringify(f),
    )
  }

  // ---- #398: the claim, the caller, the dead parent ------------------------------------------------------------------------
  {
    const parent = await child(rootJob, '{"proof":"parent"}')
    const f = await child(rootJob, '{"proof":"asker"}')
    // Held as a worker holds it: running, leased, this attempt, this claim.
    await db.execute(
      `update public.jobs set state = 'running', leased_by = 'run5-live-w', leased_until = now() + interval '10 minutes', attempt = 1, claim_gen = 7, not_before = null where job_id = ${lit(f)}::uuid`,
    )
    const held = async (w: string, a: number, g?: number) =>
      (
        await one(
          `select app.job_held(${lit(f)}::uuid, ${lit(w)}, ${String(a)}${g === undefined ? '' : `, ${String(g)}`}) as h`,
        )
      ).h
    check(
      'held under this claim; the old three-argument question still answers (an old worker)',
      (await held('run5-live-w', 1, 7)) === true && (await held('run5-live-w', 1)) === true,
      'true/true',
    )
    // The job is woken from a bounded wait, its attempt number refunded, and claimed again: same worker, same attempt.
    await db.execute(`update public.jobs set claim_gen = 8 where job_id = ${lit(f)}::uuid`)
    check(
      'a zombie of the SAME attempt number and worker under the earlier claim is no longer held',
      (await held('run5-live-w', 1, 7)) === false && (await held('run5-live-w', 1, 8)) === true,
      'false/true',
    )
    const caller = (g: number) =>
      `, p_caller => ${lit(f)}::uuid, p_caller_worker => 'run5-live-w', p_caller_gen => ${String(g)}`
    const said = await refused(() => child(parent, '{"n":1}', caller(7)))
    const stale = await one(
      `select count(*)::int as n from public.jobs where parent_job_id = ${lit(parent)}::uuid`,
    )
    check(
      "a stale caller's enqueue_child is refused and takes no slot",
      /stale caller/.test(said) && Number(stale.n) === 0,
      `${said.slice(0, 50)} / ${String(stale.n)}`,
    )
    const live1 = await child(parent, '{"n":1}', caller(8))
    await db.execute(`update public.jobs set claim_gen = 9 where job_id = ${lit(f)}::uuid`)
    const live2 = await child(parent, '{"n":1}', caller(9))
    check(
      'a caller that retries and defers again finds the deferral it made: no duplicate job',
      live1 === live2,
      `${live1.slice(0, 8)} / ${live2.slice(0, 8)}`,
    )
    // a job called off is given no more children
    await db.execute(
      `update public.jobs set state = 'cancelled', state_reason = 'run5-live fixture' where job_id = ${lit(parent)}::uuid`,
    )
    const dead = await refused(() => child(parent, '{"n":2}'))
    check(
      'a cancelled parent is given no child, caller or not',
      /cannot be given children/.test(dead),
      dead.slice(0, 60),
    )
  }

  // ---- #391: the CI ledger --------------------------------------------------------------------------------------------------
  {
    const service = keys.find((k) => k.name === 'service_role')?.api_key ?? ''
    const anon = keys.find((k) => k.name === 'anon')?.api_key ?? ''
    const rpc = (key: string, fn: string, args: Record<string, unknown>) =>
      fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(args),
      })
    const a = await rpc(anon, 'ci_reserve', {
      p_workflow: 'voice-note',
      p_event_type: 'voice-note',
      p_reason: 'run5-live',
      p_by: 'grant',
      p_job: null,
    })
    const at = await a.text()
    check(
      'the public key cannot reserve CI minutes',
      a.status === 401 && /permission denied for function/.test(at),
      `http ${String(a.status)}`,
    )
    const r = await rpc(service, 'ci_reserve', {
      p_workflow: 'voice-note',
      p_event_type: 'voice-note',
      p_reason: 'run5-live: asked and released',
      p_by: 'verify:run5-live',
      p_job: null,
    })
    const verdict = (await r.json()) as { may?: boolean; ci_run_id?: string }
    check(
      'the service role can, and the ledger names the run to release',
      r.status === 200 && verdict.may === true && typeof verdict.ci_run_id === 'string',
      JSON.stringify(verdict).slice(0, 80),
    )
    if (typeof verdict.ci_run_id === 'string') {
      const rel = await rpc(service, 'ci_release', {
        p_ci_run: verdict.ci_run_id,
        p_why: 'run5-live: nothing was dispatched',
      })
      const rj = (await rel.json()) as { ok?: boolean }
      const row = await one(
        `select actual_minutes, outcome from public.ci_runs where ci_run_id = ${lit(verdict.ci_run_id)}::uuid`,
      )
      check(
        'and the release settles it at zero minutes, once',
        rj.ok === true && Number(row.actual_minutes) === 0 && row.outcome === 'refused_by_github',
        JSON.stringify(row),
      )
    }
  }
} finally {
  await cancelLive()
  await db.execute(
    `update public.blockers set state = 'resolved', answered_by = 'verify-operator', answered_option = decline_option, resolved_at = app.now_utc() where state = 'open' and why_needed = 'run5-live fixture'`,
  )
  // Rows modelling messages that reached the chat: never sent to anybody, removed so the witness cannot misread them.
  await db.execute(`delete from public.deliveries where dedupe_key like 'run5-live-%'`)
  await origins.release()
}

{
  const live = await one(
    `select count(*)::int as n from public.jobs where state in ('queued','running','retrying','paused') and (state_reason like '%run5-live%' or job_id = any (array[${made.length === 0 ? "'00000000-0000-0000-0000-000000000000'" : made.map(lit).join(',')}]::uuid[]))`,
  )
  check('no fixture job of this run is left live', Number(live.n) === 0, String(live.n))
  const left = await one(
    `select count(*)::int as n from public.deliveries where dedupe_key like 'run5-live-%'`,
  )
  check('no fabricated delivery row of this run is left', Number(left.n) === 0, String(left.n))
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exitCode = failed === 0 ? 0 : 1
