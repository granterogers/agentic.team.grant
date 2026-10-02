/**
 * What the worker does to the outside world on an office's behalf (migrations 0800-0804, cluster i-integrations2):
 * Google credentials and the one resolver, Drive watching and reconciliation, NotebookLM spend and artifacts, MCP
 * discovery and the browser ledger, the task sync / reminders / calendar links, Telegram and Slack bookkeeping,
 * channel authority, and the trigger scan.
 *
 * Person A and Person B each have a project with the SAME slug; every credential-shaped value below is an obviously
 * fake canary and is never printed (a check prints a boolean, never the value it compared).
 *
 * Most of these functions live in `app` and are reached by the worker, which is the database owner, so they are driven
 * here as `postgres`. The three doors that exist in `public` (deployment_credential, hq_store_google_refresh,
 * office_of_operator) are driven as the service role, the way an edge function reaches them.
 */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B, G, T } = c
  const S = 'service_role'
  const run = Math.random().toString(36).slice(2, 8)
  const nobody = c.nobody()
  const q = (s: string) => lit(s)
  const W = (sql: string) => c.exec('postgres', sql)
  const rows = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const one = async (sql: string) => (await rows(sql))[0] ?? {}
  /** A digest of whatever a query returns, to prove a set of rows did not move. */
  const digest = async (sql: string) =>
    String(
      (
        await one(
          `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from (${sql}) x`,
        )
      ).h,
    )
  /** The answer, or the error text, so a foreign id and a nonexistent id can be compared byte for byte. */
  const say = async (sql: string) => {
    const r = await c.try_('postgres', sql)
    return r.ok ? c.json(r.value) : `ERR:${r.error}`
  }
  const same = (what: string, foreign: string, missing: string) =>
    c.check(
      foreign === missing,
      `${what}: B's id and a nonexistent id are indistinguishable to A`,
      foreign === missing
        ? foreign.slice(0, 80)
        : `${foreign.slice(0, 60)} vs ${missing.slice(0, 60)}`,
    )
  const low = (s: string) => s.toLowerCase().replaceAll('-', '_')

  const bridgeTables = `'documents','tasks','task_tombstones','notebook_spend','notebook_refusals','browser_actions','telegram_chats','signals','connection_health','mcp_providers','event_triggers'`
  const bridgeBefore = Number(
    (
      await one(
        `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name in (${bridgeTables})`,
      )
    ).n,
  )

  // ---- fixtures: a project each, the same slug, active, with a Drive folder each ---------------------------------------
  const SLUG = `itg2-${run}`
  const proj = {} as Record<'A' | 'B', string>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    proj[who] = String(
      (
        await one(
          `insert into public.projects (slug, name, status, office_id) values ('${SLUG}', 'Itg2 ${who}', 'paused', '${office}') returning project_id`,
        )
      ).project_id,
    )
  }
  const FOLDER = { A: `F-${c.canary.A}`, B: `F-${c.canary.B}` }
  const att = {} as Record<'A' | 'B', { attachment_id: string; folder_id: string }>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    att[who] = (await W(
      `select app.attach_drive_folder(${q(office)}::uuid, '${proj[who]}'::uuid, ${q(`https://drive.google.com/drive/folders/${FOLDER[who]}`)}, 'Folder ${who}')`,
    )) as { attachment_id: string; folder_id: string }
    await c.db.execute(
      `update public.projects set status = 'active' where project_id = '${proj[who]}'`,
    )
  }
  c.check(
    typeof att.A.attachment_id === 'string' && typeof att.B.attachment_id === 'string',
    'A and B each attach a Drive folder to a project both call the same slug',
    '',
  )
  // The same Drive folder watched by both offices is allowed: "already watched" is a statement about ONE office.
  const sharedUrl = `https://drive.google.com/drive/folders/SHARED-${c.canary.A}`
  const sharedA = (await W(
    `select app.attach_drive_folder(${q(A)}::uuid, '${proj.A}'::uuid, ${q(sharedUrl)}, 'Shared')`,
  )) as { attachment_id?: string; error?: string }
  const sharedB = (await W(
    `select app.attach_drive_folder(${q(B)}::uuid, '${proj.B}'::uuid, ${q(sharedUrl)}, 'Shared')`,
  )) as { attachment_id?: string; error?: string }
  c.check(
    typeof sharedA.attachment_id === 'string' && typeof sharedB.attachment_id === 'string',
    'a folder one office already watches is not refused to the other (and nothing says who holds it)',
    c.json([sharedA.error, sharedB.error]),
  )

  // ---- the folder poll is one office's -----------------------------------------------------------------------------------------
  const poll = async (office: string) =>
    c.json(
      await W(
        `select coalesce(jsonb_agg(f.folder_id), '[]'::jsonb) from app.drive_folders_to_check(${q(office)}::uuid, 0) f`,
      ),
    )
  const pollA = await poll(A)
  const pollB = await poll(B)
  c.check(
    pollA.includes(FOLDER.A) && !pollA.includes(FOLDER.B),
    "drive_folders_to_check: A is offered A's folder and never B's",
    '',
  )
  c.check(
    pollB.includes(FOLDER.B) && !pollB.includes(FOLDER.A),
    "drive_folders_to_check: B is offered B's folder and never A's",
    '',
  )

  // ---- documents: each office records its own file ---------------------------------------------------------------------------------
  const rec = async (office: string, project: string, folder: string, file: string, text: string) =>
    (await W(
      `select app.record_drive_document(${q(office)}::uuid, '${project}'::uuid, ${q(folder)}, ${q(file)}, ${q(`Title ${file}`)}, ${q(text)})`,
    )) as { ok?: boolean; document?: string; outcome?: string; error?: string }
  const a1 = await rec(A, proj.A, FOLDER.A, 'file-a1', `${c.canary.A} first`)
  const a2 = await rec(A, proj.A, FOLDER.A, 'file-a2', `${c.canary.A} second`)
  const b1 = await rec(B, proj.B, FOLDER.B, 'file-b1', `${c.canary.B} first`)
  const b2 = await rec(B, proj.B, FOLDER.B, 'file-b2', `${c.canary.B} second`)
  c.check(
    a1.ok === true && a2.ok === true && b1.ok === true && b2.ok === true && a1.outcome === 'added',
    'each office records its own Drive files',
    c.json([a1.outcome, b1.outcome]),
  )
  const ownerOf = async (id: string) =>
    String(
      (await one(`select office_id from public.documents where document_id = '${id}'`)).office_id,
    )
  c.check(
    (await ownerOf(String(a1.document))) === A && (await ownerOf(String(b1.document))) === B,
    'and each document is filed in the office that recorded it',
    '',
  )
  const docsB = () =>
    digest(
      `select document_id, title, content, state, missing_since, storage_path from public.documents where office_id = '${B}'`,
    )
  const watchB = () =>
    digest(`select * from public.drive_watch where attachment_id = '${att.B.attachment_id}'`)
  const docsA = () =>
    digest(
      `select document_id, title, content, state, missing_since, storage_path from public.documents where office_id = '${A}'`,
    )

  // record_drive_document across the line
  let dB0 = await docsB()
  same(
    'record_drive_document into a project',
    await say(
      `select app.record_drive_document(${q(A)}::uuid, '${proj.B}'::uuid, ${q(FOLDER.B)}, 'file-b1', 'Hijack', ${q('HIJACK')})`,
    ),
    await say(
      `select app.record_drive_document(${q(A)}::uuid, '${nobody}'::uuid, ${q(FOLDER.B)}, 'file-b1', 'Hijack', ${q('HIJACK')})`,
    ),
  )
  // The lookup is inside A's office, so it finds nothing of B's to update; the (office, connector, folder, file) key is
  // per-office (0862), so A's insert files A's OWN document for the same provider file. B's is not touched, and A is
  // not told that B holds it.
  const rewrite = (await W(
    `select app.record_drive_document(${q(A)}::uuid, '${proj.A}'::uuid, ${q(FOLDER.B)}, 'file-b1', 'Hijack', ${q('HIJACK-CONTENT')})`,
  )) as { ok?: boolean; document?: string; error?: string }
  c.check(
    rewrite.ok === true &&
      rewrite.document !== undefined &&
      rewrite.document !== String(b1.document) &&
      (await ownerOf(String(rewrite.document))) === A,
    "A recording B's folder and file id files A's own document for it, and does not name B's",
    c.json(rewrite).slice(0, 80),
  )
  c.check(
    (await docsB()) === dB0,
    "B's documents are byte-identical after A recorded the same provider file",
    '',
  )
  // The same, from B's side: B recording what A already holds files B's own document, and A's is unchanged.
  const dA0 = await docsA()
  const clash = (await W(
    `select app.record_drive_document(${q(B)}::uuid, '${proj.B}'::uuid, ${q(FOLDER.A)}, 'file-a1', 'Clash', ${q('CLASH')})`,
  )) as { ok?: boolean; document?: string }
  c.check(
    clash.ok === true &&
      clash.document !== undefined &&
      clash.document !== String(a1.document) &&
      (await ownerOf(String(clash.document))) === B,
    "B recording a file A already holds files B's own document, without naming A's",
    c.json(clash).slice(0, 80),
  )
  c.check((await docsA()) === dA0, "and A's documents are unchanged by it", '')
  // B has a new document of its own now: the baseline for what A must never touch moves with it.
  dB0 = await docsB()

  // attach_file_to_document across the line
  const aPath = `${proj.A}/drive/a1.pdf`
  same(
    'attach_file_to_document',
    await say(
      `select app.attach_file_to_document(${q(A)}::uuid, '${String(b1.document)}'::uuid, ${q(`${proj.B}/drive/x.pdf`)}, 'application/pdf', 10)`,
    ),
    await say(
      `select app.attach_file_to_document(${q(A)}::uuid, '${nobody}'::uuid, ${q(`${proj.B}/drive/x.pdf`)}, 'application/pdf', 10)`,
    ),
  )
  c.check((await docsB()) === dB0, "and B's document has no file on it afterwards", '')
  const attachedA = (await W(
    `select app.attach_file_to_document(${q(A)}::uuid, '${String(a1.document)}'::uuid, ${q(aPath)}, 'application/pdf', 10)`,
  )) as { ok?: boolean }
  c.check(attachedA.ok === true, "POSITIVE CONTROL: A attaches a file to A's own document", '')
  const leak = await say(
    `select app.attach_file_to_document(${q(B)}::uuid, '${String(b1.document)}'::uuid, ${q(aPath)}, 'application/pdf', 10)`,
  )
  c.check(
    !leak.includes(String(a1.document)),
    "B asking for the path A's document holds is never told A's document id",
    leak.slice(0, 80),
  )
  await c.db.execute(
    `update public.documents set storage_path = null, mime_type = null, byte_size = null where document_id = '${String(b1.document)}'`,
  )

  // drive_watch_checked / drive_reconcile / reconcile_vanished across the line
  const w0 = await watchB()
  same(
    'drive_watch_checked',
    await say(
      `select app.drive_watch_checked(${q(A)}::uuid, '${att.B.attachment_id}'::uuid, 'tok-hijack', true, null)`,
    ),
    await say(
      `select app.drive_watch_checked(${q(A)}::uuid, '${nobody}'::uuid, 'tok-hijack', true, null)`,
    ),
  )
  c.check(
    (await watchB()) === w0,
    "B's watch (cursor, failures, last_checked) is byte-identical afterwards",
    '',
  )
  await W(
    `select app.drive_watch_checked(${q(A)}::uuid, '${att.A.attachment_id}'::uuid, ${q(`tok-${run}`)}, false, null)`,
  )
  c.check(
    (
      await one(
        `select page_token from public.drive_watch where attachment_id = '${att.A.attachment_id}'`,
      )
    ).page_token === `tok-${run}`,
    "POSITIVE CONTROL: A's own watch takes its cursor",
    '',
  )
  same(
    'drive_reconcile',
    await say(
      `select app.drive_reconcile(${q(A)}::uuid, '${att.B.attachment_id}'::uuid, ${q(FOLDER.B)}, array['nothing']::text[])`,
    ),
    await say(
      `select app.drive_reconcile(${q(A)}::uuid, '${nobody}'::uuid, ${q(FOLDER.B)}, array['nothing']::text[])`,
    ),
  )
  // Both offices now hold a document in this folder (the same provider file is two documents, 0862), so A's listing
  // speaks of A's own and never names B's.
  const vanishedOwn = await say(
    `select app.reconcile_vanished(${q(A)}::uuid, 'drive', ${q(FOLDER.B)}, array['nothing']::text[])`,
  )
  c.check(
    !vanishedOwn.includes(String(b1.document)) && !vanishedOwn.includes(B),
    "reconcile_vanished over a folder both offices hold speaks only of A's own documents",
    vanishedOwn.slice(0, 80),
  )
  same(
    'reconcile_vanished (a folder nobody holds)',
    await say(
      `select app.reconcile_vanished(${q(A)}::uuid, 'drive', ${q(`no-such-${run}`)}, array['nothing']::text[])`,
    ),
    await say(
      `select app.reconcile_vanished(${q(A)}::uuid, 'drive', ${q(`no-such-2-${run}`)}, array['nothing']::text[])`,
    ),
  )
  c.check(
    (await docsB()) === dB0 && (await watchB()) === w0,
    "B's documents (missing_since, state) and watch are untouched by A's listings of B's folder",
    '',
  )
  const ownPass = (await W(
    `select app.drive_reconcile(${q(A)}::uuid, '${att.A.attachment_id}'::uuid, ${q(FOLDER.A)}, array['file-a1']::text[])`,
  )) as { ok?: boolean; marked?: number }
  c.check(
    ownPass.ok === true && Number(ownPass.marked) === 1,
    "POSITIVE CONTROL: A's own listing marks the one file of A's that is missing from it",
    c.json(ownPass).slice(0, 80),
  )

  // ---- NotebookLM: spend, allowance, refusals, artifacts ------------------------------------------------------------------------
  const unit = Number(
    (await one(`select units from public.notebook_operation_cost where operation = 'ask'`)).units,
  )
  const jobOf = async (office: string, tag: string) =>
    String(
      (
        await one(
          `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, office_id, project_id)
           values (gen_random_uuid(), 'itg2-${tag}-${run}', 'office.instruction', 'telegram:${office === A ? '1001' : '1002'}', '${office}', '${office === A ? proj.A : proj.B}')
           returning job_id`,
        )
      ).job_id,
    )
  const jobA = await jobOf(A, 'a')
  const jobB = await jobOf(B, 'b')
  const spendB0 = await digest(`select * from public.notebook_spend where office_id = '${B}'`)
  const foreignUnits = await say(
    `select app.notebook_record_spend(${q(A)}::uuid, 'ask', 'nb-x', '${proj.B}'::uuid, '${jobB}'::uuid, true)`,
  )
  const missingUnits = await say(
    `select app.notebook_record_spend(${q(A)}::uuid, 'ask', 'nb-x', '${nobody}'::uuid, '${nobody}'::uuid, true)`,
  )
  same("notebook_record_spend (a project and a job that are not A's)", foreignUnits, missingUnits)
  const lastSpend = await rows(
    `select project_id, job_id from public.notebook_spend where office_id = '${A}' order by occurred_at, spend_id`,
  )
  c.check(
    lastSpend.length === 2 && lastSpend.every((r) => r.project_id === null && r.job_id === null),
    "and the spend is A's with neither of B's references on it",
    '',
  )
  c.check(
    (await digest(`select * from public.notebook_spend where office_id = '${B}'`)) === spendB0,
    "B's ledger is byte-identical",
    '',
  )
  await W(
    `select app.notebook_record_spend(${q(A)}::uuid, 'ask', 'nb-a', '${proj.A}'::uuid, '${jobA}'::uuid, true)`,
  )
  const ownRef = await one(
    `select project_id::text p, job_id::text j from public.notebook_spend where office_id = '${A}' and notebook_ref = 'nb-a'`,
  )
  c.check(
    ownRef.p === proj.A && ownRef.j === jobA,
    "POSITIVE CONTROL: A's own project and job are recorded against its spend",
    '',
  )
  for (let i = 0; i < 3; i++) await W(`select app.notebook_record_spend(${q(B)}::uuid, 'ask')`)
  const allowA = (await W(`select app.notebook_allowance(${q(A)}::uuid, 'ask')`)) as {
    window_spent: number
    allowed: boolean
    blocked_until: string | null
  }
  const allowB = (await W(`select app.notebook_allowance(${q(B)}::uuid, 'ask')`)) as {
    window_spent: number
  }
  c.check(
    allowA.window_spent === 3 * unit && allowB.window_spent === 3 * unit,
    "each office's allowance counts its own spend only (A: 3 asks of its own, B: 3 of its own, not 6)",
    `${String(allowA.window_spent)} ${String(allowB.window_spent)} unit=${String(unit)}`,
  )
  const resets = new Date(Date.now() + 3_600_000).toISOString()
  await W(
    `select app.notebook_record_refusal(${q(B)}::uuid, 'ask', ${q(`refused ${c.canary.B}`)}, ${q(resets)}::timestamptz)`,
  )
  const blockedB = (await W(`select app.notebook_allowance(${q(B)}::uuid, 'ask')`)) as {
    allowed: boolean
    blocked_until: string | null
  }
  const stillA = (await W(`select app.notebook_allowance(${q(A)}::uuid, 'ask')`)) as {
    allowed: boolean
    blocked_until: string | null
  }
  c.check(
    blockedB.allowed === false && blockedB.blocked_until !== null,
    "POSITIVE CONTROL: Google's dated refusal blocks the office that was refused",
    '',
  )
  c.check(
    stillA.allowed === true && stillA.blocked_until === null,
    "and does not block A (B's refusal is B's)",
    '',
  )
  const cfg = async () =>
    c.json(
      await rows(
        `select key, value from public.system_config where key in ('notebook.window_units','notebook.ceiling_is_measured') order by key`,
      ),
    )
  const cfg0 = await cfg()
  const lowerA = (await W(
    `select app.notebook_record_refusal(${q(A)}::uuid, 'ask', 'a refusal', null)`,
  )) as { ceiling_lowered_to: number | null }
  c.check(
    lowerA.ceiling_lowered_to === null && (await cfg()) === cfg0,
    "a refusal in an ordinary office is recorded but cannot lower the deployment's shared ceiling",
    '',
  )
  await W(`select app.notebook_record_spend(${q(G)}::uuid, 'ask')`)
  const lowerG = (await W(
    `select app.notebook_record_refusal(${q(G)}::uuid, 'ask', 'a refusal', null)`,
  )) as { ceiling_lowered_to: number | null }
  c.check(
    lowerG.ceiling_lowered_to !== null && (await cfg()) !== cfg0,
    "POSITIVE CONTROL: the same refusal in the deployment's own office does lower the ceiling",
    '',
  )
  // put the shared configuration back
  for (const r of JSON.parse(cfg0) as { key: string; value: unknown }[])
    await c.db.execute(
      `update public.system_config set value = ${q(JSON.stringify(r.value))}::jsonb where key = ${q(r.key)}`,
    )

  const artB0 = () =>
    digest(
      `select a.* from public.artifacts a join public.projects p using (project_id) where p.office_id = '${B}'`,
    )
  const ab0 = await artB0()
  same(
    'record_notebook_artifact into a project',
    await say(
      `select app.record_notebook_artifact(${q(A)}::uuid, '${proj.B}'::uuid, ${q(`nb-${run}`)}, 'x1', 'audio', 'T')`,
    ),
    await say(
      `select app.record_notebook_artifact(${q(A)}::uuid, '${nobody}'::uuid, ${q(`nb-${run}`)}, 'x1', 'audio', 'T')`,
    ),
  )
  c.check((await artB0()) === ab0, "B has no artifact adopted by A's call", '')
  const adoptA = (await W(
    `select app.record_notebook_artifact(${q(A)}::uuid, '${proj.A}'::uuid, ${q(`nb-${run}`)}, 'x1', 'audio', 'An overview')`,
  )) as { ok?: boolean; outcome?: string }
  c.check(
    adoptA.ok === true && adoptA.outcome === 'adopted',
    "POSITIVE CONTROL: A adopts an artifact into A's project",
    '',
  )
  const aArt0 = await digest(
    `select a.* from public.artifacts a join public.projects p using (project_id) where p.office_id = '${A}'`,
  )
  const clashArt = await say(
    `select app.record_notebook_artifact(${q(B)}::uuid, '${proj.B}'::uuid, ${q(`nb-${run}`)}, 'x1', 'audio', 'Mine now')`,
  )
  c.check(
    clashArt.includes('could not be recorded') &&
      (await digest(
        `select a.* from public.artifacts a join public.projects p using (project_id) where p.office_id = '${A}'`,
      )) === aArt0,
    "B adopting the artifact A already holds is refused in the usual words and A's row is unchanged",
    clashArt.slice(0, 80),
  )

  // ---- MCP discovery, the browser ledger ------------------------------------------------------------------------------------------------
  const reg = {} as Record<'A' | 'B', { provider?: string }>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const)
    reg[who] = (await c.exec(
      S,
      `select public.register_mcp_provider(${q(office)}, 'itg2prov', 'https://itg2.example.test/mcp', 'Itg2 ${who}')`,
    )) as { provider?: string }
  const provB0 = () =>
    digest(`select * from public.mcp_providers where provider_id = '${reg.B.provider}'`)
  const toolsB0 = () =>
    digest(`select * from public.mcp_discovered_tools where provider_id = '${reg.B.provider}'`)
  const pb = await provB0()
  const tb = await toolsB0()
  const toolsJson = q(
    JSON.stringify([{ name: `look_${low(c.canary.A)}`, description: 'Do a lookup' }]),
  )
  same(
    'record_mcp_tools',
    await say(
      `select app.record_mcp_tools(${q(A)}::uuid, '${reg.B.provider}'::uuid, ${toolsJson}::jsonb)`,
    ),
    await say(`select app.record_mcp_tools(${q(A)}::uuid, '${nobody}'::uuid, ${toolsJson}::jsonb)`),
  )
  c.check(
    (await provB0()) === pb && (await toolsB0()) === tb,
    "B's provider (probe stamp) and its discovered tools are byte-identical",
    '',
  )
  const ownTools = (await W(
    `select app.record_mcp_tools(${q(A)}::uuid, '${reg.A.provider}'::uuid, ${toolsJson}::jsonb)`,
  )) as { ok?: boolean; seen?: number }
  c.check(
    ownTools.ok === true && ownTools.seen === 1,
    "POSITIVE CONTROL: A records the tools of A's own provider",
    '',
  )

  const jar = (who: string) =>
    JSON.stringify([
      { name: 's', value: `FAKE-NOT-A-REAL-COOKIE-${who}-${run}`, domain: 'itg2.example.com' },
    ])
  const sess = {} as Record<'A' | 'B', string>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    const e = (await c.exec(
      S,
      `select public.browser_session_establish(${q(office)}, '${proj[who]}', 'itg2.example.com', ${q(`${c.canary[who]} read the prices`)}, ${q(jar(who))})`,
    )) as { session_id?: string }
    sess[who] = String(e.session_id)
  }
  const actionsB0 = () => digest(`select * from public.browser_actions where office_id = '${B}'`)
  const sessB0 = () =>
    digest(`select * from public.browser_sessions where session_id = '${sess.B}'`)
  const ab = await actionsB0()
  const sb = await sessB0()
  const noted = (await W(
    `select app.browser_note(${q(A)}::uuid, '${sess.B}'::uuid, '${jobB}'::uuid, 'read', 'https://x.example.test', true, 'looked', null, 5)`,
  )) as { ok?: boolean; action_id?: string }
  const notedMissing = (await W(
    `select app.browser_note(${q(A)}::uuid, '${nobody}'::uuid, '${nobody}'::uuid, 'read', 'https://x.example.test', true, 'looked', null, 5)`,
  )) as { ok?: boolean; action_id?: string }
  const shape = async (id: string | undefined) =>
    c.json(
      await one(
        `select office_id, session_id, job_id, project_id from public.browser_actions where action_id = '${String(id)}'`,
      ),
    )
  const nShape = await shape(noted.action_id)
  const mShape = await shape(notedMissing.action_id)
  same("browser_note (a session and job that are not A's)", nShape, mShape)
  c.check(
    nShape.includes(A) && !nShape.includes(sess.B) && !nShape.includes(jobB),
    "and the ledger row is A's, naming neither B's session nor B's job",
    '',
  )
  c.check(
    (await sessB0()) === sb && (await actionsB0()) === ab,
    "B's session (last_alive_at) and B's ledger are byte-identical afterwards",
    '',
  )
  await W(
    `select app.browser_note(${q(A)}::uuid, '${sess.A}'::uuid, '${jobA}'::uuid, 'read', 'https://x.example.test/a', true, 'ok', null, 5)`,
  )
  const ownNote = await one(
    `select session_id::text s, job_id::text j from public.browser_actions where office_id = '${A}' and url = 'https://x.example.test/a'`,
  )
  c.check(
    ownNote.s === sess.A && ownNote.j === jobA,
    "POSITIVE CONTROL: A's own session and job are on its ledger row",
    '',
  )
  same(
    'browser_session_expired',
    await say(`select app.browser_session_expired(${q(A)}::uuid, '${sess.B}'::uuid, 'gone')`),
    await say(`select app.browser_session_expired(${q(A)}::uuid, '${nobody}'::uuid, 'gone')`),
  )
  c.check((await sessB0()) === sb, "B's session is still signed in", '')
  const exp = (await W(
    `select app.browser_session_expired(${q(A)}::uuid, '${sess.A}'::uuid, 'gone')`,
  )) as { ok?: boolean }
  c.check(exp.ok === true, "POSITIVE CONTROL: A signs out A's own session", '')
  const docsB1 = await docsB()
  same(
    'record_browser_page',
    await say(
      `select app.record_browser_page(${q(A)}::uuid, '${proj.B}'::uuid, 'https://p.example.test/1', 'T', 'words', null)`,
    ),
    await say(
      `select app.record_browser_page(${q(A)}::uuid, '${nobody}'::uuid, 'https://p.example.test/1', 'T', 'words', null)`,
    ),
  )
  c.check((await docsB()) === docsB1, "no page was kept in B's project", '')
  const kept = (await W(
    `select app.record_browser_page(${q(A)}::uuid, '${proj.A}'::uuid, 'https://p.example.test/1', 'T', ${q(`${c.canary.A} words`)}, '${jobB}'::uuid)`,
  )) as { ok?: boolean; document_id?: string }
  const producer = await one(
    `select office_id::text o, produced_by_job::text j from public.documents where document_id = '${String(kept.document_id)}'`,
  )
  c.check(
    kept.ok === true && producer.o === A && producer.j === null,
    "POSITIVE CONTROL: A keeps a page in A's project, and B's job is not recorded as its producer",
    '',
  )

  // ---- the task sync, reminders, undo, calendar links ---------------------------------------------------------------------------
  const task = {} as Record<'A' | 'B', string>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    task[who] = String(
      (
        (await c.exec(
          S,
          `select public.my_task_add(${q(office)}, ${q(`${c.canary[who]} sync me`)})`,
        )) as { id: string }
      ).id,
    )
  }
  const tomb = {} as Record<'A' | 'B', string>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    tomb[who] = String(
      (
        await one(
          `insert into public.task_tombstones (office_id, task_id, title, links)
           values ('${office}', gen_random_uuid(), ${q(`${c.canary[who]} deleted`)}, '[{"provider":"vikunja","external_id":"${who}${run}"}]'::jsonb) returning task_id`,
        )
      ).task_id,
    )
  }
  const pushA = c.json(await W(`select app.tasks_to_push(${q(A)}::uuid, 'vikunja')`))
  const pushB = c.json(await W(`select app.tasks_to_push(${q(B)}::uuid, 'vikunja')`))
  c.check(
    pushA.includes(c.canary.A) &&
      pushA.includes(tomb.A) &&
      !pushA.includes(c.canary.B) &&
      !pushA.includes(tomb.B),
    "tasks_to_push: A is offered A's task and A's tombstone, and neither of B's",
    '',
  )
  c.check(
    pushB.includes(c.canary.B) &&
      pushB.includes(tomb.B) &&
      !pushB.includes(c.canary.A) &&
      !pushB.includes(tomb.A),
    "tasks_to_push: B is offered B's task and B's tombstone, and neither of A's",
    '',
  )
  const linksB0 = () => digest(`select * from public.task_links where task_id = '${task.B}'`)
  const lb = await linksB0()
  same(
    'task_pushed',
    await say(
      `select app.task_pushed(${q(A)}::uuid, '${task.B}'::uuid, 'vikunja', 'ext-${run}-x', 1)`,
    ),
    await say(
      `select app.task_pushed(${q(A)}::uuid, '${nobody}'::uuid, 'vikunja', 'ext-${run}-x', 1)`,
    ),
  )
  same(
    'task_push_failed',
    await say(`select app.task_push_failed(${q(A)}::uuid, '${task.B}'::uuid, 'vikunja', 'nope')`),
    await say(`select app.task_push_failed(${q(A)}::uuid, '${nobody}'::uuid, 'vikunja', 'nope')`),
  )
  c.check((await linksB0()) === lb, "B's task has no link row after A pushed and failed it", '')
  const pushedA = (await W(
    `select app.task_pushed(${q(A)}::uuid, '${task.A}'::uuid, 'vikunja', 'ext-${run}-a', 1)`,
  )) as { ok?: boolean }
  const offeredIds = async (office: string) =>
    (
      (await W(`select app.tasks_to_push(${q(office)}::uuid, 'vikunja')`)) as {
        upserts: { id: string }[]
      }
    ).upserts.map((u) => u.id)
  c.check(
    pushedA.ok === true && !(await offeredIds(A)).includes(task.A),
    "POSITIVE CONTROL: A's own push is recorded and the task is no longer offered",
    '',
  )
  c.check(
    (await offeredIds(B)).includes(task.B),
    "and B's task, which A tried to push, is still offered to B",
    '',
  )
  const aLink0 = await digest(`select * from public.task_links where task_id = '${task.A}'`)
  const clashPush = await say(
    `select app.task_pushed(${q(B)}::uuid, '${task.B}'::uuid, 'vikunja', 'ext-${run}-a', 1)`,
  )
  c.check(
    clashPush.includes('could not be recorded') &&
      (await digest(`select * from public.task_links where task_id = '${task.A}'`)) === aLink0,
    "B pushing under the external id A's task holds is refused in the usual words, and A's link is unchanged",
    clashPush.slice(0, 80),
  )
  const tombB0 = await digest(`select * from public.task_tombstones where office_id = '${B}'`)
  same(
    'task_delete_pushed',
    await say(`select app.task_delete_pushed(${q(A)}::uuid, '${tomb.B}'::uuid, 'vikunja')`),
    await say(`select app.task_delete_pushed(${q(A)}::uuid, '${nobody}'::uuid, 'vikunja')`),
  )
  c.check(
    (await digest(`select * from public.task_tombstones where office_id = '${B}'`)) === tombB0,
    "B's tombstone is still owed to the provider",
    '',
  )
  await W(`select app.task_delete_pushed(${q(A)}::uuid, '${tomb.A}'::uuid, 'vikunja')`)
  c.check(
    (
      await one(
        `select cleared_at is not null as c from public.task_tombstones where task_id = '${tomb.A}'`,
      )
    ).c === true,
    "POSITIVE CONTROL: A clears A's own tombstone",
    '',
  )

  // reminders
  const remind = {} as Record<'A' | 'B', string>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const)
    remind[who] = String(
      (
        (await c.exec(
          S,
          `select public.my_task_add(${q(office)}, ${q(`${c.canary[who]} remind`)}, p_remind_at => now() - interval '5 minutes')`,
        )) as { id: string }
      ).id,
    )
  const dueA = c.json(await W(`select app.reminders_due(${q(A)}::uuid)`))
  c.check(
    dueA.includes(c.canary.A) && !dueA.includes(c.canary.B),
    "reminders_due: A is told of A's reminder and never B's",
    '',
  )
  const sentForeign = await say(
    `select app.reminders_sent(${q(A)}::uuid, array['${remind.B}']::uuid[])`,
  )
  c.check(
    sentForeign === '0' &&
      (await one(`select reminded_at is null as n from public.tasks where task_id = '${remind.B}'`))
        .n === true,
    "reminders_sent: A cannot mark B's reminder as sent (B will still be told)",
    sentForeign,
  )
  c.check(
    (await say(`select app.reminders_sent(${q(A)}::uuid, array['${nobody}']::uuid[])`)) ===
      sentForeign,
    'and a foreign id and a nonexistent id answer the same',
    '',
  )
  const sentOwn = await say(
    `select app.reminders_sent(${q(A)}::uuid, array['${remind.A}']::uuid[])`,
  )
  c.check(sentOwn === '1', "POSITIVE CONTROL: A marks A's own reminder sent", sentOwn)

  // undo
  await W(
    `select app.task_add(p_office => ${q(B)}::uuid, p_project => '${proj.B}'::uuid, p_title => ${q(`${c.canary.B} from a job`)}, p_job => '${jobB}'::uuid)`,
  )
  await W(
    `select app.task_add(p_office => ${q(A)}::uuid, p_project => '${proj.A}'::uuid, p_title => ${q(`${c.canary.A} from a job`)}, p_job => '${jobA}'::uuid)`,
  )
  const tasksOfJobB = () => digest(`select * from public.tasks where job_id = '${jobB}'`)
  const tj = await tasksOfJobB()
  same(
    'undo_tasks_from_job',
    await say(`select app.undo_tasks_from_job(${q(A)}::uuid, '${jobB}'::uuid)`),
    await say(`select app.undo_tasks_from_job(${q(A)}::uuid, '${nobody}'::uuid)`),
  )
  c.check((await tasksOfJobB()) === tj, "the tasks B's job made are all still there", '')
  const undoOwn = (await W(`select app.undo_tasks_from_job(${q(A)}::uuid, '${jobA}'::uuid)`)) as {
    removed?: number
  }
  c.check(
    undoOwn.removed === 1,
    "POSITIVE CONTROL: A undoes the tasks A's own job made",
    c.json(undoOwn),
  )

  // calendar links
  const linkSql = (office: string, task: string, event: string) =>
    `select app.calendar_link_set(${q(office)}::uuid, '${task}'::uuid, 'primary', ${q(event)}, 'hash')`
  await W(linkSql(B, task.B, `evB${run}`))
  const calB = () => digest(`select * from public.task_calendar_links where task_id = '${task.B}'`)
  const cb = await calB()
  same(
    'calendar_link_set',
    await say(linkSql(A, task.B, `evX${run}`)),
    await say(linkSql(A, nobody, `evX${run}`)),
  )
  await W(`select app.calendar_link_clear(${q(A)}::uuid, '${task.B}'::uuid)`)
  c.check((await calB()) === cb, "B's calendar link is unchanged by A's set and A's clear", '')
  await W(linkSql(A, task.A, `evA${run}`))
  c.check(
    Number(
      (
        await one(
          `select count(*)::int n from public.task_calendar_links where task_id = '${task.A}'`,
        )
      ).n,
    ) === 1,
    "POSITIVE CONTROL: A links A's own task to a calendar event",
    '',
  )
  await W(`select app.calendar_link_clear(${q(A)}::uuid, '${task.A}'::uuid)`)
  c.check(
    Number(
      (
        await one(
          `select count(*)::int n from public.task_calendar_links where task_id = '${task.A}'`,
        )
      ).n,
    ) === 0,
    'and clears it',
    '',
  )

  // ---- Telegram and Slack bookkeeping ----------------------------------------------------------------------------------------------------
  const chat = {
    A: String(910_000_000 + Math.floor(Math.random() * 1_000_000)),
    B: String(920_000_000 + Math.floor(Math.random() * 1_000_000)),
  }
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const)
    await c.db.execute(
      `insert into public.telegram_chats (office_id, chat_id, chat_type, bot_id, subject) values ('${office}', '${chat[who]}', 'private', 'itg2bot', ${q(`itg2-${who}`)})`,
    )
  const chatB0 = () => digest(`select * from public.telegram_chats where office_id = '${B}'`)
  const cB = await chatB0()
  const markForeign = await say(
    `select app.mark_telegram_undeliverable(${q(A)}::uuid, '${chat.B}', 'blocked', 'itg2bot')`,
  )
  const markMissing = await say(
    `select app.mark_telegram_undeliverable(${q(A)}::uuid, '9999999', 'blocked', 'itg2bot')`,
  )
  c.check(
    markForeign === 'false' && markForeign === markMissing && (await chatB0()) === cB,
    "mark_telegram_undeliverable: A cannot switch off B's chat, and a foreign chat and a missing one answer the same",
    markForeign,
  )
  c.check(
    (await say(
      `select app.mark_telegram_undeliverable(${q(A)}::uuid, '${chat.A}', 'blocked', 'itg2bot')`,
    )) === 'true',
    "POSITIVE CONTROL: A switches off A's own chat",
    '',
  )

  const team = { A: `T0A${run.toUpperCase()}XX`, B: `T0B${run.toUpperCase()}XX` }
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const)
    await c.db.execute(
      `insert into public.slack_workspaces (office_id, team_id, team_name, bot_user_id) values ('${office}', '${team[who]}', 'itg2', 'U0BOT')`,
    )
  const chan = {
    A: `C0A${run.toUpperCase()}AA`,
    B: `C0B${run.toUpperCase()}BB`,
    lobbyB: `C0L${run.toUpperCase()}LB`,
  }
  await c.db.execute(
    `insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name) values ('${chan.A}', '${team.A}', '${proj.A}', 'room-a'), ('${chan.B}', '${team.B}', '${proj.B}', 'room-b')`,
  )
  await c.db.execute(
    `insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, purpose) values ('${chan.lobbyB}', '${team.B}', null, 'lobby-b', 'general')`,
  )
  const mapB0 = () =>
    digest(
      `select * from public.slack_channel_map where channel_id in ('${chan.B}','${chan.lobbyB}')`,
    )
  const mb = await mapB0()
  for (const ch of [chan.B, chan.lobbyB]) {
    c.check(
      (await say(`select app.record_slack_channel_rename(${q(A)}::uuid, '${ch}', 'hijacked')`)) ===
        'false' &&
        (await say(`select app.record_slack_membership(${q(A)}::uuid, '${ch}', false)`)) ===
          'false',
      `a Slack channel of B's (${ch === chan.B ? 'a project room' : 'a lobby with no project'}) cannot be renamed or marked left by A`,
      '',
    )
  }
  same(
    'record_slack_channel_rename',
    await say(`select app.record_slack_channel_rename(${q(A)}::uuid, '${chan.B}', 'hijacked')`),
    await say(`select app.record_slack_channel_rename(${q(A)}::uuid, 'C0NOSUCH999', 'hijacked')`),
  )
  c.check((await mapB0()) === mb, "B's channel map rows are byte-identical afterwards", '')
  c.check(
    (await say(
      `select app.record_slack_channel_rename(${q(A)}::uuid, '${chan.A}', 'room-a-renamed')`,
    )) === 'true' &&
      (await say(`select app.record_slack_membership(${q(A)}::uuid, '${chan.A}', false)`)) ===
        'true',
    "POSITIVE CONTROL: A renames A's own room and notes the bot left it",
    '',
  )
  c.check(
    (await say(
      `select app.record_slack_channel_rename(${q(B)}::uuid, '${chan.lobbyB}', 'lobby-b2')`,
    )) === 'true',
    "POSITIVE CONTROL: B renames B's lobby (a channel with no project, owned through its workspace)",
    '',
  )

  // ---- channel authority: a permission to create a permanent channel, never usable across offices -------------------------------------
  // A person who makes projects in each office (a member the office admitted, which is what makes a label a person).
  const by = { A: `itg2-person-a-${run}`, B: `itg2-person-b-${run}` }
  for (const who of ['A', 'B'] as const)
    await c.db.execute(
      `insert into public.office_members (email, note, owner_key, kind) values (${q(`${by[who]}@example.com`)}, 'itg2 cases', ${q(by[who])}, 'person') on conflict do nothing`,
    )
  const authRows = (office: string) =>
    digest(
      `select a.* from public.slack_channel_authority a join public.projects p using (project_id) where p.office_id = '${office}'`,
    )
  const au0 = await authRows(B)
  same(
    "record_channel_authority (a project that is not A's)",
    await say(
      `select app.record_channel_authority(${q(A)}::uuid, '${proj.B}'::uuid, ${q(by.A)}, null)`,
    ),
    await say(
      `select app.record_channel_authority(${q(A)}::uuid, '${nobody}'::uuid, ${q(by.A)}, null)`,
    ),
  )
  c.check((await authRows(B)) === au0, "no authority was created for B's project by A", '')
  const grant = (await W(
    `select app.record_channel_authority(${q(A)}::uuid, '${proj.A}'::uuid, ${q(by.A)}, null)`,
  )) as { ok?: boolean }
  c.check(
    grant.ok === true,
    "POSITIVE CONTROL: A, a person, authorises the channel of A's own project",
    c.json(grant),
  )
  const readAuth = (office: string, project: string) =>
    say(`select app.channel_authority(${q(office)}::uuid, '${project}'::uuid)`)
  c.check(
    (await readAuth(A, proj.A)).includes(by.A) && (await readAuth(B, proj.A)) === 'null',
    "channel_authority: A reads A's authority; B reading it for A's project is told there is none",
    '',
  )
  c.check(
    (await readAuth(B, proj.A)) === (await readAuth(B, nobody)),
    'and an authority held by another office reads exactly like no authority at all',
    '',
  )
  // the spend: the job that spends it has to be the office's, and so does the project
  const aAuth0 = await authRows(A)
  const spends = {
    byB: await say(
      `select app.consume_channel_authority(${q(B)}::uuid, '${proj.A}'::uuid, '${jobB}'::uuid)`,
    ),
    byAWithBJob: await say(
      `select app.consume_channel_authority(${q(A)}::uuid, '${proj.A}'::uuid, '${jobB}'::uuid)`,
    ),
    byAWithNoJob: await say(
      `select app.consume_channel_authority(${q(A)}::uuid, '${proj.A}'::uuid, '${nobody}'::uuid)`,
    ),
  }
  c.check(
    spends.byB === 'false' && spends.byAWithBJob === 'false' && spends.byAWithNoJob === 'false',
    "B cannot spend A's authority, A cannot spend it with B's job, and a job that does not exist spends nothing",
    c.json(spends),
  )
  c.check((await authRows(A)) === aAuth0, "A's authority is unconsumed after all three", '')
  c.check(
    (await say(
      `select app.consume_channel_authority(${q(A)}::uuid, '${proj.A}'::uuid, '${jobA}'::uuid)`,
    )) === 'true' && (await readAuth(A, proj.A)) === 'null',
    "POSITIVE CONTROL: A spends A's authority with A's own job, once",
    '',
  )
  c.check(
    (await say(
      `select app.consume_channel_authority(${q(A)}::uuid, '${proj.A}'::uuid, '${jobA}'::uuid)`,
    )) === 'false',
    'and a second spend finds nothing to spend',
    '',
  )

  // ---- the trigger scan ----------------------------------------------------------------------------------------------------------------------
  const SRC = `itg2-${run}`
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    await c.db.execute(
      `insert into public.event_triggers (office_id, name, source, event_type, job_kind) values ('${office}', 'itg2-${who}-${run}', '${SRC}', 'thing.happened', 'office.instruction')`,
    )
    await c.db.execute(
      `insert into public.signals (office_id, source, event_type, external_ref, summary) values ('${office}', '${SRC}', 'thing.happened', 'ref-${who}-${run}', ${q(`${c.canary[who]} happened`)})`,
    )
  }
  const fired = (who: string) =>
    one(
      `select count(*)::int n from public.trigger_firings f join public.signals s using (signal_id) where s.external_ref = 'ref-${who}-${run}'`,
    )
  await W(`select app.fire_pending_signals(${q(A)}::uuid, 50)`)
  c.check(
    Number((await fired('A')).n) === 1 && Number((await fired('B')).n) === 0,
    "fire_pending_signals: A's scan fires A's signal and leaves B's pending",
    '',
  )
  const ranJobs = await rows(
    `select office_id::text o from public.jobs where requested_by = 'trigger:itg2-A-${run}' or requested_by = 'trigger:itg2-B-${run}'`,
  )
  c.check(ranJobs.length === 1 && ranJobs[0]?.o === A, "and the job it started is A's", '')
  await W(`select app.fire_pending_signals(${q(B)}::uuid, 50)`)
  c.check(Number((await fired('B')).n) === 1, "POSITIVE CONTROL: B's own scan fires B's signal", '')

  // ---- Google: the resolver, per-office names, the guard, the revoke -----------------------------------------------------------------
  const home = String((await one(`select app.google_home_office() as h`)).h)
  c.check(
    home === G,
    "the deployment's Google office is the operator's (Grant's)",
    home === G ? '' : `home=${home.slice(0, 8)}`,
  )
  const names = (office: string | null, base: string) =>
    say(
      `select app.google_vault_name(${office === null ? 'null::uuid' : `${q(office)}::uuid`}, ${q(base)})`,
    )
  c.check(
    (await names(G, 'google.refresh_token')) === '"google.refresh_token"' &&
      (await names(B, 'google.refresh_token')) === `"google.refresh_token.${B}"` &&
      (await names(B, 'google.revoking_refresh_token')) ===
        `"google.revoking_refresh_token.${B}"` &&
      (await names(null, 'google.refresh_token')) === 'null' &&
      (await names(B, 'notion.integration_token')) === '"notion.integration_token"',
    'google_vault_name: the home office keeps the bare name, another office gets its own, no office gets nothing, other names are untouched',
    '',
  )
  const klass = async (n: string) =>
    String((await one(`select app.credential_class(${q(n)}) as k`)).k)
  c.check(
    (await klass(`google.refresh_token.${B}`)) === 'human_integration' &&
      (await klass(`google.revoking_refresh_token.${B}`)) === 'human_integration' &&
      (await klass('google.refresh_token.not-an-office')) === 'null' &&
      (await klass('google.refresh_token.')) === 'null',
    'credential_class: a per-office Google name is a human-integration secret; a malformed suffix is unclassified',
    '',
  )

  const GT = `FAKE-NOT-A-REAL-GOOGLE-G-${run}`
  const BT = `FAKE-NOT-A-REAL-GOOGLE-B-${run}`
  const NT = `FAKE-NOT-A-REAL-NOTION-${run}`
  const CS = `FAKE-NOT-A-REAL-CLIENT-SECRET-${run}`
  await c.db.execute(
    `delete from vault.secrets where name in ('google.refresh_token','google.revoking_refresh_token','google.refresh_token.${B}','google.revoking_refresh_token.${B}','notion.integration_token','google.client_secret')`,
  )
  for (const [name, value] of [
    ['google.refresh_token', GT],
    [`google.refresh_token.${B}`, BT],
    ['notion.integration_token', NT],
    ['google.client_secret', CS],
  ] as const)
    await c.db.execute(`insert into vault.secrets (name, secret) values (${q(name)}, ${q(value)})`)
  const vaultHash = async (like: string) =>
    String(
      (
        await one(
          `select coalesce(md5(string_agg(name || decrypted_secret, '|' order by name)), '-') h from vault.decrypted_secrets where name like ${q(like)}`,
        )
      ).h,
    )
  const duty = (await one(`select slug, job_kind from public.responsibilities limit 1`)) as {
    slug: string
    job_kind: string
  }
  const mkDuty = async (office: string) => {
    // A duty is internal work only when the responsibility belongs to the job's OWN office (app.internal_root_ok),
    // so the second office gets a duty of its own with the same slug and kind: Grant's does not make B's job internal.
    await c.db.execute(
      `insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, office_id)
       select r.slug, r.staff_id, 'A duty of this office, for the fixture that needs one', r.job_kind, 60, '${office}'
         from public.responsibilities r where r.slug = ${q(duty.slug)} limit 1
       on conflict (office_id, slug) do nothing`,
    )
    return String(
      (
        await one(
          `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, office_id)
           values (gen_random_uuid(), 'itg2-duty-${office.slice(0, 4)}-${run}', ${q(duty.job_kind)}, ${q(`duty:${duty.slug}`)}, '${office}') returning job_id`,
        )
      ).job_id,
    )
  }
  const dutyG = await mkDuty(G)
  const dutyB = await mkDuty(B)
  const origin = async (j: string) =>
    String((await one(`select app.job_origin('${j}'::uuid) as o`)).o)
  c.check(
    (await origin(dutyG)) === 'internal' && (await origin(dutyB)) === 'internal',
    'the fixtures are what they claim: a duty of either office is internal work',
    `${await origin(dutyG)}/${await origin(dutyB)}`,
  )
  const cred = (
    office: string,
    name: string,
    job: string | null,
    operator: string | null = null,
    system = false,
  ) =>
    say(
      `select app.deployment_credential(${q(office)}::uuid, ${q(name)}, ${operator === null ? 'null' : q(operator)}, ${job === null ? 'null' : `'${job}'::uuid`}, ${String(system)})`,
    )
  const is = (got: string, secret: string) => got === JSON.stringify(secret)
  const refused = (got: string) =>
    got.startsWith('ERR:') && got.includes('deployment credential refused')
  c.check(
    is(await cred(G, 'google.refresh_token', dutyG), GT),
    "POSITIVE CONTROL: the deployment's own duty reads the deployment's Google token",
    '',
  )
  c.check(
    is(await cred(B, 'google.refresh_token', dutyB), BT) &&
      !is(await cred(B, 'google.refresh_token', dutyB), GT),
    "POSITIVE CONTROL: a duty of B reads B's OWN token, never Grant's",
    '',
  )
  c.check(
    is(
      await cred(
        String((await one(`select app.deployment_reader_office() as o`)).o),
        'google.refresh_token',
        null,
        null,
        true,
      ),
      GT,
    ),
    "the worker acting for the deployment itself (no job) reads the deployment's Google",
    '',
  )
  c.check(
    refused(await cred(G, 'google.refresh_token', dutyB)) &&
      refused(await cred(B, 'google.refresh_token', dutyG)),
    'a job of one office cannot read as the other: the job and the office have to agree',
    '',
  )
  c.check(
    (await cred(G, 'google.refresh_token', dutyB)) ===
      (await cred(G, 'google.refresh_token', nobody)),
    'and a foreign job id and a nonexistent job id are refused in the same words',
    '',
  )
  c.check(
    refused(await cred(B, 'notion.integration_token', dutyB)) &&
      is(await cred(G, 'notion.integration_token', dutyG), NT),
    'a deployment-level secret (Notion) is refused to an office that does not see the deployment, and served to the one that does',
    '',
  )
  c.check(
    is(await cred(B, 'google.client_secret', dutyB), CS),
    "the OAuth client secret (the deployment's app) is served to a duty of any office: it only ever exchanges that office's own refresh token",
    '',
  )
  const door = (office: string, name: string, operator: string | null, job: string | null = null) =>
    c
      .try_(
        S,
        `select public.deployment_credential(${q(office)}::uuid, ${q(name)}, ${operator === null ? 'null' : q(operator)}, ${job === null ? 'null' : `'${job}'::uuid`})`,
      )
      .then((r) => (r.ok ? c.json(r.value) : `ERR:${r.error}`))
  const operatorKey = String((await one(`select app.office_actor('${G}'::uuid) as a`)).a)
  c.check(
    is(await door(G, 'google.refresh_token', operatorKey), GT),
    'POSITIVE CONTROL: the operator, acting as their own office, is served through the PostgREST door',
    '',
  )
  c.check(
    refused(await door(B, 'google.refresh_token', operatorKey)) &&
      refused(await door(G, 'google.refresh_token', by.B)),
    "the operator cannot read as another office, and another office's person is not an operator",
    '',
  )
  for (const [what, off] of [
    ['a null office', 'null::uuid'],
    ['an office that does not exist', `${q(nobody)}::uuid`],
  ] as const) {
    const msg = await c.refusal(
      S,
      `select public.deployment_credential(${off}, 'google.refresh_token', ${q(operatorKey)})`,
    )
    c.check(
      msg.includes('no_office'),
      `deployment_credential: ${what} is refused`,
      msg.slice(0, 70),
    )
  }
  for (const [fn, args] of [
    ['deployment_credential', `(${q(G)}::uuid, 'google.refresh_token', ${q(operatorKey)})`],
    ['hq_store_google_refresh', `(${q(G)}::uuid, 'x', 'y')`],
    ['office_of_operator', `(${q(operatorKey)})`],
  ] as const)
    for (const role of callerRoles) {
      const msg = await c.refusal(role, `select public.${fn}${args}`)
      c.check(msg.includes('permission denied'), `${fn}: ${role} cannot call it`, msg.slice(0, 70))
    }
  const ofOp = async (who: string) =>
    String((await c.exec(S, `select public.office_of_operator(${q(who)})`)) ?? 'null')
  c.check(
    (await ofOp(operatorKey)) === G &&
      (await ofOp(by.B)) === 'null' &&
      (await ofOp('nobody')) === 'null',
    "office_of_operator: answers the operator's office, and nothing for anyone who is not an operator",
    '',
  )
  const appClosed = (await one(
    `select has_function_privilege('service_role', 'app.deployment_credential(uuid,text,text,uuid,boolean)', 'execute') s,
              has_function_privilege('service_role', 'app.google_revoke_begin(uuid)', 'execute') r,
              has_function_privilege('service_role', 'app.google_revoke_finish(uuid,boolean,text)', 'execute') f`,
  )) as { s: boolean; r: boolean; f: boolean }
  c.check(
    !appClosed.s && !appClosed.r && !appClosed.f,
    'the app-side Google functions are closed to the service role',
    c.json(appClosed),
  )

  // store: the guard
  const cfgScopes = () =>
    digest(`select * from public.system_config where key = 'google.granted_scopes'`)
  const healthRows = () =>
    digest(`select * from public.connection_health where service = 'google_calendar'`)
  const sc0 = await cfgScopes()
  const bVault0 = await vaultHash(`google.refresh_token.${B}`)
  const gVault0 = await vaultHash('google.refresh_token')
  const h0 = await healthRows()
  const refB = await say(
    `select app.hq_store_google_refresh(${q(B)}::uuid, ${q(`FAKE-NOT-A-REAL-NEW-${run}`)}, 'scopes')`,
  )
  const refA = await say(
    `select app.hq_store_google_refresh(${q(A)}::uuid, ${q(`FAKE-NOT-A-REAL-NEW-${run}`)}, 'scopes')`,
  )
  c.check(
    refB.includes('one person') && refB === refA,
    'hq_store_google_refresh: a second office connecting Google is REFUSED, in the same words for every office',
    refB.slice(0, 80),
  )
  c.check(
    (await vaultHash(`google.refresh_token.${B}`)) === bVault0 &&
      (await vaultHash('google.refresh_token')) === gVault0 &&
      (await cfgScopes()) === sc0 &&
      (await healthRows()) === h0,
    "and nothing was stored: not B's token, not Grant's, not the granted scopes, not the health row",
    '',
  )
  for (const [what, off] of [
    ['a null office', 'null::uuid'],
    ['an office that does not exist', `${q(nobody)}::uuid`],
  ] as const) {
    const msg = await c.refusal(S, `select public.hq_store_google_refresh(${off}, 'x', 'y')`)
    c.check(
      msg.includes('no_office'),
      `hq_store_google_refresh: ${what} is refused`,
      msg.slice(0, 70),
    )
  }
  const stored = (await c.exec(
    S,
    `select public.hq_store_google_refresh(${q(G)}::uuid, ${q(`${GT}-2`)}, 'https://www.googleapis.com/auth/calendar')`,
  )) as { stored?: boolean }
  c.check(
    stored.stored === true &&
      is(await cred(G, 'google.refresh_token', dutyG), `${GT}-2`) &&
      (
        await one(
          `select office_id::text o, state from public.connection_health where service = 'google_calendar' and credential = 'oauth_client'`,
        )
      ).o === G,
    "POSITIVE CONTROL: the deployment's own office stores its token (read back through the resolver) and its own health row goes green",
    '',
  )
  c.check(
    is(await cred(B, 'google.refresh_token', dutyB), BT),
    "and B's token is still B's after Grant's was rotated",
    '',
  )

  // revoke: B's, then Grant's. Neither may touch the other.
  const healthG = () => digest(`select * from public.connection_health where office_id = '${G}'`)
  const hg = await healthG()
  const gParked0 = await vaultHash('google.revoking_refresh_token')
  const beginB = (await W(`select app.google_revoke_begin(${q(B)}::uuid)`)) as {
    parked?: boolean
    job_id?: string
  }
  c.check(
    beginB.parked === true &&
      (await vaultHash('google.refresh_token')) !== '-' &&
      (await vaultHash(`google.refresh_token.${B}`)) === '-' &&
      (await vaultHash(`google.revoking_refresh_token.${B}`)) !== '-',
    "google_revoke_begin(B): B's token is parked under B's own name and B's live copy is gone",
    '',
  )
  c.check(
    is(await cred(G, 'google.refresh_token', dutyG), `${GT}-2`) &&
      (await vaultHash('google.revoking_refresh_token')) === gParked0 &&
      (await healthG()) === hg,
    "and Grant's live token, Grant's parked slot and Grant's health row are untouched by B's sign-out",
    '',
  )
  const revokeJob = String(beginB.job_id)
  const rj = await one(
    `select office_id::text o, kind, requested_by from public.jobs where job_id = '${revokeJob}'`,
  )
  c.check(
    rj.o === B && rj.kind === 'google.revoke' && (await origin(revokeJob)) === 'internal',
    "the revoke job is B's, and is internal work (so its handler may read the token it exists to destroy)",
    c.json([rj.o === B, rj.kind, rj.requested_by, await origin(revokeJob)]),
  )
  c.check(
    is(await cred(B, 'google.revoking_refresh_token', revokeJob), BT),
    "the revoke job of B reads B's parked token through the resolver",
    '',
  )
  c.check(
    refused(await cred(G, 'google.revoking_refresh_token', revokeJob)),
    "and cannot be made to read as Grant's office",
    '',
  )
  await W(
    `select app.google_revoke_finish(${q(A)}::uuid, true, 'a finish from an office with nothing')`,
  )
  c.check(
    (await vaultHash(`google.revoking_refresh_token.${B}`)) !== '-' && (await healthG()) === hg,
    "A's finish deletes nobody else's parked copy and marks nobody else's health row",
    '',
  )
  await W(`select app.google_revoke_finish(${q(B)}::uuid, true, '')`)
  c.check(
    (await vaultHash(`google.revoking_refresh_token.${B}`)) === '-' &&
      (await healthG()) === hg &&
      is(await cred(G, 'google.refresh_token', dutyG), `${GT}-2`),
    "POSITIVE CONTROL: B's finish destroys B's parked copy, and only that: Grant's token and health row are untouched",
    '',
  )
  const beginG = (await W(`select app.google_revoke_begin(${q(G)}::uuid)`)) as { parked?: boolean }
  c.check(
    beginG.parked === true && (await vaultHash('google.refresh_token')) === '-',
    "POSITIVE CONTROL: Grant's own sign-out parks and removes Grant's token",
    '',
  )
  await W(`select app.google_revoke_finish(${q(G)}::uuid, false, 'google would not say')`)
  const gh = await one(
    `select state, action from public.connection_health where office_id = '${G}' and service = 'google_calendar'`,
  )
  c.check(
    gh.state === 'missing' &&
      String(gh.action).includes('myaccount.google.com') &&
      (await vaultHash('google.revoking_refresh_token')) === '-',
    "and Grant's finish marks Grant's health row, says what to do when Google did not confirm, and deletes the parked copy",
    '',
  )
  const legacy = await c.db.execute(
    `select to_regprocedure('app.google_revoke_begin()') is null as gone`,
  )
  c.check(
    (legacy.rows[0] as { gone?: boolean }).gone === true,
    'the zero-argument google_revoke_begin is gone: hq_forget_google names the office, so no door acts for "the deployment\'s Google"',
    '',
  )

  // clean up what this file put in the vault and the member list
  await c.db.execute(
    `delete from public.office_members where owner_key in (${q(by.A)}, ${q(by.B)})`,
  )
  await c.db.execute(
    `delete from vault.secrets where name in ('google.refresh_token','google.revoking_refresh_token','google.refresh_token.${B}','google.revoking_refresh_token.${B}','notion.integration_token','google.client_secret')`,
  )

  // ---- nothing above relied on the compatibility bridge ----------------------------------------------------------------------------------
  const bridgeAfter = Number(
    (
      await one(
        `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name in (${bridgeTables})`,
      )
    ).n,
  )
  c.check(
    bridgeAfter === bridgeBefore,
    'the converted writers never relied on the compatibility bridge',
    `bridge uses before ${String(bridgeBefore)}, after ${String(bridgeAfter)}`,
  )
  void T
}
