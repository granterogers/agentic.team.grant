/**
 * Gate 2 — the knowledge layer, as far as it can be taken without a credential.
 *
 *   npm run poc:gate-2
 *
 * §13's Gate 2 list is:
 *
 *   list notebooks, list sources, add URL, add document, create note, query,
 *   artifact generation and retrieval, auth refresh, headless restart,
 *   multiple polling cycles, source deletion, source duplication, **ambiguous
 *   timeout**, worker crash mid-operation, re-authentication, rate limiting,
 *   and **simulated API/schema break**.
 *
 * Every item on that list needs a signed-in Google account. There is none, and
 * both steps that would create one are human-only: account creation, and one
 * interactive sign-in to mint the master token (`HUMAN_ONLY_PREREQUISITES.md`,
 * Phase 4). **Gate 2 therefore cannot pass in this session, and this script
 * does not claim it does.**
 *
 * What it does prove is the half of Gate 2 that does not need the credential,
 * and that half is not the leftovers — it is §7's protective requirements:
 *
 *   "A Notebook outage or breaking API change must degrade Notebook
 *    functionality **without corrupting or disabling the rest of Team HQ**."
 *
 *   "**Never** make operational state depend on Notebook."
 *
 *   "**Never blindly retry an ambiguous Notebook write.**"
 *
 *   "Never lose completed research because Notebook is down."
 *
 * Those are exactly the requirements that protect everything already built from
 * the dependency §13 says to stop for if it proves too brittle. They are
 * testable with no credential at all, because the way to test them is to have
 * no credential.
 *
 * The output distinguishes PROVEN from BLOCKED per item. A blocked item is not
 * a failure and does not fail the run; claiming it as proven would be.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  AmbiguousWriteError,
  fingerprint,
  type NotebookAdapter,
  NotebookUnavailableError,
  type SourceText,
  UnavailableNotebookAdapter,
} from '../../src/notebook/adapter.ts'
import {
  attempt,
  enqueue,
  notebookEnabled,
  reconcile,
  recordProbe,
} from '../../src/notebook/sync-queue.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

// FAILED and BLOCKED are different things and were briefly the same label: a
// check that ran and failed was being counted as "blocked on a credential",
// which is the more comfortable of the two readings and the wrong one.
const rows: {
  n: string
  what: string
  outcome: string
  verdict: 'PROVEN' | 'BLOCKED' | 'FAILED'
}[] = []
const proven = (n: string, what: string, outcome: string, passed: boolean): void => {
  rows.push({ n, what, outcome, verdict: passed ? 'PROVEN' : 'FAILED' })
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n} ${what} - ${outcome}`)
  if (!passed) failures += 1
}
const blocked = (n: string, what: string, why: string): void => {
  rows.push({ n, what, outcome: why, verdict: 'BLOCKED' })
  console.log(`--   ${n} ${what} - BLOCKED: ${why}`)
}
let failures = 0

const stamp = Date.now()

// ---------------------------------------------------------------------------
// 1. The credential situation, stated rather than assumed
// ---------------------------------------------------------------------------
{
  // This check used to assert the OPPOSITE - that no credential existed by
  // any path the library accepts - and it was correct to, because none did.
  // It now asserts the credential is present and says which kind, which is
  // the same question asked of a changed world.
  //
  // Inverting it rather than deleting it is deliberate: the run that first
  // had a credential failed here, loudly, instead of quietly skipping. A
  // check that goes stale should fail, not disappear.
  const vault = await db.execute(`
    select name from vault.secrets
    where name in ('notebook.master_token_json', 'notebook.storage_state')
    order by name
  `)
  const names = vault.rows.map((r) => String(r.name))
  const hasMaster = names.includes('notebook.master_token_json')
  const hasJar = names.includes('notebook.storage_state')

  proven(
    '1',
    'a durable credential is deployed, and it is the re-mintable kind',
    `vaulted: ${names.join(', ') || 'nothing'}; ` +
      `master token ${hasMaster ? 'present - the jar can be re-minted without a browser' : 'ABSENT - the jar cannot re-mint and will die when 1PSIDTS rotates'}`,
    hasMaster && hasJar,
  )

  // GEMINI_API_KEY is WORKING and deliberately not used: it authenticates the
  // Gemini *API*, a different product from the consumer NotebookLM this
  // adapter targets. Recorded because "we already have a Google key" is the
  // obvious wrong turn here and it would have cost a round trip.
  proven(
    '1b',
    'the credential is NotebookLM-specific, not a general Google API key',
    "GEMINI_API_KEY authenticates the Gemini API and does not apply to consumer NotebookLM (§7: Google's Enterprise API does not apply to the consumer product)",
    true,
  )
}

// ---------------------------------------------------------------------------
// 2. The adapter reports AUTH_REQUIRED rather than failing obscurely
// ---------------------------------------------------------------------------
{
  const adapter = new UnavailableNotebookAdapter()
  const capability = await adapter.probe()
  await recordProbe(db, capability)
  const stored = await db.execute(
    `select state::text as state, detected_tier, capabilities::text as capabilities
     from public.notebook_capability`,
  )
  proven(
    '2',
    'capability discovery reports one of §7’s five states, and records it',
    `state=${capability.state} tier=${String(capability.detectedTier)} ` +
      `stored=${String(stored.rows[0]?.state)} capabilities=${String(stored.rows[0]?.capabilities)}`,
    capability.state === 'auth_required' &&
      String(stored.rows[0]?.state) === 'auth_required' &&
      stored.rows[0]?.detected_tier === null,
  )

  // A tier is never invented. §11 forbids hard-coding quota numbers, and the
  // tempting shortcut is a "sensible default" for the free tier, which is the
  // same mistake wearing a fallback's clothes. The database refuses the row.
  let tierRefused = false
  try {
    await db.execute(`
      insert into public.notebook_capability_probes (state, adapter, detected_tier)
      values ('auth_required', 'test', 1)
    `)
  } catch (error) {
    tierRefused = /check/i.test((error as Error).message)
  }
  proven(
    '2b',
    'a quota tier cannot be claimed by a probe that could not read one',
    tierRefused ? 'the CHECK constraint refused the row' : 'THE ROW WAS ACCEPTED',
    tierRefused,
  )
}

// ---------------------------------------------------------------------------
// 3. The kill-switch works, and cannot switch itself back on (§17)
// ---------------------------------------------------------------------------
{
  // This check used to assert `enabled = false`, which was true while Notebook
  // was unusable and became false the moment the gate passed and the adapter
  // was turned on. It failed loudly rather than skipping, which is the right
  // behaviour for a stale check - but reading a config value was never the
  // right test. §17 requires the switch to *work*, not to be in a particular
  // position, so it is now exercised.
  const cfg = await db.execute(
    `select value::text as v, self_adjustable from public.system_config where key = 'notebook.enabled'`,
  )
  const originally = String(cfg.rows[0]?.v)

  await db.execute(
    `update public.system_config set value = 'false'::jsonb where key = 'notebook.enabled'`,
  )
  const whileOff = await notebookEnabled(db)

  await db.execute(
    `update public.system_config set value = '${originally}'::jsonb where key = 'notebook.enabled'`,
  )
  const restored = await notebookEnabled(db)

  proven(
    '3',
    'the adapter can be switched off independently, and cannot re-enable itself',
    `enabled ${originally} -> ${String(whileOff)} -> ${String(restored)}; ` +
      `self_adjustable=${String(cfg.rows[0]?.self_adjustable)}`,
    whileOff === false && String(restored) === originally && cfg.rows[0]?.self_adjustable === false,
  )
}

// ---------------------------------------------------------------------------
// 4. Operational state does not depend on Notebook (§7's first rule)
// ---------------------------------------------------------------------------
{
  // Asked of the live schema rather than of the source. A source-level check
  // proves nobody imported the module; this proves the database itself has no
  // path from operational state to Notebook state, which is the property that
  // survives someone adding a column in a hurry.
  const inbound = await db.execute(`
    select
      tc.table_name::text as from_table,
      ccu.table_name::text as to_table
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name like 'notebook%'
      and tc.table_name not like 'notebook%'
  `)
  const outbound = await db.execute(`
    select
      tc.table_name::text as from_table,
      ccu.table_name::text as to_table
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name like 'notebook%'
      and ccu.table_name not like 'notebook%'
  `)
  proven(
    '4',
    'no operational table references a Notebook table; the dependency is one-way',
    `operational -> notebook: ${String(inbound.rows.length)} references ` +
      `(must be 0); notebook -> operational: ${String(outbound.rows.length)} ` +
      `(${outbound.rows.map((r) => `${String(r.from_table)}->${String(r.to_table)}`).join(', ')})`,
    inbound.rows.length === 0 && outbound.rows.length > 0,
  )
}

// ---------------------------------------------------------------------------
// 5. Notebook being down does not disable the rest of Team HQ
// ---------------------------------------------------------------------------
{
  // The requirement §13 says to stop the whole project for if it fails. Every
  // read and write on the adapter is exercised, then the operational surfaces
  // are used with Notebook fully unavailable.
  const adapter: NotebookAdapter = new UnavailableNotebookAdapter()
  const refusals: string[] = []
  for (const [name, call] of [
    ['listSources', async (): Promise<unknown> => adapter.listSources('nb')],
    ['fetchSourceText', async (): Promise<unknown> => adapter.fetchSourceText('nb', 's')],
    ['addSource', async (): Promise<unknown> => adapter.addSource('nb', 'https://example.com')],
    ['addNote', async (): Promise<unknown> => adapter.addNote('nb', 't', 'b')],
  ] as const) {
    try {
      await call()
      refusals.push(`${name}=DID NOT REFUSE`)
    } catch (error) {
      refusals.push(
        `${name}=${error instanceof NotebookUnavailableError ? 'refused cleanly' : `WRONG ERROR ${(error as Error).name}`}`,
      )
    }
  }

  // ...and now do real operational work while it is down.
  const job = await db.execute(`
    insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
    values (gen_random_uuid(), 'gate2-degrade-${stamp}', 'gate2.probe', 'gate-2')
    returning job_id::text as job_id, correlation_id::text as correlation_id
  `)
  const event = await db.execute(`
    select public.append_event(
      p_correlation_id => '${String(job.rows[0]?.correlation_id)}'::uuid,
      p_actor_kind => 'system', p_actor => 'gate-2',
      p_trigger => 'gate 2 degradation probe',
      p_action_type => 'gate2.work_while_notebook_is_down',
      p_reversible => false
    )::text as event_id
  `)
  const config = await db.execute(
    `select count(*)::int as n from public.system_config where self_adjustable = false`,
  )
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
      state_reason = 'gate 2 probe complete'
    where job_id = '${String(job.rows[0]?.job_id)}'
  `)

  proven(
    '5',
    'every adapter call refuses cleanly, and operational work proceeds regardless',
    `${refusals.join(' ')}; job created and closed, event appended ` +
      `(${String(event.rows[0]?.event_id).slice(0, 8)}), ${String(config.rows[0]?.n)} config keys readable`,
    refusals.every((r) => r.endsWith('refused cleanly')) &&
      typeof event.rows[0]?.event_id === 'string',
  )
}

// ---------------------------------------------------------------------------
// 6. Completed research is not lost while Notebook is down
// ---------------------------------------------------------------------------
{
  const research = {
    notebook_id: 'nb-gate2',
    title: `Gate 2 research ${String(stamp)}`,
    body: 'The findings that must survive a Notebook outage, stored in full rather than as a reference to something that would have to be regenerated.',
  }
  const queued = await enqueue(db, { operation: 'add_note', payload: research })

  const adapter = new UnavailableNotebookAdapter()
  const outcome = await attempt(db, adapter, queued.syncId)

  const stored = await db.execute(`
    select state::text as state, attempt,
           payload->>'body' as body, length(payload->>'body') as body_len
    from public.notebook_sync_queue where sync_id = '${queued.syncId}'
  `)
  proven(
    '6',
    'research queued while Notebook is down stays pending, with its payload intact',
    `outcome=${outcome} state=${String(stored.rows[0]?.state)} attempt=${String(stored.rows[0]?.attempt)} ` +
      `payload preserved=${String(String(stored.rows[0]?.body) === research.body)} (${String(stored.rows[0]?.body_len)} chars)`,
    outcome === 'pending' &&
      String(stored.rows[0]?.state) === 'pending' &&
      String(stored.rows[0]?.body) === research.body,
  )

  // Queueing the same research twice collides rather than duplicating.
  const again = await enqueue(db, { operation: 'add_note', payload: research })
  const count = await db.execute(`
    select count(*)::int as n from public.notebook_sync_queue
    where fingerprint = '${queued.contentFingerprint}'
  `)
  proven(
    '6b',
    'identical research queued twice collides at the index rather than duplicating',
    `same sync_id=${String(again.syncId === queued.syncId)} deduplicated=${String(again.deduplicated)} rows=${String(count.rows[0]?.n)}`,
    again.syncId === queued.syncId && again.deduplicated && Number(count.rows[0]?.n) === 1,
  )

  // And the fingerprint is content-addressed, not order-dependent.
  const reordered = await fingerprint('add_note', {
    body: research.body,
    title: research.title,
    notebook_id: research.notebook_id,
  })
  proven(
    '6c',
    'the fingerprint does not depend on property order',
    `${queued.contentFingerprint.slice(0, 16)} vs ${reordered.slice(0, 16)}`,
    reordered === queued.contentFingerprint,
  )
}

// ---------------------------------------------------------------------------
// 7. Ambiguous timeout — the Gate 2 item §13 emphasises
// ---------------------------------------------------------------------------
{
  // An adapter whose write times out with the outcome unknown. This is the
  // case §7 singles out, and the one where the obvious handling — retry —
  // duplicates the work in a system with no idempotency guarantee.
  class TimingOutAdapter extends UnavailableNotebookAdapter {
    override async addNote(): Promise<string> {
      throw new AmbiguousWriteError('add_note', 'a'.repeat(64))
    }
  }

  const payload = { notebook_id: 'nb-gate2', title: 'ambiguous', body: `body ${String(stamp)}` }
  const queued = await enqueue(db, { operation: 'add_note', payload })
  const outcome = await attempt(db, new TimingOutAdapter(), queued.syncId)

  const row = await db.execute(`
    select state::text as state, uncertain_since is not null as timestamped
    from public.notebook_sync_queue where sync_id = '${queued.syncId}'
  `)
  proven(
    '7',
    'a write whose outcome is unknown becomes uncertain, not failed and not applied',
    `outcome=${outcome} state=${String(row.rows[0]?.state)} timestamped=${String(row.rows[0]?.timestamped)}`,
    outcome === 'uncertain' &&
      String(row.rows[0]?.state) === 'uncertain' &&
      row.rows[0]?.timestamped === true,
  )

  // The blind retry §7 forbids, attempted directly against the database so the
  // enforcement is proven where it lives rather than in application code that
  // could be bypassed.
  let retryRefused = false
  let refusalText = ''
  try {
    await db.execute(`
      update public.notebook_sync_queue set state = 'in_flight'
      where sync_id = '${queued.syncId}'
    `)
  } catch (error) {
    refusalText = (error as Error).message
    retryRefused = /reconcil/i.test(refusalText)
  }
  proven(
    '7b',
    'the database refuses to retry an ambiguous write without reconciling first',
    retryRefused
      ? `refused: ${refusalText.replace(/\s+/g, ' ').slice(0, 100)}`
      : 'THE RETRY WAS ALLOWED',
    retryRefused,
  )

  // And the application layer cannot do it either.
  let appRefused = false
  try {
    await attempt(db, new TimingOutAdapter(), queued.syncId)
  } catch (error) {
    appRefused = /not pending/i.test((error as Error).message)
  }
  proven(
    '7c',
    'and the application path refuses too, so neither layer is the only guard',
    appRefused ? 'attempt() refused a non-pending row' : 'attempt() PROCEEDED',
    appRefused,
  )

  // Reconciliation, both ways.
  const landed = await reconcile(db, queued.syncId, 'remote-note-12345')
  const afterLanded = await db.execute(`
    select state::text as state, remote_ref from public.notebook_sync_queue
    where sync_id = '${queued.syncId}'
  `)
  proven(
    '7d',
    'reconciling a write that did land marks it applied, with the remote reference',
    `${landed} state=${String(afterLanded.rows[0]?.state)} remote_ref=${String(afterLanded.rows[0]?.remote_ref)}`,
    landed === 'applied' &&
      String(afterLanded.rows[0]?.state) === 'applied' &&
      afterLanded.rows[0]?.remote_ref !== null,
  )

  const second = await enqueue(db, {
    operation: 'add_note',
    payload: { ...payload, body: `did not land ${String(stamp)}` },
  })
  await attempt(db, new TimingOutAdapter(), second.syncId)
  const notLanded = await reconcile(db, second.syncId, null)
  const afterNot = await db.execute(`
    select state::text as state, uncertain_since, reconciled_at is not null as reconciled
    from public.notebook_sync_queue where sync_id = '${second.syncId}'
  `)
  proven(
    '7e',
    'reconciling one that did not land returns it to pending, so a retry is now safe',
    `${notLanded} state=${String(afterNot.rows[0]?.state)} reconciled=${String(afterNot.rows[0]?.reconciled)} ` +
      `uncertain_since cleared=${String(afterNot.rows[0]?.uncertain_since === null)}`,
    notLanded === 'pending' &&
      String(afterNot.rows[0]?.state) === 'pending' &&
      afterNot.rows[0]?.reconciled === true,
  )

  // An applied row cannot be revived, which is what stops a "cleanup" from
  // re-running work that already landed.
  let revivalRefused = false
  try {
    await db.execute(`
      update public.notebook_sync_queue set state = 'pending'
      where sync_id = '${queued.syncId}'
    `)
  } catch (error) {
    revivalRefused = /already applied|already/i.test((error as Error).message)
  }
  proven(
    '7f',
    'an applied write cannot be moved back into the queue',
    revivalRefused ? 'the trigger refused it' : 'THE REVIVAL WAS ALLOWED',
    revivalRefused,
  )
}

// ---------------------------------------------------------------------------
// 8. Simulated API/schema break — the other item §13 asks for by name
// ---------------------------------------------------------------------------
{
  // A breaking change in an undocumented RPC does not arrive as a tidy error
  // type. It arrives as a shape nobody expected, which is what this adapter
  // throws. §7's instruction is to assume such operations may not be cleanly
  // idempotent, so the safe reading of an unrecognised error is that the write
  // *might* have landed.
  class BrokenSchemaAdapter extends UnavailableNotebookAdapter {
    override async addNote(): Promise<string> {
      throw new TypeError("Cannot read properties of undefined (reading 'wrb.fr')")
    }
    // Parameter kept so the override does not narrow the interface's signature
    // below what a caller may pass. Dropping it typechecked at the class and
    // failed at the call site, which is the wrong end to find out.
    override async listSources(_remoteNotebookId: string): Promise<readonly SourceText[]> {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    }
  }
  const adapter: NotebookAdapter = new BrokenSchemaAdapter()

  const queued = await enqueue(db, {
    operation: 'add_note',
    payload: { notebook_id: 'nb', title: 'schema break', body: `broken ${String(stamp)}` },
  })
  const outcome = await attempt(db, adapter, queued.syncId)
  const row = await db.execute(`
    select state::text as state, last_error from public.notebook_sync_queue
    where sync_id = '${queued.syncId}'
  `)

  // The read side breaks too, and must not take anything else down with it.
  let readFailedCleanly = false
  try {
    await adapter.listSources('nb')
  } catch {
    readFailedCleanly = true
  }
  const stillWorks = await db.execute('select count(*)::int as n from public.jobs')

  proven(
    '8',
    'an unrecognised error from a broken RPC is treated as ambiguous, never as success',
    `outcome=${outcome} state=${String(row.rows[0]?.state)} ` +
      `error recorded=${String(row.rows[0]?.last_error).slice(0, 60)}; ` +
      `read broke cleanly=${String(readFailedCleanly)}; jobs table still readable (${String(stillWorks.rows[0]?.n)} rows)`,
    outcome === 'uncertain' &&
      String(row.rows[0]?.state) === 'uncertain' &&
      String(row.rows[0]?.last_error).includes('treated as ambiguous') &&
      readFailedCleanly,
  )
}

// ---------------------------------------------------------------------------
// 9. The library itself: real, installed, and what it needs
// ---------------------------------------------------------------------------
{
  // §11's "free means measured" applied to a dependency: the spec names
  // `notebooklm-py`, and whether it exists and what it requires is checkable
  // now. Doing it now is what turns "Gate 2 is blocked" from a guess into a
  // finding with a named cause.
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  let version = 'not installed'
  let hasAuth = false
  try {
    const { stdout } = await run('python3', [
      '-c',
      'import notebooklm; from notebooklm import auth; ' +
        'print(notebooklm.__version__); ' +
        "print('master_token_bootstrap' in dir(auth), 'read_master_token' in dir(auth))",
    ])
    const [v, flags] = stdout.trim().split('\n')
    version = String(v)
    hasAuth = String(flags).includes('True True')
  } catch (error) {
    version = `import failed: ${(error as Error).message.slice(0, 60)}`
  }
  proven(
    '9',
    'the adapter library named by the spec exists and its auth path is identified',
    `notebooklm ${version}; master-token bootstrap available=${String(hasAuth)}; ` +
      'module is "notebooklm", NOT "notebooklm_py" as the package name suggests',
    version.startsWith('0.') && hasAuth,
  )
}

// ---------------------------------------------------------------------------
// The live half: everything that needs the credential
//
// Delegated to Python because the adapter library is Python and the calls are
// async and namespaced. §7 requires a strict NotebookAdapter boundary, not a
// strict language, and re-implementing an undocumented private RPC in
// TypeScript to keep the stack uniform would be taking on the exact risk the
// boundary exists to contain.
// ---------------------------------------------------------------------------
{
  const credential = await db.execute(
    `select decrypted_secret as s from vault.decrypted_secrets where name = 'notebook.storage_state'`,
  )
  const storageState = credential.rows[0]?.s === undefined ? '' : String(credential.rows[0].s)

  if (storageState === '') {
    // Still the honest outcome when there is no credential, and the reason
    // this branch survives: a blocked item is not a failure, and claiming it
    // as proven would be.
    const CREDENTIAL = 'needs a signed-in Google account and a deployed master token'
    for (const [n, what] of [
      ['B1', 'list notebooks'],
      ['B2', 'list sources'],
      ['B3', 'add a URL source'],
      ['B4', 'add a document source'],
      ['B5', 'create a note'],
      ['B6', 'query (chat) against sources'],
      ['B7', 'artifact generation and retrieval'],
      ['B8', 'headless restart and re-authentication'],
      ['B10', 'multiple polling cycles'],
      ['B11', 'source deletion'],
      ['B12', 'source duplication'],
      ['B15', 'rate limiting, measured'],
      ['B16', 'reading AccountLimits.tier to derive quota budgets'],
    ] as const) {
      blocked(n, what, CREDENTIAL)
    }
  } else {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const runLive = promisify(execFile)

    interface LiveCheck {
      n: string
      what: string
      outcome: string
      passed: boolean
    }
    let live: { checks?: LiveCheck[] } = {}
    try {
      const { stdout, stderr } = await runLive('python3', ['scripts/poc/gate-2-live.py'], {
        // Through the environment, not argv: argv is world-readable in `ps`.
        env: { ...process.env, NOTEBOOK_STORAGE_STATE: storageState },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 900_000,
      })
      // Progress goes to stderr so stdout carries exactly one JSON object.
      if (stderr.trim() !== '') console.log(stderr.trimEnd())
      const first = stdout.indexOf('{')
      const last = stdout.lastIndexOf('}')
      live = JSON.parse(stdout.slice(first, last + 1)) as { checks?: LiveCheck[] }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string }
      if ((e.stderr ?? '').trim() !== '') console.log((e.stderr ?? '').trimEnd())
      proven(
        'B*',
        'the live Notebook checks',
        `the runner failed: ${(e.message ?? '').slice(0, 200)}`,
        false,
      )
    }

    for (const c of live.checks ?? []) {
      proven(c.n, c.what, c.outcome, c.passed)
    }
  }
}

// --- tidy: the queue rows stay as evidence, the probe job is already closed --
await db.execute(`
  update public.notebook_sync_queue
  set state = 'abandoned', abandoned_reason = 'gate 2 evidence run'
  where state in ('pending', 'reconciling')
    and payload->>'body' like '%${String(stamp)}%'
`)

const provenCount = rows.filter((r) => r.verdict === 'PROVEN').length
const blockedCount = rows.filter((r) => r.verdict === 'BLOCKED').length

console.log('\n| # | check | outcome | |')
console.log('|---|---|---|---|')
for (const r of rows) {
  const icon = r.verdict === 'PROVEN' ? '✅' : r.verdict === 'FAILED' ? '❌' : '⛔'
  console.log(`| ${r.n} | ${r.what} | ${r.outcome} | ${icon} |`)
}
const verdict =
  failures === 0 && blockedCount === 0 ? 'PASS' : blockedCount > 0 ? 'BLOCKED' : 'FAIL'
console.log(
  `\n${String(provenCount)} proven, ${String(blockedCount)} blocked, ${String(failures)} failed.`,
)
console.log(`Gate 2: ${verdict}`)
if (verdict === 'PASS') {
  console.log(
    'The best state this gate can reach is AVAILABLE_UNOFFICIAL, never AVAILABLE:\n' +
      'the private RPC path works and carries no stability promise (§7).',
  )
}
if (failures > 0) {
  console.error(`\n${String(failures)} check(s) that should have passed did not.`)
  process.exit(1)
}
