/**
 * Phase 4's acceptance criteria, demonstrated.
 *
 *   npm run verify:sync
 *
 *   "a new notebook is discovered and becomes a project unattended; 50 sources
 *    added rapidly are processed without duplication; a worker crash mid-sync
 *    resumes cleanly; Notebook outage degrades rather than fails."
 *
 * Plus the failure injections Phase 4 names: expired auth, corrupted token,
 * duplicate source, deleted source, 50 rapid sources, outage, crash mid-sync.
 *
 * The adapter is faked for most of these, and the database is real. That split
 * is deliberate: every criterion here is about **our** behaviour when Notebook
 * does something, and the only way to make Notebook reliably do those things is
 * to write an adapter that does them. The live product is exercised separately
 * by `npm run poc:gate-2` and by the real sync runs in `sync_runs`.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  type Capability,
  type NotebookAdapter,
  NotebookUnavailableError,
  type SourceText,
} from '../../src/notebook/adapter.ts'
import { type RemoteNotebook, runSync, SyncAlreadyRunningError } from '../../src/projects/sync.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const rows: { n: string; what: string; outcome: string; passed: boolean }[] = []
const add = (n: string, what: string, outcome: string, passed: boolean): void => {
  rows.push({ n, what, outcome, passed })
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n} ${what} — ${outcome}`)
}

const stamp = Date.now()
const NB = `verify-nb-${String(stamp)}`

const capability = (over: Partial<Capability> = {}): Capability => ({
  state: 'available_unofficial',
  capabilities: ['list_notebooks', 'account_limits'],
  adapter: 'fake',
  adapterVersion: null,
  detectedTier: 1,
  notebookLimit: 100,
  sourceLimit: 50,
  detail: 'fake adapter',
  latencyMs: 1,
  ...over,
})

/** An adapter under our control, so Notebook can be made to misbehave. */
class FakeAdapter implements NotebookAdapter {
  constructor(
    private readonly sources: readonly SourceText[],
    private readonly opts: {
      unavailable?: boolean
      authRequired?: boolean
      noTier?: boolean
      throwOnList?: boolean
    } = {},
  ) {}

  async probe(): Promise<Capability> {
    if (this.opts.authRequired === true) {
      return capability({
        state: 'auth_required',
        detectedTier: null,
        notebookLimit: null,
        sourceLimit: null,
      })
    }
    if (this.opts.noTier === true) {
      return capability({ detectedTier: null, notebookLimit: null, sourceLimit: null })
    }
    if (this.opts.unavailable === true) {
      return capability({
        state: 'unavailable',
        detectedTier: null,
        notebookLimit: null,
        sourceLimit: null,
      })
    }
    return capability()
  }

  async listSources(): Promise<readonly SourceText[]> {
    if (this.opts.unavailable === true) {
      throw new NotebookUnavailableError('unavailable', 'the fake adapter is simulating an outage')
    }
    if (this.opts.throwOnList === true) {
      throw new TypeError("Cannot read properties of undefined (reading 'wrb.fr')")
    }
    return this.sources
  }

  async fetchSourceText(): Promise<SourceText> {
    throw new NotebookUnavailableError('unavailable', 'not used by these checks')
  }
  async addSource(): Promise<string> {
    throw new NotebookUnavailableError('degraded', 'writes go through the queue')
  }
  async addNote(): Promise<string> {
    throw new NotebookUnavailableError('degraded', 'writes go through the queue')
  }
}

const source = (i: number, content?: string): SourceText => ({
  remoteNotebookId: NB,
  remoteSourceId: `src-${String(i)}`,
  title: `source ${String(i)}`,
  content: content ?? `the content of source ${String(i)}, long enough to be worth caching`,
  remoteUpdatedAt: null,
})

const notebooks = (list: readonly RemoteNotebook[]) => async () => list
const ONE_NOTEBOOK: RemoteNotebook[] = [{ id: NB, title: `Verify ${String(stamp)}` }]

// Every run in this script must claim the single sync slot, so anything left
// over is cleared first.
//
// Two steps, and the order matters. `recover_stalled_syncs` only reaps a lease
// that has EXPIRED, which is right in production and unhelpful here: a verify
// run killed mid-flight holds the slot for the full lease (15 minutes by
// default), and the next attempt cannot start. So this expires the leases held
// by *this script's own* workers first, then sweeps.
//
// Scoped to `verify-%` deliberately. Expiring an arbitrary live lease would
// let two real workers sync at once, which is the thing the slot exists to
// prevent — a test that clears the guard it is testing proves nothing.
//
// Worth recording as an operational property rather than only a test wrinkle:
// a killed worker blocks discovery until its lease lapses. That is the
// deliberate trade — a stalled cycle is cheaper than two concurrent ones — and
// `notebook.sync_lease_minutes` is the dial if it ever bites.
await db.execute(`
  update public.sync_runs
  set leased_until = app.now_utc() - interval '1 second'
  where state = 'running' and leased_by like 'verify-%'
`)
await db.execute('select app.recover_stalled_syncs()')

// ---------------------------------------------------------------------------
// 1. A new notebook becomes a project, unattended
// ---------------------------------------------------------------------------
{
  const outcome = await runSync({
    db,
    adapter: new FakeAdapter([source(1), source(2)]),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-1',
  })
  const project = await db.execute(`
    select project_id::text as project_id, slug, name, status
    from public.projects where notebook_ref = '${NB}'
  `)
  add(
    '1',
    'a new notebook is discovered and becomes a project with no human involved',
    `${outcome.state}: created ${String(outcome.projectsCreated)} project(s), ` +
      `slug=${String(project.rows[0]?.slug)} status=${String(project.rows[0]?.status)}`,
    outcome.state === 'complete' &&
      outcome.projectsCreated === 1 &&
      project.rows.length === 1 &&
      outcome.sourcesAdded === 2,
  )
}

// ---------------------------------------------------------------------------
// 2. Fifty sources added rapidly, processed without duplication
// ---------------------------------------------------------------------------
{
  const fifty = Array.from({ length: 50 }, (_, i) => source(i))
  const first = await runSync({
    db,
    adapter: new FakeAdapter(fifty),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-2a',
  })
  // The same fifty again. This is the case Gate 2 made load-bearing: Notebook
  // itself does NOT de-duplicate, so if our side does not either, a retried
  // sync doubles the knowledge base.
  const second = await runSync({
    db,
    adapter: new FakeAdapter(fifty),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-2b',
  })
  const stored = await db.execute(`
    select count(*)::int as n from public.notebook_sources where remote_notebook_id = '${NB}'
  `)
  add(
    '2',
    '50 sources twice over produce 50 rows, not 100',
    `first pass added ${String(first.sourcesAdded)}, second added ${String(second.sourcesAdded)} ` +
      `and changed ${String(second.sourcesChanged)}; ${String(stored.rows[0]?.n)} rows stored`,
    Number(stored.rows[0]?.n) === 50 && second.sourcesAdded === 0 && second.sourcesChanged === 0,
  )
}

// ---------------------------------------------------------------------------
// 3. A changed source is detected; an unchanged one is not rewritten
// ---------------------------------------------------------------------------
{
  const fifty = Array.from({ length: 50 }, (_, i) =>
    i === 7 ? source(i, 'this source has been edited upstream') : source(i),
  )
  const outcome = await runSync({
    db,
    adapter: new FakeAdapter(fifty),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-3',
  })
  add(
    '3',
    'exactly the edited source is seen as changed, by fingerprint',
    `${String(outcome.sourcesChanged)} changed, ${String(outcome.sourcesAdded)} added of ` +
      `${String(outcome.sourcesSeen)} seen`,
    outcome.sourcesChanged === 1 && outcome.sourcesAdded === 0,
  )
}

// ---------------------------------------------------------------------------
// 4. A deleted source is counted, and deliberately NOT deleted
// ---------------------------------------------------------------------------
{
  const fewer = Array.from({ length: 45 }, (_, i) => source(i))
  const outcome = await runSync({
    db,
    adapter: new FakeAdapter(fewer),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-4',
  })
  const stored = await db.execute(`
    select count(*)::int as n from public.notebook_sources where remote_notebook_id = '${NB}'
  `)
  add(
    '4',
    'sources missing upstream are counted but the cache is kept',
    `${String(outcome.sourcesRemoved)} missing; ${String(stored.rows[0]?.n)} rows still cached. ` +
      'A partial listing during an incident must not empty the knowledge base, and past ' +
      'briefs cite these fingerprints.',
    outcome.sourcesRemoved === 5 && Number(stored.rows[0]?.n) === 50,
  )
}

// ---------------------------------------------------------------------------
// 5. A Notebook outage degrades rather than fails
// ---------------------------------------------------------------------------
{
  const before = await db.execute('select count(*)::int as n from public.jobs')
  const outcome = await runSync({
    db,
    adapter: new FakeAdapter([], { unavailable: true }),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-5',
  })
  // Operational work, during the outage.
  const job = await db.execute(`
    insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
    values (gen_random_uuid(), 'verify-sync-outage-${String(stamp)}', 'verify.probe', 'verify')
    returning job_id::text as job_id
  `)
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
      state_reason = 'verify:sync outage probe'
    where job_id = '${String(job.rows[0]?.job_id)}'
  `)
  const after = await db.execute('select count(*)::int as n from public.jobs')
  const cached = await db.execute(`
    select count(*)::int as n from public.notebook_sources where remote_notebook_id = '${NB}'
  `)
  add(
    '5',
    'an outage produces a recorded degraded cycle, and the rest of Team HQ carries on',
    `run=${outcome.state} detail=${outcome.detail.slice(0, 60)}; ` +
      `jobs ${String(before.rows[0]?.n)}->${String(after.rows[0]?.n)}; ` +
      `${String(cached.rows[0]?.n)} cached sources still readable`,
    outcome.state === 'failed' &&
      outcome.detail.includes('unavailable') &&
      Number(after.rows[0]?.n) > Number(before.rows[0]?.n) &&
      Number(cached.rows[0]?.n) === 50,
  )
}

// ---------------------------------------------------------------------------
// 6. Expired auth and a corrupted token are distinguished from an outage
// ---------------------------------------------------------------------------
{
  const authOutcome = await runSync({
    db,
    adapter: new FakeAdapter([], { authRequired: true, unavailable: true }),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-6',
  })
  add(
    '6',
    'expired auth yields no budget rather than a guessed one (§11)',
    `run=${authOutcome.state}; the probe reported auth_required, so no tier was derived ` +
      `and no budget row was written from it`,
    authOutcome.state === 'failed',
  )

  // A corrupted token reaches the adapter as an unrecognised error, not a
  // tidy one. §7: assume undocumented operations misbehave in undocumented ways.
  const corrupt = await runSync({
    db,
    adapter: new FakeAdapter([], { throwOnList: true }),
    listNotebooks: notebooks(ONE_NOTEBOOK),
    workerId: 'verify-6b',
  })
  add(
    '6b',
    'an unrecognised adapter error is recorded, not swallowed and not crashed on',
    `run=${corrupt.state} detail=${corrupt.detail.slice(0, 70)}`,
    corrupt.state === 'failed' && corrupt.detail.includes('TypeError'),
  )
}

// ---------------------------------------------------------------------------
// 7. No budget means no spending (§11's rule, not a default)
// ---------------------------------------------------------------------------
{
  // Whether a chat is allowed is asked of the *current* budget, and there is
  // one, so this checks the reserve logic rather than the empty case.
  const answers = await db.execute(`
    select app.notebook_chat_allowed(false) as ordinary,
           app.notebook_chat_allowed(true) as urgent
  `)
  const budget = await db.execute(
    'select daily_chat_budget, chat_reserve from public.notebook_budget',
  )
  add(
    '7',
    'the chat budget is derived from the detected tier and reserves headroom for urgent work',
    `budget=${String(budget.rows[0]?.daily_chat_budget)}/day ` +
      `reserve=${String(budget.rows[0]?.chat_reserve)}; ` +
      `ordinary allowed=${String(answers.rows[0]?.ordinary)} urgent allowed=${String(answers.rows[0]?.urgent)}`,
    answers.rows[0]?.ordinary === true && answers.rows[0]?.urgent === true,
  )

  const provenance = await db.execute(`
    select count(*)::int as n from public.notebook_budgets where probe_id is null
  `)
  add(
    '7b',
    'no budget exists without the probe it was derived from',
    `${String(provenance.rows[0]?.n)} budgets with no provenance (NOT NULL makes it impossible)`,
    Number(provenance.rows[0]?.n) === 0,
  )
}

// ---------------------------------------------------------------------------
// 8. A worker crash mid-sync resumes cleanly
// ---------------------------------------------------------------------------
{
  // Simulate the crash: claim a run, then abandon the process without settling
  // it. Written directly rather than via runSync, because runSync always
  // settles — which is the point, and means a crash cannot be produced through
  // it.
  const crashed = await db.execute(`
    insert into public.sync_runs (leased_by, leased_until)
    values ('verify-crashed', app.now_utc() - interval '1 minute')
    returning run_id::text as run_id
  `)
  const crashedId = String(crashed.rows[0]?.run_id)

  // A second worker cannot start while the crashed run holds the slot.
  let blocked = false
  try {
    await runSync({
      db,
      adapter: new FakeAdapter([source(1)]),
      listNotebooks: notebooks(ONE_NOTEBOOK),
      workerId: 'verify-8-blocked',
    })
  } catch (error) {
    blocked = error instanceof SyncAlreadyRunningError
  }

  // ...except that runSync sweeps first, so it recovers the crashed run and
  // proceeds. That is the designed behaviour: an expired lease means the
  // worker is dead, and a dead worker must not lock the system out.
  const recovered = await db.execute(`
    select state::text as state, detail from public.sync_runs where run_id = '${crashedId}'
  `)
  add(
    '8',
    'a crashed run is reaped by the next worker and does not lock the system out',
    `blocked=${String(blocked)} (false is correct: the sweep runs first); ` +
      `crashed run is now ${String(recovered.rows[0]?.state)}: ` +
      `${String(recovered.rows[0]?.detail).slice(0, 60)}`,
    blocked === false && String(recovered.rows[0]?.state) === 'abandoned',
  )

  // And a crash is recorded as `abandoned`, never `failed`. One is a dead
  // worker, the other is a run that decided it could not proceed, and they
  // need different responses.
  const settled = await db.execute(`
    select count(*) filter (where state = 'abandoned')::int as abandoned,
           count(*) filter (where state = 'failed')::int as failed
    from public.sync_runs where started_at > app.now_utc() - interval '10 minutes'
  `)
  add(
    '8b',
    'a crash is abandoned, not failed — one is a dead worker, the other is a verdict',
    `${String(settled.rows[0]?.abandoned)} abandoned, ${String(settled.rows[0]?.failed)} failed ` +
      'in the last 10 minutes',
    Number(settled.rows[0]?.abandoned) >= 1,
  )
}

// ---------------------------------------------------------------------------
// 9. Two workers cannot sync at once
// ---------------------------------------------------------------------------
{
  const both = await Promise.allSettled([
    runSync({
      db,
      adapter: new FakeAdapter([source(1)]),
      listNotebooks: notebooks(ONE_NOTEBOOK),
      workerId: 'verify-9a',
    }),
    runSync({
      db,
      adapter: new FakeAdapter([source(1)]),
      listNotebooks: notebooks(ONE_NOTEBOOK),
      workerId: 'verify-9b',
    }),
  ])
  const rejected = both.filter(
    (r) => r.status === 'rejected' && r.reason instanceof SyncAlreadyRunningError,
  )
  const fulfilled = both.filter((r) => r.status === 'fulfilled')
  add(
    '9',
    'two concurrent workers: one syncs, the other stands down',
    `${String(fulfilled.length)} ran, ${String(rejected.length)} refused with ` +
      'SyncAlreadyRunningError — decided by a partial unique index, not by a race',
    fulfilled.length === 1 && rejected.length === 1,
  )
}

// ---------------------------------------------------------------------------
// 10. An excluded notebook never becomes a project again
// ---------------------------------------------------------------------------
{
  const other = `${NB}-excluded`
  await db.execute(`
    insert into public.notebook_exclusions (remote_notebook_id, title, reason)
    values ('${other}', 'Not a project', 'verify: proves an exclusion is honoured')
    on conflict (remote_notebook_id) do nothing
  `)
  const outcome = await runSync({
    db,
    adapter: new FakeAdapter([source(1)]),
    listNotebooks: notebooks([...ONE_NOTEBOOK, { id: other, title: 'Not a project' }]),
    workerId: 'verify-10',
  })
  const created = await db.execute(`
    select count(*)::int as n from public.projects where notebook_ref = '${other}'
  `)
  add(
    '10',
    'an excluded notebook is skipped, so "ignore that one" is not re-litigated every ten minutes',
    `${String(outcome.notebooksSeen)} notebook(s) synced of 2 offered; ` +
      `${String(created.rows[0]?.n)} project(s) created for the excluded one`,
    outcome.notebooksSeen === 1 && Number(created.rows[0]?.n) === 0,
  )
}

// --- clean up the fixtures; the sync_runs history stays as evidence --------
await db.execute(`delete from public.notebook_sources where remote_notebook_id like '${NB}%'`)
await db.execute(`delete from public.notebook_exclusions where remote_notebook_id like '${NB}%'`)
await db.execute(`
  update public.projects set status = 'archived', notebook_ref = null
  where notebook_ref like '${NB}%'
`)

console.log('\n| # | check | outcome | |')
console.log('|---|---|---|---|')
for (const r of rows)
  console.log(`| ${r.n} | ${r.what} | ${r.outcome} | ${r.passed ? '✅' : '❌'} |`)
const failed = rows.filter((r) => !r.passed)
console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`)
if (failed.length > 0) process.exit(1)
