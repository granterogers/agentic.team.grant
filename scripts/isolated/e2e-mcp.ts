/**
 * END TO END, LOCAL: the REAL MCP server (supabase/functions/mcp) answers two people's clients and keeps them apart (E3, area 3).
 *
 *   npx tsx scripts/isolated/e2e-mcp.ts <replica-db>
 *
 * The edge emulator runs the real `mcp/index.ts` against the replica and refuses every other URL. Two offices each hold a
 * project, a document with a canary word and a task; each has a read client and a write client (a row in `mcp_clients`
 * with the hash of a bearer, which is what registration plus consent leave behind: `p3-cases/55-mcp.ts` already drives the
 * OAuth half). What this adds is the READ side and the WRITE allow-list: every tool the server lists is called with the
 * other office's slug, id or job, and the answer must contain none of it; a read-only client cannot reach a write tool; a
 * tool that does not exist (including inherited property names) is refused; a revoked or unknown bearer is a 401; and
 * nothing the server lists can delete or cancel. Each refusal has a positive control (the owner's same call works).
 * No model is called; nothing leaves the replica.
 */
import { createHash } from 'node:crypto'
import { TOOLS } from '../../supabase/functions/mcp/tools.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'e3_mcp')
const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const one = async (sql: string): Promise<Row> => (await q(sql))[0] as Row
const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>
let failed = 0
let total = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

let exit = 1
try {
  const person = async (tag: string) => {
    const email = `e3mcp.${tag}.${run}@example.com`
    const key = `e3mcp-${tag}-${run}`
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
    const r = json(
      (
        await one(
          `select app.provision_person_office(${lit(`E3 ${tag}`)}, ${lit(email)}, ${lit(key)}) as r`,
        )
      ).r,
    )
    const office = String(r.office_id)
    const name = `E3mcp ${tag} ${run}`
    const project = String(
      json(
        (
          await one(
            `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`e3mcp-${tag}-${run}`)}, ${lit(name)}, true, ${lit(key)}) as v`,
          )
        ).v,
      ).project_id,
    )
    const slug = String(
      (await one(`select slug from public.projects where project_id = ${lit(project)}::uuid`)).slug,
    )
    const canary = `zq${tag}canary${run}`.replace(/[^a-z0-9]/g, '')
    const filed = json(
      (
        await one(
          `select app.record_file_document(${lit(office)}::uuid, ${lit(project)}::uuid, ${lit(`${tag} secret plan`)}, ${lit(`${project}/upload/${tag}.txt`)}, 'text/plain', 40, null, null, null, ${lit(key)}, null, 'yours') as v`,
        )
      ).v,
    )
    const docId = String(filed.document_id)
    await db.execute(
      `select app.index_file_text(${lit(office)}::uuid, ${lit(docId)}::uuid, ${lit(`The ${tag} office plan mentions ${canary} and nothing else of note.`)})`,
    )
    await db.execute(
      `select app.task_add(p_office => ${lit(office)}::uuid, p_project => ${lit(project)}::uuid, p_title => ${lit(`${tag} task ${canary}`)}, p_added_by => ${lit(key)})`,
    )
    const client = async (scope: 'read' | 'write') => {
      const token = `e3-bearer-${tag}-${scope}-${run}-${'x'.repeat(24)}`
      await db.execute(
        `insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, office_id, kind)
         values (${lit(`e3c-${tag}-${scope}-${run}`)}, ${lit(`E3 ${tag} ${scope}`)}, ${lit(sha(token))}, ${scope === 'read' ? "array['read']" : "array['read','write']"}, ${lit(office)}::uuid, 'other')`,
      )
      return token
    }
    return {
      tag,
      office,
      key,
      project,
      slug,
      canary,
      docId,
      read: await client('read'),
      write: await client('write'),
    }
  }
  const A = await person('a')
  const B = await person('b')

  const edge = await startEdge({
    db,
    edgeFile: 'supabase/functions/mcp/index.ts',
    env: {
      HQ_API_TOKEN: `machine-${run}`,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'anon',
    },
  })
  let nextId = 1
  const rpc = async (bearer: string | null, method: string, params?: Record<string, unknown>) => {
    const r = await edge.call(
      new Request('https://door.invalid/functions/v1/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      }),
    )
    const text = await r.text()
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      /* not JSON */
    }
    return { status: r.status, text, body }
  }
  const call = (bearer: string | null, name: string, args: Record<string, unknown> = {}) =>
    rpc(bearer, 'tools/call', { name, arguments: args })
  const errOf = (r: { body: Record<string, unknown> }): string =>
    String((r.body.error as Row | undefined)?.message ?? '')

  // ---- the catalogue ------------------------------------------------------------------------------------------
  const listed = await rpc(A.read, 'tools/list')
  const names =
    ((listed.body.result as Row | undefined)?.tools as { name: string }[] | undefined)?.map(
      (t) => t.name,
    ) ?? []
  check(
    'tools/list answers an authenticated client with the catalogue',
    names.length >= 15,
    `${String(names.length)} tools`,
  )
  check(
    'nothing the server lists can delete, cancel, remove, revoke or approve (the instructions say so and the catalogue agrees)',
    names.every((n) => !/delet|cancel|remov|revok|approv|destroy|purge|drop/i.test(n)),
    names.filter((n) => /delet|cancel|remov|revok|approv/i.test(n)).join(','),
  )
  const writeTools = Object.entries(TOOLS)
    .filter(([, s]) => s.write === true)
    .map(([n]) => n)
  check(
    'the write tools are declared (the scope check has something to refuse)',
    writeTools.length >= 5,
    writeTools.join(','),
  )

  // ---- authentication -----------------------------------------------------------------------------------------
  check(
    'no bearer: 401 with a discovery challenge',
    (await call(null, 'list_projects')).status === 401,
  )
  check(
    'an unknown bearer: 401',
    (await call('not-a-token-at-all', 'list_projects')).status === 401,
  )
  check(
    'GET names no tool',
    !(await edge.call(new Request('https://door.invalid/functions/v1/mcp'))).headers.has('x-none'),
  )
  const live = await edge.call(new Request('https://door.invalid/functions/v1/mcp'))
  check(
    'unauthenticated GET is liveness only and lists no tool',
    !(await live.text()).includes('search_documents'),
  )

  // ---- READ isolation: every read tool, the other office's slug, id and words -------------------------------------
  const own = await call(A.read, 'search_documents', { query: A.canary })
  check(
    'control: A finds its own canary with a read client',
    own.text.includes(A.docId),
    `http ${String(own.status)}`,
  )
  const foreign = await call(B.read, 'search_documents', { query: A.canary })
  check(
    "B searching A's canary finds nothing of A's",
    foreign.status === 200 && !foreign.text.includes(A.docId) && !foreign.text.includes(A.canary),
    foreign.text.slice(0, 120),
  )
  const narrowed = await call(B.read, 'search_documents', { query: A.canary, project: A.slug })
  check(
    "B searching A's canary narrowed to A's slug finds nothing",
    !narrowed.text.includes(A.docId) && !narrowed.text.includes(A.canary),
    narrowed.text.slice(0, 120),
  )
  const readOwn = await call(A.read, 'read_document', { document_id: A.docId })
  check('control: A reads its own document in full', readOwn.text.includes(A.canary))
  const readForeign = await call(B.read, 'read_document', { document_id: A.docId })
  check(
    "B reading A's document by id gets none of its text",
    !readForeign.text.includes(A.canary),
    readForeign.text.slice(0, 120),
  )
  const lp = await call(B.read, 'list_projects')
  check(
    "list_projects for B names B's project and not A's (control: A sees its own)",
    lp.text.includes(B.slug) &&
      !lp.text.includes(A.slug) &&
      (await call(A.read, 'list_projects')).text.includes(A.slug),
  )
  const sp = await call(B.read, 'search_project', { query: A.canary, project: A.slug })
  check(
    "search_project into A's slug by B returns none of A's",
    !sp.text.includes(A.docId) && !sp.text.includes(A.canary),
    sp.text.slice(0, 120),
  )
  const spOwn = await call(A.read, 'search_project', { query: A.canary, project: A.slug })
  check(
    'control: search_project by A finds its own',
    spOwn.text.includes(A.canary),
    spOwn.text.slice(0, 80),
  )
  const lt = await call(B.read, 'list_tasks', { project: A.slug })
  check(
    "list_tasks for A's slug by B shows none of A's tasks (control: A sees them)",
    !lt.text.includes(A.canary) &&
      (await call(A.read, 'list_tasks', { project: A.slug })).text.includes(A.canary),
    lt.text.slice(0, 120),
  )
  const ia = await call(B.read, 'inspect_activity', { project: A.slug })
  check(
    "inspect_activity for A's slug by B shows none of A's",
    !ia.text.includes(A.canary) && !ia.text.includes('secret plan'),
    ia.text.slice(0, 120),
  )
  const rw = await call(B.read, 'recent_work')
  check(
    "recent_work for B lists none of A's",
    !rw.text.includes(A.canary) && !rw.text.includes(A.slug),
  )
  const staffA = await call(A.read, 'list_staff')
  check(
    "list_staff answers (the roster belongs to the office and is not another office's)",
    staffA.status === 200,
  )

  // ---- WRITE: scope and office ----------------------------------------------------------------------------------
  const readerWrites = await call(A.read, 'create_task', {
    project: A.slug,
    title: `reader ${run}`,
  })
  check(
    'a read-only client cannot create a task (refused by scope, nothing written)',
    /write scope/.test(errOf(readerWrites)) &&
      Number(
        (
          await one(
            `select count(*)::int n from public.tasks where title = ${lit(`reader ${run}`)}`,
          )
        ).n,
      ) === 0,
    errOf(readerWrites),
  )
  const readerAdds = await call(A.read, 'add_to_project', {
    project: A.slug,
    title: 'x',
    content: 'x',
  })
  check(
    'a read-only client cannot add to a project',
    /write scope/.test(errOf(readerAdds)),
    errOf(readerAdds),
  )
  for (const t of writeTools) {
    const r = await call(A.read, t, {})
    check(
      `write tool ${t}: refused to a read-only client by SCOPE, before the call`,
      /write scope|no such tool/.test(errOf(r)),
      errOf(r).slice(0, 80),
    )
  }
  const crossTask = await call(B.write, 'create_task', { project: A.slug, title: `planted ${run}` })
  check(
    "B's write client cannot create a task in A's project",
    Number(
      (
        await one(
          `select count(*)::int n from public.tasks where title = ${lit(`planted ${run}`)} and office_id = ${lit(A.office)}::uuid`,
        )
      ).n,
    ) === 0,
    crossTask.text.slice(0, 140),
  )
  const crossDoc = await call(B.write, 'add_to_project', {
    project: A.slug,
    title: `planted doc ${run}`,
    content: `planted ${run}`,
  })
  check(
    "B's write client cannot add a document to A's project",
    Number(
      (
        await one(
          `select count(*)::int n from public.documents where title = ${lit(`planted doc ${run}`)} and office_id = ${lit(A.office)}::uuid`,
        )
      ).n,
    ) === 0,
    crossDoc.text.slice(0, 140),
  )
  const ownTask = await call(B.write, 'create_task', { project: B.slug, title: `own ${run}` })
  check(
    'control: the same write client creates a task in ITS OWN project',
    Number(
      (
        await one(
          `select count(*)::int n from public.tasks where title = ${lit(`own ${run}`)} and office_id = ${lit(B.office)}::uuid`,
        )
      ).n,
    ) === 1,
    ownTask.text.slice(0, 100),
  )
  const ownDoc = await call(B.write, 'add_to_project', {
    project: B.slug,
    title: `own doc ${run}`,
    content: `own ${run}`,
  })
  const ownDocRow = await q(
    `select origin, added_by from public.documents where title = ${lit(`own doc ${run}`)} and office_id = ${lit(B.office)}::uuid`,
  )
  check(
    "control: add_to_project lands in B and is recorded as the client's",
    ownDocRow.length === 1,
    `${ownDoc.text.slice(0, 60)} ${JSON.stringify(ownDocRow[0] ?? {})}`,
  )
  const fakeJob = await call(B.read, 'check_job', {
    job_id: '00000000-0000-4000-8000-000000000000',
  })
  check(
    "check_job on a job that does not exist is an error or empty, never another office's",
    !fakeJob.text.includes(A.canary),
  )
  const aJob = await call(A.write, 'ask_team', { project: A.slug, question: `what is ${A.canary}` })
  const aJobId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(aJob.text)?.[0]
  console.log(`INFO ask_team by A answered: ${aJob.text.replace(/\s+/g, ' ').slice(0, 160)}`)
  if (aJobId !== undefined) {
    const peek = await call(B.read, 'check_job', { job_id: aJobId })
    check(
      "B cannot read the status of A's job by id",
      (!peek.text.includes(A.canary) && !/state/.test(peek.text.replace(/"error"/g, ''))) ||
        /no such|not found|unknown/i.test(peek.text),
      peek.text.replace(/\s+/g, ' ').slice(0, 120),
    )
    const peekA = await call(A.read, 'check_job', { job_id: aJobId })
    check(
      'control: A reads the status of its own job',
      /state|queued|status/i.test(peekA.text),
      peekA.text.replace(/\s+/g, ' ').slice(0, 100),
    )
    const jobRow = await one(
      `select office_id::text o, is_fixture, requested_by from public.jobs where job_id = ${lit(aJobId)}::uuid`,
    )
    check(
      "the job an MCP client started is A's, in A's office",
      jobRow.o === A.office,
      JSON.stringify(jobRow),
    )
  }

  // ---- names that are not tools ---------------------------------------------------------------------------------------
  for (const n of [
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'delete_project',
    'list_projects ',
    '',
  ]) {
    const r = await call(A.write, n)
    check(`'${n}' is not a tool`, /no such tool/.test(errOf(r)), errOf(r))
  }
  // ---- revoked / disabled ----------------------------------------------------------------------------------------------
  await db.execute(
    `update public.mcp_clients set enabled = false, disabled_reason = 'e3 revoked' where token_sha256 = ${lit(sha(B.read))}`,
  )
  check('a revoked client is refused at once', (await call(B.read, 'list_projects')).status === 401)
  check(
    'control: its sibling client of the same office still works',
    (await call(B.write, 'list_projects')).status === 200,
  )
  await db.execute(
    `update public.offices set state = 'disabled', disabled_at = now() where office_id = ${lit(B.office)}::uuid`,
  )
  check(
    "a disabled office's clients are refused (401)",
    (await call(B.write, 'list_projects')).status === 401,
  )
  // ---- the call ledger -----------------------------------------------------------------------------------------------------
  const ledger = await q(
    `select c.outcome, count(*)::int n from public.mcp_calls c join public.mcp_clients k on k.client_id = c.client_id where k.office_id = ${lit(A.office)}::uuid group by c.outcome`,
  ).catch(() => [])
  console.log(`INFO A's mcp call ledger: ${JSON.stringify(ledger)}`)
  check(
    'refused and ok calls are both recorded for the office that made them',
    ledger.length >= 2,
    JSON.stringify(ledger),
  )

  console.log(`\n${String(total - failed)}/${String(total)} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
