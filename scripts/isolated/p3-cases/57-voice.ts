/**
 * Voice (migration 0687), through the REAL voice and voice-token functions against the clone: the realtime briefing, a spoken
 * question and a spoken instruction are each inside the speaker's own office, from a verified login, never from the page.
 */

import { startEdge } from '../edge-emulator.ts'
import { type Ctx, lit } from '../p3-app-lib.ts'

const jwtLike = (tag: string): string =>
  `${'v'.repeat(24)}.${tag.padEnd(24, 'p')}.${'s'.repeat(24)}`

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const MACHINE = `machine-key-${run}`
  const sessA = jwtLike(`a${run}`)
  const sessB = jwtLike(`b${run}`)
  const sessX = jwtLike(`x${run}`)
  const emailOf = async (office: string) =>
    String(
      (
        await q(
          `select u.email from auth.users u join public.offices o on o.auth_user_id = u.id where o.office_id = '${office}'`,
        )
      )[0]?.email,
    )
  const ea = await emailOf(A)
  const eb = await emailOf(B)
  for (const [email, key] of [
    [ea, `a-${run}`],
    [eb, `b-${run}`],
  ] as const)
    await c.db.execute(
      `insert into public.office_members (email, owner_key, kind) values (${lit(email)}, ${lit(key)}, 'person') on conflict do nothing`,
    )
  // a login that belongs to no office at all
  const authX = `d7777777-7777-4777-8777-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`
  await c.db.execute(
    `insert into auth.users (id, email) values ('${authX}', ${lit(`novoice-${run}@example.invalid`)}) on conflict do nothing`,
  )
  await c.db.execute(
    `insert into public.office_members (email, owner_key, kind) values (${lit(`novoice-${run}@example.invalid`)}, ${lit(`x-${run}`)}, 'person') on conflict do nothing`,
  )

  const proj = async (office: string, slug: string, name: string): Promise<string> => {
    await c.db.execute(`insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(name)}, 'active', '${office}') on conflict do nothing;
      insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled)
        select p.project_id, 'upload', ${lit(`v-${run}`)}, 'x', 'source', true from public.projects p
         where p.office_id = '${office}' and p.slug = ${lit(slug)}
           and not exists (select 1 from public.project_attachments a where a.project_id = p.project_id)`)
    return String(
      (
        await q(
          `select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`,
        )
      )[0]?.project_id,
    )
  }
  const nameA = `Voiceproject ${c.canary.A}`
  const nameB = `Voiceproject ${c.canary.B}`
  const pa = await proj(A, `voice-${run}`, nameA)
  const pb = await proj(B, `voice-${run}`, nameB)

  // The OpenAI mint is stubbed at the network edge so the briefing the function BUILT can be read.
  const minted: string[] = []
  const voiceToken = await startEdge({
    db: c.db as never,
    edgeFile: 'supabase/functions/voice-token/index.ts',
    env: {
      HQ_API_TOKEN: MACHINE,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'anon',
      OPENAI_API_KEY: 'sk-fake-p3',
    },
    authUsers: { [sessA]: ea, [sessB]: eb, [sessX]: `novoice-${run}@example.invalid` },
  })
  const wrapped = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input)
    if (u.includes('api.openai.com')) {
      minted.push(String(init?.body ?? ''))
      return Response.json({ value: 'ek_stub', expires_at: 1, session: {} })
    }
    return await wrapped(input, init)
  }) as typeof fetch
  const mint = async (token: string, project?: string) => {
    minted.length = 0
    const r = await voiceToken.call(
      new Request('https://door.invalid/functions/v1/voice-token', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(project === undefined ? {} : { project }),
      }),
    )
    return { status: r.status, brief: minted[0] ?? '' }
  }

  const ma = await mint(sessA, `voice-${run}`)
  const mb = await mint(sessB, `voice-${run}`)
  c.check(
    ma.status === 200 && ma.brief.includes(nameA) && !ma.brief.includes(c.canary.B),
    "A's realtime briefing names A's project and nothing of B's",
    `status ${String(ma.status)}`,
  )
  c.check(
    mb.status === 200 && mb.brief.includes(nameB) && !mb.brief.includes(c.canary.A),
    "B's briefing names B's project and nothing of A's (same slug, different project)",
    '',
  )
  const mx = await mint(sessX)
  c.check(
    mx.status === 401 || mx.status === 403,
    "a login that resolves to no office is refused a call, not given the deployment's state",
    `status ${String(mx.status)}`,
  )
  const mk = await mint(MACHINE)
  c.check(
    mk.status === 200 && !mk.brief.includes(c.canary.A) && !mk.brief.includes(c.canary.B),
    'the machine key mints a call in the test office - which holds neither A nor B',
    `status ${String(mk.status)}`,
  )
  const mn = await voiceToken.call(
    new Request('https://door.invalid/functions/v1/voice-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  )
  c.check(mn.status === 401, 'no credential, no call', `status ${String(mn.status)}`)

  // ---- a spoken turn --------------------------------------------------------------------------------------------------------------
  const voice = await startEdge({
    db: c.db as never,
    edgeFile: 'supabase/functions/voice/index.ts',
    env: {
      HQ_API_TOKEN: MACHINE,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'anon',
    },
    authUsers: { [sessA]: ea, [sessB]: eb, [sessX]: `novoice-${run}@example.invalid` },
  })
  const turn = async (token: string, said: string, extra: Record<string, unknown> = {}) => {
    const r = await voice.call(
      new Request('https://door.invalid/functions/v1/voice/turn', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ said, session: `s-${run}`, ...extra }),
      }),
    )
    return { status: r.status, body: (await r.json()) as Record<string, unknown> }
  }
  const bridgeBefore = (
    await q(
      `select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('inbound_commands','jobs')`,
    )
  )[0]?.n
  const tA = await turn(sessA, `please summarise voice ${run} alpha`)
  const tB = await turn(sessB, `please summarise voice ${run} beta`)
  const rowA = (
    await q(
      `select office_id, project_id from public.inbound_commands where instruction = ${lit(`please summarise voice ${run} alpha`)}`,
    )
  )[0]
  const rowB = (
    await q(
      `select office_id from public.inbound_commands where instruction = ${lit(`please summarise voice ${run} beta`)}`,
    )
  )[0]
  c.check(
    tA.status === 200 && rowA?.office_id === A && tB.status === 200 && rowB?.office_id === B,
    "each spoken instruction is stored in its speaker's office",
    `${String(tA.status)}/${String(tB.status)}`,
  )
  const jobA =
    tA.body.job_id === undefined
      ? null
      : (await q(`select office_id from public.jobs where job_id = '${String(tA.body.job_id)}'`))[0]
  c.check(
    jobA === null || jobA === undefined || jobA.office_id === A,
    "and the job it becomes is A's",
    '',
  )
  // A's page names B's project (a stale tab, or an attack): the turn is not lost and does not land in B's project.
  const tCross = await turn(sessA, `cross-project turn ${run}`, { project: pb })
  const rowCross = (
    await q(
      `select office_id, project_id from public.inbound_commands where instruction = ${lit(`cross-project turn ${run}`)}`,
    )
  )[0]
  c.check(
    tCross.status === 200 && rowCross?.office_id === A && rowCross?.project_id !== pb,
    "a turn that names another office's project is kept, in A's office, and not in B's project",
    `project is ${rowCross?.project_id === pa ? "A's" : String(rowCross?.project_id).slice(0, 8)}`,
  )
  // A spoken question is answered from the speaker's own office
  const activeA = (
    await q(
      `select count(*)::int n from public.projects where office_id = '${A}' and status = 'active'`,
    )
  )[0]?.n
  const ans = await turn(sessA, 'what projects have we got')
  c.check(
    ans.status === 200 &&
      ans.body.did === 'answered' &&
      String(ans.body.speak).includes(nameA) &&
      !String(ans.body.speak).includes(c.canary.B) &&
      String(ans.body.speak).startsWith(`${String(activeA)} active`),
    "a spoken question about projects is answered from A's office only",
    String(ans.body.speak ?? ans.body.did).slice(0, 80),
  )
  const ansB = await turn(sessB, 'what projects have we got')
  c.check(
    ansB.status === 200 &&
      (ansB.body.did === 'answered'
        ? String(ansB.body.speak).includes(nameB) && !String(ansB.body.speak).includes(c.canary.A)
        : true),
    "and B's from B's",
    '',
  )
  // look-up
  const look = await voice.call(
    new Request('https://door.invalid/functions/v1/voice/look', {
      method: 'POST',
      headers: { authorization: `Bearer ${sessA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ about: nameB }),
    }),
  )
  const lj = JSON.stringify(await look.json())
  c.check(
    look.status === 200 && !lj.includes(c.canary.B) && !lj.includes(pb),
    "looking up B's project by its exact name tells A nothing about it",
    lj.slice(0, 80),
  )
  const tx = await turn(sessX, 'hello')
  c.check(
    tx.status === 401 || tx.status === 403,
    'a login with no office cannot speak a turn',
    `status ${String(tx.status)}`,
  )
  const bridgeAfter = (
    await q(
      `select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('inbound_commands','jobs')`,
    )
  )[0]?.n
  c.check(
    bridgeAfter === bridgeBefore,
    'the voice path did not use the compatibility bridge',
    `${String(bridgeBefore)} -> ${String(bridgeAfter)}`,
  )
  globalThis.fetch = wrapped
}
