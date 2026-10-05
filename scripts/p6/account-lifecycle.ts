/**
 * Account lifecycle acceptance (multi-user P6): a stranger becomes a person with a PRIVATE office, against the REAL
 * deployed gateway and database.
 *
 *   npm run verify:account-lifecycle
 *
 * Class `sample`-like: it uses only DISPOSABLE throwaway people created here, on a reserved `.invalid` domain with a
 * per-run token. It never signs in as Grant, never touches the canonical Sample Person (scripts/sample/*), and sends no
 * email: the harness stands in for the mailbox ONLY, by asking the admin API for the magic link the mail would have
 * carried and exchanging it for a session exactly as the page does. (What the mail itself does - delivery, template,
 * rate limit - is Supabase's and is deliberately not tested here; see docs/multi-user/ACCOUNT-CREATION.md.)
 *
 * Contacts nobody but Supabase. Never prints a key, a token or a session.
 */
import { randomBytes } from 'node:crypto'
import {
  act,
  check,
  db,
  ENDPOINT,
  REF,
  type Reply,
  read,
  results,
  SECOND_OFFICE,
  type Session,
} from '../p4/lib.ts'
import { apiKeys } from '../p4/provision-second-person.ts'

const RUN = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
const DOMAIN = 'lifecycle.agentic.invalid'
const person = (tag: string): { email: string; marker: string } => ({
  email: `p6-${tag}-${RUN}@${DOMAIN}`,
  marker: `Acct${tag.toUpperCase()}${RUN}`,
})
const PEOPLE = { a: person('a'), b: person('b'), c: person('c') }

const q = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string): Promise<string> => String((await q(sql))[0]?.v ?? '')
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const keys = await apiKeys()

type Login = { id: string; email: string; marker: string; session?: Session; office?: string }
const logins: Record<'a' | 'b' | 'c', Login> = {
  a: { id: '', ...PEOPLE.a },
  b: { id: '', ...PEOPLE.b },
  c: { id: '', ...PEOPLE.c },
}

const admin = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`https://${REF}.supabase.co/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: keys.service,
      Authorization: `Bearer ${keys.service}`,
      'content-type': 'application/json',
    },
  })

/** The platform's auth edge sometimes times out in plain text: that is not an answer, so wait and ask again. */
const retrying = async <T>(what: string, f: () => Promise<T>): Promise<T> => {
  let last = ''
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await f()
    } catch (e) {
      last = e instanceof Error ? e.message.slice(0, 80) : String(e)
      console.log(`  (${what}: "${last}" - attempt ${attempt} of 5, waiting)`)
      await sleep(6000)
    }
  }
  throw new Error(`${what}: ${last}`)
}

/** A login whose address is NOT yet confirmed: the stranger as signup leaves them, before they click the link. */
const createLogin = async (l: Login): Promise<void> => {
  const r = await retrying(`create ${l.email.slice(0, 6)}`, async () => {
    const res = await admin('/users', {
      method: 'POST',
      body: JSON.stringify({
        email: l.email,
        email_confirm: false,
        user_metadata: { purpose: 'p6-account-lifecycle', run: RUN, disposable: true },
      }),
    })
    const b = (await res.json()) as { id?: string; msg?: string; message?: string }
    if (!res.ok || b.id === undefined)
      throw new Error(`http ${res.status} ${b.msg ?? b.message ?? ''}`)
    return b.id
  })
  l.id = r
}

/** The session the magic link in the mail would have produced. The mailbox is the only thing replaced. */
const signIn = async (l: Login): Promise<Session> =>
  retrying(`session ${l.email.slice(0, 6)}`, async () => {
    const gen = await fetch(`https://${REF}.supabase.co/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: keys.service,
        Authorization: `Bearer ${keys.service}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'magiclink', email: l.email }),
    })
    const g = (await gen.json()) as { hashed_token?: string }
    if (g.hashed_token === undefined) throw new Error('no link generated')
    const v = await fetch(`https://${REF}.supabase.co/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: keys.anon, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token }),
    })
    const b = (await v.json()) as Partial<Session>
    if (b.access_token === undefined) throw new Error('the link did not yield a session')
    return b as Session
  })

const parse = async (r: Response): Promise<Reply> => {
  const text = await r.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: r.status, json, text }
}

const createOffice = async (token: string, body: Record<string, unknown>): Promise<Reply> =>
  parse(
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create_office', ...body }),
    }),
  )

type J = Record<string, unknown>
const asJ = (r: Reply): J => (r.json ?? {}) as J

/** What an office holds, as a number that moves if anything in it moves. */
const fingerprint = async (office: string): Promise<string> =>
  one(`select md5(concat_ws('|',
      (select count(*) from public.projects where office_id = '${office}'),
      (select string_agg(slug || status, ',' order by slug) from public.projects where office_id = '${office}'),
      (select count(*) from public.tasks where office_id = '${office}'),
      (select string_agg(title || state, ',' order by task_id) from public.tasks where office_id = '${office}'),
      (select count(*) from public.documents where office_id = '${office}'),
      (select count(*) from public.lessons where office_id = '${office}'),
      (select count(*) from public.staff_tools where office_id = '${office}'),
      (select count(*) from public.jobs where office_id = '${office}'),
      (select state from public.offices where office_id = '${office}'))) v`)

const grantOffice = await one('select app.operator_office()::text v')
const grantNames = (
  await q(
    `select name from public.projects where office_id = '${grantOffice}' and not is_fixture and char_length(name) > 6 and slug <> 'unnamed'`,
  )
).map((r) => String(r.name))
const sampleNames = (
  await q(
    `select name from public.projects where office_id = '${SECOND_OFFICE}' and char_length(name) > 6 and slug <> 'unnamed'`,
  )
).map((r) => String(r.name))

const grantBefore = await fingerprint(grantOffice)
const sampleBefore = await fingerprint(SECOND_OFFICE)
const activeBefore = Number(
  await one("select count(*) v from public.offices where kind = 'person' and state = 'active'"),
)
const openBefore = await one(
  "select value::text v from public.system_config where key = 'accounts.open_signup'",
)
const maxBefore = await one(
  "select value::text v from public.system_config where key = 'accounts.max_person_offices'",
)

const setConfig = async (key: string, jsonValue: string): Promise<void> => {
  await db.execute(
    `update public.system_config set value = '${jsonValue}'::jsonb where key = '${key}'`,
  )
}

const projectsOf = (r: Reply): { name: string; slug: string; id: string }[] => {
  const j = asJ(r)
  const list = (j.projects ?? (j.data as J | undefined)?.projects ?? j.data ?? []) as J[]
  return (Array.isArray(list) ? list : []).map((p) => ({
    name: String(p.name ?? ''),
    slug: String(p.slug ?? ''),
    id: String(p.project_id ?? p.id ?? ''),
  }))
}

try {
  console.log(`account lifecycle, run ${RUN} (three disposable people; nobody is emailed)`)
  console.log(
    `  Grant office ${grantOffice.slice(0, 8)}, Sample office ${SECOND_OFFICE.slice(0, 8)}, active person offices before: ${activeBefore}`,
  )

  // ---- the stranger: a login, no office ------------------------------------------------------------------------
  for (const l of Object.values(logins)) await createLogin(l)
  check(
    'three disposable logins exist, unconfirmed',
    logins.a.id !== '' && logins.b.id !== '' && logins.c.id !== '',
  )
  check(
    'the logins are not office members and have no office (a stranger)',
    Number(
      await one(
        `select (select count(*) from public.office_members where email like 'p6-%-${RUN}@${DOMAIN}')
              + (select count(*) from public.offices where auth_user_id in ('${logins.a.id}','${logins.b.id}','${logins.c.id}')) v`,
      ),
    ) === 0,
  )

  for (const l of Object.values(logins)) l.session = await signIn(l)
  const tok = (l: Login): string => String(l.session?.access_token)
  check(
    'the magic link confirmed their addresses',
    Number(
      await one(
        `select count(*) v from auth.users where id in ('${logins.a.id}','${logins.b.id}','${logins.c.id}') and email_confirmed_at is not null`,
      ),
    ) === 3,
  )

  // ---- a verified stranger is told they can create an office, and reads nothing ------------------------------------
  for (const k of ['a', 'b'] as const) {
    const l = logins[k]
    const r = await read(tok(l), 'projects')
    check(
      `${k}: a section read before an office is 403 no_office + can_create`,
      r.status === 403 && asJ(r).error === 'no_office' && asJ(r).can_create === true,
      `http ${r.status} ${r.text.slice(0, 60)}`,
    )
    const w = await act(tok(l), 'create_project', {
      p_name: `${l.marker} early`,
      p_connector: 'upload',
      p_ref: `early-${RUN}`,
    })
    check(
      `${k}: an ordinary write before an office is refused too`,
      w.status === 403 && asJ(w).error === 'no_office',
      `http ${w.status}`,
    )
  }
  const anyOffice = await one(
    `select count(*) v from public.offices where auth_user_id in ('${logins.a.id}','${logins.b.id}','${logins.c.id}')`,
  )
  check('nothing created an office as a side effect of those refusals', anyOffice === '0')

  // ---- the body is never trusted ---------------------------------------------------------------------------------
  const noName = await createOffice(tok(logins.a), { name: '   ' })
  check(
    'an empty name is refused in plain English, nothing created',
    noName.status === 400 &&
      asJ(noName).ok === false &&
      String(asJ(noName).error).length > 5 &&
      !/\bsql|relation|violates\b/i.test(noName.text),
    `http ${noName.status} ${noName.text.slice(0, 80)}`,
  )
  const long = await createOffice(tok(logins.a), { name: 'x'.repeat(81) })
  check(
    'an 81-character name is refused',
    long.status === 400 && asJ(long).ok === false,
    `http ${long.status}`,
  )

  // ---- create: exactly one office each; repeated and concurrent calls change nothing -------------------------------
  const first = await createOffice(tok(logins.b), {
    name: 'Bee Cafe',
    // everything below must be IGNORED: identity comes from the session
    p_auth: logins.a.id,
    auth_user_id: logins.a.id,
    email: logins.a.email,
    owner_key: 'grant',
    office_id: grantOffice,
    args: { p_office: grantOffice },
  })
  const fj = asJ(first)
  check(
    'b: create_office succeeds and says it created one',
    first.status === 200 &&
      fj.ok === true &&
      fj.created === true &&
      typeof fj.office_id === 'string',
    `http ${first.status}`,
  )
  logins.b.office = String(fj.office_id)
  const again = await createOffice(tok(logins.b), { name: 'A different name' })
  check(
    'b: a second call is idempotent (same office, created:false)',
    asJ(again).ok === true &&
      asJ(again).created === false &&
      asJ(again).office_id === logins.b.office,
  )

  const five = await Promise.all(
    [1, 2, 3, 4, 5].map(() => createOffice(tok(logins.a), { name: 'Ay Studio' })),
  )
  const made = five.filter((r) => asJ(r).created === true).length
  const oks = five.filter((r) => asJ(r).ok === true).length
  const ids = new Set(five.map((r) => String(asJ(r).office_id)))
  check(
    'a: five concurrent creates -> five ok answers, exactly one created',
    oks === 5 && made === 1,
    `ok ${oks}, created ${made}`,
  )
  check('a: all five name the same office', ids.size === 1)
  logins.a.office = [...ids][0] ?? ''
  for (const k of ['a', 'b'] as const) {
    const l = logins[k]
    const n = await one(`select count(*) v from public.offices where auth_user_id = '${l.id}'`)
    const m = await one(
      `select count(*) v from public.office_members where lower(email) = '${l.email}'`,
    )
    check(
      `${k}: exactly one office and one membership row`,
      n === '1' && m === '1',
      `offices ${n}, members ${m}`,
    )
  }

  // ---- identity: derived from the uuid, never the email, never Grant ---------------------------------------------
  for (const k of ['a', 'b'] as const) {
    const l = logins[k]
    const row = (
      await q(
        `select o.kind, o.state, o.name, o.auth_user_id::text as auth, m.owner_key, m.kind as mkind
           from public.offices o join public.office_members m on lower(m.email) = '${l.email}'
          where o.office_id = '${l.office}'`,
      )
    )[0] as J
    check(
      `${k}: owner key is derived from the auth uuid, not the email`,
      row.owner_key === `u-${l.id.replace(/-/g, '')}` &&
        !String(row.owner_key).includes('p6-') &&
        row.auth === l.id,
      String(row.owner_key).slice(0, 6),
    )
    check(
      `${k}: a person office, active, never Grant's or the Sample's`,
      row.kind === 'person' &&
        row.state === 'active' &&
        l.office !== grantOffice &&
        l.office !== SECOND_OFFICE &&
        row.mkind === 'person',
    )
    check(
      `${k}: the name was set from the body and nothing else`,
      row.name === (k === 'a' ? 'Ay Studio' : 'Bee Cafe'),
    )
    const opr = await one(`select public.deployment_operator('${String(row.owner_key)}') v`).catch(
      () => 'n/a',
    )
    check(`${k}: not an operator of the deployment`, opr === 'false' || opr === 'f', opr)
  }

  // ---- after creation the same session works, in its own office only -----------------------------------------------
  for (const k of ['a', 'b'] as const) {
    const r = await read(tok(logins[k]), 'projects')
    check(
      `${k}: the same session now reads its office (no sign-in again)`,
      r.status === 200,
      `http ${r.status}`,
    )
    check(
      // every office is born with its reserved catch-all "unnamed" project (app.unnamed_project); nothing else
      `${k}: a fresh office lists only its own catch-all project, none of Grant's or the Sample's`,
      projectsOf(r).filter((p) => p.slug !== 'unnamed').length === 0 &&
        ![...grantNames, ...sampleNames].some((n) => r.text.includes(n)),
      `${projectsOf(r).length} projects`,
    )
  }

  // ---- own data, then cross-reads --------------------------------------------------------------------------------
  const mine: Record<'a' | 'b', { slug: string; id: string; task: string }> = {
    a: { slug: '', id: '', task: `${PEOPLE.a.marker} task` },
    b: { slug: '', id: '', task: `${PEOPLE.b.marker} task` },
  }
  for (const k of ['a', 'b'] as const) {
    const l = logins[k]
    const cr = await act(tok(l), 'create_project', {
      p_name: `${l.marker} project`,
      p_connector: 'upload',
      p_ref: `p6-${k}-${RUN}`,
    })
    const res = (asJ(cr).result ?? asJ(cr)) as J
    mine[k].slug = String(res.slug ?? '')
    mine[k].id = String(res.project_id ?? '')
    check(
      `${k}: creates a project in its own office`,
      cr.status === 200 && mine[k].slug !== '',
      `http ${cr.status} ${cr.text.slice(0, 80)}`,
    )
    const t = await act(tok(l), 'task_add', { p_project: mine[k].slug, p_title: mine[k].task })
    check(`${k}: adds a task`, t.status === 200, `http ${t.status}`)
    const inDb = await one(
      `select count(*) v from public.projects where slug = '${mine[k].slug}' and office_id = '${l.office}'`,
    )
    check(`${k}: the project row carries ITS office id`, inDb === '1')
  }

  for (const [me, other] of [
    ['a', 'b'],
    ['b', 'a'],
  ] as const) {
    const l = logins[me]
    const o = logins[other]
    const own = await read(tok(l), 'projects')
    const list = projectsOf(own).filter((p) => p.slug !== 'unnamed')
    check(
      `${me}: projects list is exactly its own one (plus its own catch-all)`,
      list.length === 1 && list[0]?.name.includes(l.marker) === true,
      `${list.length}`,
    )
    check(
      `${me}: no sign of ${other}'s, Grant's or the Sample's projects`,
      !own.text.includes(o.marker) &&
        ![...grantNames, ...sampleNames].some((n) => own.text.includes(n)),
    )
    const tasks = await read(tok(l), 'portfolio_tasks')
    check(
      `${me}: task portfolio shows its task and not ${other}'s`,
      tasks.text.includes(mine[me].task) &&
        !tasks.text.includes(mine[other].task) &&
        ![...grantNames].some((n) => tasks.text.includes(n)),
    )

    // foreign ids: the answer must be indistinguishable from a made-up id and never carry the other's data
    const ghost = '00000000-0000-4000-8000-0000000000aa'
    for (const section of [
      'plane',
      'project_export',
      'history',
      'project_team',
      'project_automations',
      'assigned',
      'conversation',
    ]) {
      const foreign = await read(tok(l), section, `&id=${mine[other].id}`)
      const nothing = await read(tok(l), section, `&id=${ghost}`)
      check(
        `${me}: ${section} on ${other}'s project id leaks nothing and matches a nonexistent id`,
        !foreign.text.includes(o.marker) && foreign.status === nothing.status,
        `${foreign.status}/${nothing.status}`,
      )
    }
    const art = await read(tok(l), 'project_artifacts', `&id=${mine[other].slug}`)
    check(`${me}: project_artifacts on ${other}'s slug leaks nothing`, !art.text.includes(o.marker))

    // foreign writes by slug / id change nothing
    const rn = await act(tok(l), 'rename_project', {
      p_slug: mine[other].slug,
      p_name: `${l.marker} stolen`,
    })
    const ta = await act(tok(l), 'task_add', {
      p_project: mine[other].slug,
      p_title: `${l.marker} planted`,
    })
    const spoof = await act(tok(l), 'task_add', {
      p_project: mine[me].slug,
      p_title: `${l.marker} spoof`,
      p_office: o.office,
      office_id: o.office,
    })
    const bad = await one(
      `select (select count(*) from public.projects where office_id = '${o.office}' and name like '%${l.marker} stolen%')
            + (select count(*) from public.tasks where office_id = '${o.office}' and title like '%${l.marker}%') v`,
    )
    check(
      `${me}: writes aimed at ${other}'s project (and a spoofed office) land nowhere in ${other}'s office`,
      bad === '0',
      `renamed ${rn.status}, planted ${ta.status}, spoof ${spoof.status}`,
    )
    const spoofed = await one(
      `select count(*) v from public.tasks where office_id = '${l.office}' and title = '${l.marker} spoof'`,
    )
    check(
      `${me}: a spoofed office id was ignored (the task, if made, is in its own office)`,
      spoofed === '0' || spoofed === '1',
    )
    // operator-only
    const op = await act(tok(l), 'set_setting', { p_key: 'accounts.open_signup', p_value: false })
    check(`${me}: cannot change a deployment setting`, op.status === 403, `http ${op.status}`)
  }

  // ---- the two switches ---------------------------------------------------------------------------------------------
  try {
    await setConfig('accounts.open_signup', 'false')
    const closed = await createOffice(tok(logins.c), { name: 'Sea Co' })
    const none = await one(
      `select count(*) v from public.offices where auth_user_id = '${logins.c.id}'`,
    )
    check(
      'closed signup refuses create_office in plain English and creates nothing',
      closed.status === 400 &&
        asJ(closed).ok === false &&
        /not being opened/i.test(closed.text) &&
        none === '0',
      closed.text.slice(0, 80),
    )
    const stillA = await createOffice(tok(logins.a), { name: 'x' })
    check(
      'closing signup does not disturb an existing office (idempotent answer still ok)',
      asJ(stillA).ok === true && asJ(stillA).created === false,
    )
  } finally {
    await setConfig('accounts.open_signup', openBefore === '' ? 'true' : openBefore)
  }
  check(
    'the open_signup switch was restored',
    (await one(
      "select value::text v from public.system_config where key = 'accounts.open_signup'",
    )) === (openBefore === '' ? 'true' : openBefore),
  )
  try {
    const activeNow = await one(
      "select count(*) v from public.offices where kind = 'person' and state = 'active'",
    )
    await setConfig('accounts.max_person_offices', activeNow)
    const full = await createOffice(tok(logins.c), { name: 'Sea Co' })
    const none = await one(
      `select count(*) v from public.offices where auth_user_id = '${logins.c.id}'`,
    )
    check(
      'the ceiling on active person offices refuses at the limit and creates nothing',
      full.status === 400 && asJ(full).ok === false && none === '0',
      full.text.slice(0, 80),
    )
  } finally {
    await setConfig('accounts.max_person_offices', maxBefore === '' ? '25' : maxBefore)
  }
  check(
    'the max_person_offices switch was restored',
    (await one(
      "select value::text v from public.system_config where key = 'accounts.max_person_offices'",
    )) === (maxBefore === '' ? '25' : maxBefore),
  )
  // with the switches back, C can come in: the refusals were the switches, not the person
  const cOk = await createOffice(tok(logins.c), { name: 'Sea Co' })
  check(
    'with the switches restored the same person is admitted',
    asJ(cOk).ok === true && asJ(cOk).created === true,
    cOk.text.slice(0, 80),
  )
  logins.c.office = String(asJ(cOk).office_id)

  // ---- the machine key is not a session -----------------------------------------------------------------------------
  const machine = await createOffice(keys.service, { name: 'Robot' })
  check(
    'a service-role key cannot create an office through the gateway',
    machine.status === 401 &&
      Number(await one(`select count(*) v from public.offices where name = 'Robot'`)) === 0,
    `http ${machine.status}`,
  )
} catch (e) {
  check(
    'the harness ran to completion',
    false,
    e instanceof Error ? e.message.slice(0, 200) : String(e),
  )
} finally {
  // ---- teardown ------------------------------------------------------------------------------------------------------
  console.log('teardown')
  // restore both switches whatever happened
  await setConfig('accounts.open_signup', openBefore === '' ? 'true' : openBefore).catch(
    () => undefined,
  )
  await setConfig('accounts.max_person_offices', maxBefore === '' ? '25' : maxBefore).catch(
    () => undefined,
  )
  const ids = Object.values(logins)
    .map((l) => l.id)
    .filter((i) => i !== '')
  const slugs = (
    await q(
      `select p.slug from public.projects p join public.offices o on o.office_id = p.office_id where p.slug <> 'unnamed' and o.auth_user_id in (${ids.map((i) => `'${i}'`).join(',') || "''"})`,
    ).catch(() => [])
  ).map((r) => String(r.slug))
  let unremoved = 0
  for (const s of slugs) {
    const r = await q(`select app.project_delete('${s}', false)::text as v`).catch((e) => [
      { v: `error ${String(e).slice(0, 80)}` },
    ])
    const text = String(r[0]?.v ?? '')
    if (/error|refus|cannot|holds/i.test(text)) {
      unremoved += 1
      console.log(`  project ${s} not deleted: ${text.slice(0, 120)}`)
    }
  }
  for (const l of Object.values(logins)) {
    if (l.office !== undefined) {
      if (l.office === grantOffice || l.office === SECOND_OFFICE) {
        check("REFUSED to retire an office that is Grant's or the Sample's", false)
        continue
      }
      await q(`select app.retire_person_office('${l.office}'::uuid) v`)
    }
  }
  // an auth user cannot be deleted while an office row (never deleted) references it; try, and ban if refused
  let deleted = 0
  let banned = 0
  for (const l of Object.values(logins)) {
    if (l.id === '') continue
    const d = await admin(`/users/${l.id}`, { method: 'DELETE' }).catch(() => null)
    if (d !== null && d.ok) deleted += 1
    else {
      const b = await admin(`/users/${l.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ban_duration: '876000h' }),
      }).catch(() => null)
      if (b !== null && b.ok) banned += 1
    }
  }
  console.log(
    `  auth users: ${deleted} deleted, ${banned} banned (an office row is never deleted, so its login cannot be)`,
  )
  const idList = ids.map((i) => `'${i}'`).join(',') || "''"
  const stillActive = await one(
    `select count(*) v from public.offices where auth_user_id in (${idList}) and state = 'active'`,
  )
  check(
    'teardown left NO active office for any disposable person',
    stillActive === '0',
    `active ${stillActive}`,
  )
  const projectsLeft = await one(
    `select count(*) v from public.projects p where p.name like '%${RUN}%' and p.status = 'active'`,
  )
  check(
    'teardown left no ACTIVE disposable project',
    projectsLeft === '0',
    `active ${projectsLeft}; undeletable ${unremoved}`,
  )
  const activeAfter = Number(
    await one("select count(*) v from public.offices where kind = 'person' and state = 'active'"),
  )
  check(
    'active person offices are back to where they started',
    activeAfter === activeBefore,
    `${activeBefore} -> ${activeAfter}`,
  )
  check(
    "Grant's office is byte-for-byte unchanged",
    (await fingerprint(grantOffice)) === grantBefore,
  )
  check(
    "the Sample's office is byte-for-byte unchanged",
    (await fingerprint(SECOND_OFFICE)) === sampleBefore,
  )
  check(
    'the two switches are back to what they were',
    (await one(
      "select value::text v from public.system_config where key = 'accounts.open_signup'",
    )) === (openBefore === '' ? 'true' : openBefore) &&
      (await one(
        "select value::text v from public.system_config where key = 'accounts.max_person_offices'",
      )) === (maxBefore === '' ? '25' : maxBefore),
  )

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAILED: ${f.what} ${f.detail}`)
    process.exitCode = 1
  }
}
