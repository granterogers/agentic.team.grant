/**
 * The public Sample Office at the gateway (0897): the REAL hq-api and signin run against the isolated replica.
 *
 *   npx tsx scripts/isolated/sample-gateway.ts <replica-db>              # the working tree's hq-api
 *   npx tsx scripts/isolated/sample-gateway.ts <replica-db> --staged     # .out/stage/hq-api (what is deployed)
 *
 * A sample visitor holds a real session whose member is a GUEST. What this proves, with the positive control beside every
 * refusal (a suite of refusals passes against a gateway that refuses everything):
 *
 *   1. entering: signin `sample` mints a session for the sample login and nobody else, ignores any address in the request,
 *      and says "closed" while the office is open for seeding;
 *   2. reading: a guest reads the sample office, never Grant's, and never the deployment's own pages or Drive;
 *   3. changing: every action but one is refused with a sentence, and nothing was written anywhere;
 *   4. asking: `sample_say` works for a guest, ignores a client-chosen office, and is refused to everybody else;
 *   5. speaking aloud: the voice door refuses a guest;
 *   6. SABOTAGE: remove the guest allow-list from a copy of the gateway and the refusals turn red.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const staged = process.argv.includes('--staged')
const GATEWAY = staged ? '.out/stage/hq-api/index.ts' : 'supabase/functions/hq-api/index.ts'
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const TOKEN = 'isolated-hq-token'
const GRANT_EMAIL = 'grant.e.rogers@gmail.com'
const GUEST_EMAIL = `sample-${run}@example.invalid`
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const S_GUEST = `aaa.bbb.${'v'.repeat(70)}`
const VISITOR = `v${run}${'k'.repeat(20)}`
const env = {
  HQ_API_TOKEN: TOKEN,
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
}
const authUsers = { [S_GRANT]: GRANT_EMAIL, [S_GUEST]: GUEST_EMAIL }

try {
  // ---- the replica: the sample office (open, then sealed), one project in it, one of Grant's -------------------------
  // The replica is a throwaway that earlier runs of this proof wrote to: retire any sample office they left.
  await db.execute(
    `update public.offices set state = 'disabled', disabled_at = now() where kind = 'sample' and state = 'active'`,
  )
  await db.execute(
    `insert into auth.users (id, email) values (gen_random_uuid(), ${lit(GUEST_EMAIL)})`,
  )
  const S = String(
    json(
      (
        await one(
          `select app.provision_sample_office('Sample Office', ${lit(GUEST_EMAIL)}, ${lit(`sample-${run}`)}) as r`,
        )
      ).r,
    ).office_id,
  )
  const G = String((await one(`select app.operator_office()::text as o`)).o)
  const mkProject = async (office: string, name: string) =>
    String(
      json(
        (
          await one(
            `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`gw-${name.toLowerCase().replace(/\W+/g, '-')}-${run}`)}, ${lit(name)}, true) as v`,
          )
        ).v,
      ).project_id,
    )
  const SP = await mkProject(S, `Sample launch ${run}`)
  const GP = await mkProject(G, `Grant private ${run}`)
  check(
    "both projects were made (the sample one and one of Grant's)",
    /^[0-9a-f-]{36}$/.test(SP) && /^[0-9a-f-]{36}$/.test(GP),
    `${SP.slice(0, 8)} ${GP.slice(0, 8)}`,
  )
  const count = async (office: string) =>
    String(
      (
        await one(
          `select (select count(*) from public.tasks where office_id = ${lit(office)}::uuid)::text || '/' ||
                  (select count(*) from public.projects where office_id = ${lit(office)}::uuid)::text || '/' ||
                  (select count(*) from public.documents where office_id = ${lit(office)}::uuid)::text || '/' ||
                  (select count(*) from public.inbound_commands where office_id = ${lit(office)}::uuid)::text as n`,
        )
      ).n,
    )

  const gw = await startEdge({
    db,
    edgeFile: GATEWAY,
    env,
    authUsers,
  })
  const signin = await startEdge({
    db,
    edgeFile: 'supabase/functions/signin/index.ts',
    env,
    authUsers,
  })
  const call = async (bearer: string, action: string, args: Record<string, unknown> = {}) => {
    const r = await gw.call(
      new Request('https://gw.invalid/functions/v1/hq-api', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, args }),
      }),
    )
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const read = async (bearer: string, query: string) => {
    const r = await gw.call(
      new Request(`https://gw.invalid/functions/v1/hq-api?${query}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    )
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const enter = async (extra: Record<string, unknown> = {}) => {
    const r = await signin.call(
      new Request('https://gw.invalid/functions/v1/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://page.invalid' },
        body: JSON.stringify({ action: 'sample', ...extra }),
      }),
    )
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }

  // ---- 1. entering --------------------------------------------------------------------------------------------------
  const closed = await enter()
  check(
    'while the office is OPEN for seeding the visitor door says closed and mints nothing',
    closed.body.ok === false && closed.body.reason === 'closed' && signin.linksMinted.length === 0,
    `${String(closed.body.reason)}; minted ${String(signin.linksMinted.length)}`,
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)
  const entered = await enter({ email: GRANT_EMAIL, office_id: G, p_office: G })
  check(
    'once sealed a visitor is given a session, with no address, link or credential of their own',
    entered.status === 200 &&
      entered.body.ok === true &&
      entered.body.access_token === S_GUEST &&
      Object.keys(entered.body).sort().join() === 'access_token,expires_in,ok,refresh_token',
    `http ${String(entered.status)}`,
  )
  check(
    "it was minted for the SAMPLE login, and the address in the request (Grant's) was ignored",
    signin.linksMinted.length === 1 && signin.linksMinted[0] === GUEST_EMAIL,
    signin.linksMinted.join(','),
  )

  // ---- 2. reading ---------------------------------------------------------------------------------------------------
  const grantsView = await read(S_GRANT, 'section=projects')
  const guestsView = await read(S_GUEST, 'section=projects')
  const names = (b: Record<string, unknown>) => JSON.stringify(b.data ?? b)
  check(
    'CONTROL: Grant reads his own project (the read works)',
    grantsView.status === 200 && names(grantsView.body).includes(`Grant private ${run}`),
    `http ${String(grantsView.status)}`,
  )
  check(
    'a guest reads the sample office',
    guestsView.status === 200 && names(guestsView.body).includes(`Sample launch ${run}`),
    `http ${String(guestsView.status)}`,
  )
  check(
    "and never reads Grant's project",
    !names(guestsView.body).includes(`Grant private ${run}`),
    'the name is not in the answer',
  )
  for (const section of ['google', 'build', 'ci_lately', 'ci_budget', 'bots', 'drive']) {
    const r = await read(S_GUEST, `section=${section}`)
    check(
      `a guest cannot read the deployment's own page: ${section}`,
      r.status === 403,
      `http ${String(r.status)}`,
    )
  }
  const settings = await read(S_GUEST, 'section=studio_settings')
  const viewer = (
    (settings.body.data ?? {}) as { viewer?: { guest?: boolean; operator?: boolean } }
  ).viewer
  check(
    'the page is told it is looking at a guest, and not an operator',
    settings.status === 200 && viewer?.guest === true && viewer?.operator === false,
    JSON.stringify(viewer),
  )
  const gSettings = await read(S_GRANT, 'section=studio_settings')
  check(
    'and Grant is not told he is a guest',
    ((gSettings.body.data ?? {}) as { viewer?: { guest?: boolean } }).viewer?.guest === false,
    'guest: false',
  )

  // ---- 3. changing: every action but one is refused, in words, and nothing is written ------------------------------------
  const listing = await call(S_GUEST, 'no_such_action_at_all')
  const actions = (listing.body.actions as string[] | undefined) ?? []
  check(
    'the gateway lists its actions (a scan that finds nothing proves nothing)',
    actions.length > 80,
    `${String(actions.length)} actions`,
  )
  const beforeS = await count(S)
  const beforeG = await count(G)
  const open: string[] = []
  let wrongWords = 0
  for (const name of actions.filter((a) => a !== 'sample_say')) {
    const r = await call(S_GUEST, name, {
      p_project_id: SP,
      p_text: 'x',
      p_title: 'x',
      p_name: 'x',
      name: 'x',
      title: 'x',
    })
    if (r.status !== 403 || r.body.error !== 'sample_readonly')
      open.push(`${name}:${String(r.status)}`)
    else if (!/sample office/i.test(String(r.body.message))) wrongWords += 1
  }
  check(
    'EVERY action but sample_say is refused to a guest as sample_readonly',
    open.length === 0,
    open.slice(0, 6).join(' ') || `${String(actions.length - 1)} refused`,
  )
  check(
    'and each refusal says what a visitor can do about it, in words',
    wrongWords === 0,
    `${String(wrongWords)} without the sentence`,
  )
  check(
    "nothing was written to the sample office or to Grant's while a guest pressed everything",
    (await count(S)) === beforeS && (await count(G)) === beforeG,
    `${beforeS} -> ${await count(S)}; ${beforeG} -> ${await count(G)}`,
  )
  const create = await call(S_GUEST, 'create_office', { name: 'Hijack' })
  check(
    'a guest cannot create an office of their own through the pre-office door',
    create.status !== 200 || json(create.body.result ?? create.body).ok !== true,
    `http ${String(create.status)}`,
  )
  const created = Number(
    (await one(`select count(*)::int as n from public.offices where name = 'Hijack'`)).n,
  )
  check('and none exists', created === 0, String(created))

  // ---- 4. asking ----------------------------------------------------------------------------------------------------
  const asked = await call(S_GUEST, 'sample_say', {
    p_project_id: SP,
    p_text: 'Where are we on the launch?',
    p_visitor: VISITOR,
    p_office: G,
    office_id: G,
    p_by: 'grant',
  })
  const askedBody = json(asked.body.result ?? asked.body)
  check(
    'a guest can ask the sample team a question',
    asked.status === 200 && askedBody.ok === true,
    JSON.stringify(askedBody).slice(0, 80),
  )
  const cmd = (await one(
    `select office_id::text as o, actor, context ->> 'visitor' as v from public.inbound_commands where command_id = ${lit(String(askedBody.command))}::uuid`,
  )) as { o: string; actor: string; v: string }
  check(
    'it landed in the SAMPLE office, as the guest, whatever office or name the client claimed',
    cmd.o === S && cmd.actor === `sample-${run}` && cmd.v === VISITOR,
    `${cmd.o.slice(0, 8)} ${cmd.actor}`,
  )
  const mine = await read(S_GUEST, `section=sample_conversation&id=${SP}&visitor=${VISITOR}`)
  check(
    'the guest reads their own thread back',
    JSON.stringify(mine.body).includes('Where are we on the launch'),
    `http ${String(mine.status)}`,
  )
  const other = await read(
    S_GUEST,
    `section=sample_conversation&id=${SP}&visitor=${'z'.repeat(24)}`,
  )
  check(
    'and another visitor id reads none of it',
    !JSON.stringify(other.body).includes('Where are we'),
    'not in the answer',
  )
  const ordinary = await read(S_GUEST, `section=conversation&id=${SP}`)
  check(
    "the ordinary conversation section shows a guest nothing of anybody's",
    !JSON.stringify(ordinary.body).includes('Where are we'),
    'not in the answer',
  )
  const grantAsks = await call(S_GRANT, 'sample_say', {
    p_project_id: SP,
    p_text: 'hello',
    p_visitor: VISITOR,
  })
  check(
    'a person cannot use the visitor door',
    grantAsks.status === 403 && grantAsks.body.error === 'guest_only',
    `http ${String(grantAsks.status)}`,
  )
  const keyAsks = await call(TOKEN, 'sample_say', {
    p_project_id: SP,
    p_text: 'hello',
    p_visitor: VISITOR,
  })
  check(
    'the office key cannot use it either',
    keyAsks.status === 403,
    `http ${String(keyAsks.status)}`,
  )
  const grantSays = await call(S_GRANT, 'say', { p_project_id: GP, p_text: 'a real message' })
  check(
    'CONTROL: Grant can still say something in his own project',
    grantSays.status === 200 && json(grantSays.body.result ?? grantSays.body).ok === true,
    `http ${String(grantSays.status)} ${JSON.stringify(grantSays.body).slice(0, 160)}`,
  )
  const guestSays = await call(S_GUEST, 'say', {
    p_project_id: SP,
    p_text: 'around the sample door',
  })
  check(
    'a guest cannot use the ordinary say',
    guestSays.status === 403,
    `http ${String(guestSays.status)}`,
  )

  // ---- 5. speaking aloud --------------------------------------------------------------------------------------------
  const voice = await startEdge({
    db,
    edgeFile: 'supabase/functions/voice/index.ts',
    env,
    authUsers,
  })
  const talk = async (bearer: string) =>
    (
      await voice.call(
        new Request('https://gw.invalid/functions/v1/voice/turn', {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ said: 'hello', session: `call-${run}`, turn: 1 }),
        }),
      )
    ).status
  check(
    'the voice door refuses a guest (nothing metered, nothing spoken)',
    (await talk(S_GUEST)) === 401,
    `http ${String(await talk(S_GUEST))}`,
  )

  // ---- 6. SABOTAGE: take the allow-list out of a copy of the gateway --------------------------------------------------
  const text = await readFile(GATEWAY, 'utf8')
  const broken = text.replace(
    "if (kind === 'guest' && !GUEST_MAY.has(actionName)) {",
    'if (false) {',
  )
  check(
    'the sabotage landed (the guest check was in the file and is now removed)',
    broken !== text,
    `${String(text.length - broken.length)} characters removed`,
  )
  await mkdir('.out/stage/sabotage', { recursive: true })
  await writeFile('.out/stage/sabotage/index.ts', broken)
  await copyFile(
    staged ? '.out/stage/hq-api/file-text.ts' : 'src/text/file-text.ts',
    '.out/stage/sabotage/file-text.ts',
  )
  if (broken.includes("'./oauth.ts'"))
    await copyFile('src/slack/oauth.ts', '.out/stage/sabotage/oauth.ts')
  const bad = await startEdge({ db, edgeFile: '.out/stage/sabotage/index.ts', env, authUsers })
  const r = await bad.call(
    new Request('https://gw.invalid/functions/v1/hq-api', {
      method: 'POST',
      headers: { Authorization: `Bearer ${S_GUEST}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'task_add', args: { p_project_id: SP, p_title: 'smuggled' } }),
    }),
  )
  const smuggled = Number(
    (await one(`select count(*)::int as n from public.tasks where title = 'smuggled'`)).n,
  )
  check(
    'SABOTAGE: without the guest allow-list a guest CAN write (the refusals above are what stops it)',
    r.status !== 403 || smuggled > 0,
    `http ${String(r.status)}, ${String(smuggled)} task(s) written`,
  )
} catch (e) {
  console.log(`FAIL aborted - ${(e as Error).stack?.slice(0, 400) ?? String(e)}`)
  results.push(false)
}
const passed = results.filter(Boolean).length
console.log(`\n${String(passed)}/${String(results.length)} passed`)
process.exit(passed === results.length && results.length > 0 ? 0 : 1)
