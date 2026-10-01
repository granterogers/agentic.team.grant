/**
 * MCP (migration 0686), through the REAL mcp edge function against the clone: the token establishes the office; a client is
 * one office's for life; consent is by a signed-in person (their office) or the machine key (the test office).
 */

import { startEdge } from '../edge-emulator.ts'
import { type Ctx, lit } from '../p3-app-lib.ts'

const b64url = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const jwtLike = (tag: string): string =>
  `${'h'.repeat(24)}.${tag.padEnd(24, 'p')}.${'s'.repeat(24)}`

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const MACHINE = `machine-key-${run}`
  const sessA = jwtLike(`a${run}`)
  const sessB = jwtLike(`b${run}`)
  const sessNobody = jwtLike(`n${run}`)
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
  ] as const) {
    await c.db.execute(
      `insert into public.office_members (email, owner_key, kind) values (${lit(email)}, ${lit(key)}, 'person') on conflict do nothing`,
    )
  }
  const proj = async (office: string, slug: string): Promise<string> => {
    // An active project must carry an enabled attachment by commit time: both rows in ONE implicit transaction.
    await c.db.execute(`insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(`${slug} ${office.slice(0, 4)}`)}, 'active', '${office}') on conflict do nothing;
      insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled)
        select p.project_id, 'upload', ${lit(`mcp-${run}`)}, 'x', 'source', true from public.projects p
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
  const slug = `mcp-${run}`
  const pa = await proj(A, slug)
  const pb = await proj(B, slug)
  const doc = async (office: string, project: string, tag: string): Promise<string> => {
    await c.db.execute(`insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
      values ('${office}', '${project}', 'mcp', ${lit(`title ${tag}`)}, 'note', ${lit(`body ${tag}`)}, encode(sha256(convert_to(${lit(`body ${tag}`)}, 'UTF8')), 'hex'), ${String(`body ${tag}`.length)}, now(), 'p3')`)
    return String(
      (await q(`select document_id from public.documents where title = ${lit(`title ${tag}`)}`))[0]
        ?.document_id,
    )
  }
  const da = await doc(A, pa, `${c.canary.A}-${run}`)
  const db_ = await doc(B, pb, `${c.canary.B}-${run}`)

  const edge = await startEdge({
    db: c.db as never,
    edgeFile: 'supabase/functions/mcp/index.ts',
    env: {
      HQ_API_TOKEN: MACHINE,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'anon',
    },
    authUsers: { [sessA]: ea, [sessB]: eb },
  })
  const url = (p: string) => `https://door.invalid/functions/v1/mcp${p}`
  const register = async (): Promise<string> => {
    const r = await edge.call(
      new Request(url('/register'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: `P3 client ${run}`,
          redirect_uris: ['https://client.example/cb'],
        }),
      }),
    )
    return String(((await r.json()) as { client_id?: string }).client_id)
  }
  const consent = async (
    clientId: string,
    secret: string,
  ): Promise<{ status: number; token?: string | undefined; error?: string | undefined }> => {
    const verifier = `verifier-${run}-${clientId}`.padEnd(48, 'v')
    const challenge = b64url(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    )
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://client.example/cb',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
      hq_password: secret,
    })
    const a = await edge.call(
      new Request(url('/authorize'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
    )
    if (a.status !== 302) return { status: a.status }
    const code = new URL(String(a.headers.get('location'))).searchParams.get('code') ?? ''
    const t = await edge.call(
      new Request(url('/token'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: 'https://client.example/cb',
        }).toString(),
      }),
    )
    const tj = (await t.json()) as { access_token?: string; error?: string }
    return { status: t.status, token: tj.access_token, error: tj.error }
  }
  const officeOfClient = async (clientId: string) =>
    (await q(`select office_id from public.mcp_clients where client_id = ${lit(clientId)}`))[0]
      ?.office_id
  const bridgeBefore = (
    await q(
      `select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('mcp_clients','mcp_auth_codes','mcp_calls')`,
    )
  )[0]?.n
  const call = async (token: string, tool: string, args: Record<string, unknown> = {}) => {
    const r = await edge.call(
      new Request(url(''), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }),
      }),
    )
    const j = (await r.json()) as {
      result?: { content?: { text?: string }[] }
      error?: { message?: string }
    }
    return { status: r.status, text: j.result?.content?.[0]?.text ?? JSON.stringify(j.error ?? j) }
  }

  // ---- consent binds a client to the consenter's office -------------------------------------------------------------------------
  const ca = await register()
  const ta = await consent(ca, sessA)
  c.check(
    ta.status === 200 && typeof ta.token === 'string' && (await officeOfClient(ca)) === A,
    'A consenting with their own session binds the client to office A',
    `status ${String(ta.status)}`,
  )
  const cb = await register()
  const tb = await consent(cb, sessB)
  c.check(
    tb.status === 200 && (await officeOfClient(cb)) === B,
    'B consenting binds a different client to office B',
    '',
  )
  const again = await consent(ca, sessB)
  c.check(
    again.status === 400 && again.error === 'invalid_grant' && (await officeOfClient(ca)) === A,
    "a second office cannot take over A's client by consenting to it - invalid_grant, still A's",
    JSON.stringify(again),
  )
  const still = await call(String(ta.token), 'list_projects')
  c.check(
    still.status === 200 && still.text.includes(`${slug}`),
    "and A's token still works after the attempt",
    '',
  )
  const cm = await register()
  const tm = await consent(cm, MACHINE)
  const test = String((await q(`select app.test_office() o`))[0]?.o)
  c.check(
    tm.status === 200 && (await officeOfClient(cm)) === test,
    'the machine key consents only into the TEST office',
    String(await officeOfClient(cm)).slice(0, 8),
  )
  const cn = await register()
  const tn = await consent(cn, sessNobody)
  c.check(
    tn.status === 401 && (await officeOfClient(cn)) === undefined,
    'a session nobody can vouch for consents to nothing',
    `status ${String(tn.status)}`,
  )
  const cw = await register()
  const tw = await consent(cw, 'not-the-machine-key')
  c.check(tw.status === 401, 'a wrong password consents to nothing', `status ${String(tw.status)}`)

  // ---- the token decides the office; tools read only inside it -----------------------------------------------------------------------------
  const tokA = String(ta.token)
  const tokB = String(tb.token)
  const pA = await call(tokA, 'list_projects')
  const pB = await call(tokB, 'list_projects')
  c.check(
    pA.text.includes(pa) && !pA.text.includes(pb) && pB.text.includes(pb) && !pB.text.includes(pa),
    "each token lists only its own office's projects (same slug, two different projects)",
    '',
  )
  const readOwn = await call(tokA, 'read_document', { document_id: da })
  const readForeign = await call(tokA, 'read_document', { document_id: db_ })
  const readMissing = await call(tokA, 'read_document', { document_id: c.nobody() })
  c.check(
    readOwn.text.includes(c.canary.A) &&
      !readForeign.text.includes(c.canary.B) &&
      readForeign.text === readMissing.text,
    "A reads A's document; B's document answers exactly as a missing one does",
    readForeign.text.slice(0, 60),
  )
  const recent = await call(tokA, 'recent_work')
  c.check(!recent.text.includes(c.canary.B), "recent_work shows nothing of B's", '')
  // search needs the context cluster's office-scoped retrieval; assert it where it exists
  const hasSearch =
    (
      await q(
        `select count(*)::int n from pg_proc where proname = 'search_documents' and pg_get_function_arguments(oid) like 'p_office uuid%'`,
      )
    )[0]?.n === 1
  if (hasSearch) {
    const s1 = await call(tokA, 'search_documents', { query: c.canary.B })
    c.check(
      !s1.text.includes(db_) && !s1.text.includes(c.canary.B),
      "searching for B's canary by name finds nothing for A",
      '',
    )
    const s2 = await call(tokA, 'search_documents', { query: c.canary.A })
    c.check(s2.text.includes(da), "and A's own canary is found", '')
  }
  const add = await call(tokA, 'add_to_project', {
    project: slug,
    title: `mcp note ${run}`,
    content: `written by A ${run}`,
  })
  const added = (
    await q(
      `select office_id, project_id from public.documents where title = ${lit(`mcp note ${run}`)}`,
    )
  )[0]
  c.check(
    added?.office_id === A && added?.project_id === pa,
    "a document added over MCP lands in A's project of that slug, not B's",
    add.text.slice(0, 60),
  )
  // A slug of this run's own: other case files give A and B projects called only-b on purpose.
  const privateSlug = `mcp-only-b-${run}`
  const noProj = await call(tokA, 'add_to_project', {
    project: privateSlug,
    title: 'x',
    content: 'y',
  })
  await c.db.execute(
    `insert into public.projects (slug, name, status, office_id) values ('${privateSlug}', 'B only', 'paused', '${B}') on conflict do nothing`,
  )
  const noProj2 = await call(tokA, 'add_to_project', {
    project: privateSlug,
    title: 'x',
    content: 'y',
  })
  c.check(
    noProj.text === noProj2.text,
    "B's private project slug answers A exactly as a slug that exists nowhere",
    noProj2.text.slice(0, 60),
  )
  const enq = await call(tokA, 'ask_notebook', { project: slug, question: 'hello' })
  const queued = (
    await q(
      `select office_id, project_id from public.jobs where requested_by = ${lit(`mcp:${ca}`)} order by created_at desc limit 1`,
    )
  )[0]
  c.check(
    queued === undefined || (queued.office_id === A && queued.project_id === pa),
    "work enqueued over MCP is A's job in A's project",
    enq.text.slice(0, 60),
  )
  const jb = String(
    (await q(`select job_id from public.jobs where office_id = '${B}' limit 1`))[0]?.job_id ??
      c.nobody(),
  )
  const statusForeign = await call(tokA, 'check_job', { job_id: jb })
  const statusMissing = await call(tokA, 'check_job', { job_id: c.nobody() })
  c.check(
    statusForeign.text === statusMissing.text,
    "B's job id and a missing job id are indistinguishable to A's token",
    statusForeign.text.slice(0, 60),
  )

  // ---- revoke, disable, system --------------------------------------------------------------------------------------------------------------
  await c.db.execute(
    `update public.mcp_clients set enabled = false, disabled_reason = 'p3 attack' where client_id = ${lit(cb)}`,
  )
  c.check((await call(tokB, 'list_projects')).status === 401, 'a revoked client is refused', '')
  await c.db.execute(
    `update public.mcp_clients set enabled = true, disabled_reason = null where client_id = ${lit(cb)}`,
  )
  await c.db
    .execute(
      `update public.offices set state = 'disabled', disabled_at = now() where office_id = '${B}'`,
    )
    .catch(() => undefined)
  const dis = await call(tokB, 'list_projects')
  await c.db
    .execute(
      `update public.offices set state = 'active', disabled_at = null where office_id = '${B}'`,
    )
    .catch(() => undefined)
  c.check(
    dis.status === 401,
    'a client of a disabled office is refused',
    `status ${String(dis.status)}`,
  )
  const bridgeAfter = (
    await q(
      `select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('mcp_clients','mcp_auth_codes','mcp_calls')`,
    )
  )[0]?.n
  c.check(
    bridgeAfter === bridgeBefore,
    'the MCP path did not use the compatibility bridge',
    `${String(bridgeBefore)} -> ${String(bridgeAfter)}`,
  )
}
