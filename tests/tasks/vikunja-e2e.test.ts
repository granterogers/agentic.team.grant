import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolated } from '../../scripts/isolated/guard.ts'
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { permitEverything, type SyncGate, syncOnce } from '../../src/tasks/sync.ts'
import { VikunjaProvider } from '../../src/tasks/vikunja.ts'
import { FakeVikunja } from './fake-vikunja.ts'

/*
  The REAL sync round (src/tasks/sync.ts) and the REAL database functions (app.tasks_to_push, task_pushed, task_pulled,
  task_delete_pushed, the tombstone trigger) against an in-memory Vikunja (tests/tasks/fake-vikunja.ts).

  It needs a marked local replica of the schema, which is not something every checkout has, so it runs only when
  VIK_REPLICA_DB names one (a Unix-socket database carrying the replica marker - `isolated()` refuses anything else):

      VIK_REPLICA_DB=cand_vik npx vitest run tests/tasks/vikunja-e2e.test.ts

  Every test runs inside one transaction that is rolled back, so nothing is left behind and nothing is committed.
*/
const REPLICA = process.env.VIK_REPLICA_DB
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const obj = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

describe.skipIf(REPLICA === undefined)(
  'two-way sync against a Vikunja-shaped server, real database',
  () => {
    let db: PgExecutor
    let office = ''
    let v: FakeVikunja
    let p: VikunjaProvider
    const mkProvider = (over: { timeoutMs?: number } = {}) =>
      new VikunjaProvider({
        baseUrl: 'https://v.test',
        token: 'tk_secret',
        projectId: v.projectId,
        fetch: v.fetch,
        ...over,
      })
    const round = async (gate: SyncGate = permitEverything, fresh = true) => {
      // The duty builds a new provider every tick; a crash loses everything the old instance remembered.
      if (fresh) p = mkProvider()
      return await syncOnce(db, p, gate, { office })
    }
    const q = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
    const add = async (title: string, extra = ''): Promise<string> =>
      String(
        obj(
          (
            await q(
              `select app.my_task_add(p_office => ${lit(office)}::uuid, p_title => ${lit(title)}${extra}) as r`,
            )
          )[0]?.r,
        ).id,
      )
    const edit = async (id: string, args: string) =>
      await q(
        `select app.my_task_set(p_office => ${lit(office)}::uuid, p_task_id => ${lit(id)}, ${args}) as r`,
      )
    const task = async (id: string) =>
      (
        await q(
          `select title, detail, state, priority, due_on::text as due_on, revision from public.tasks where task_id = ${lit(id)}::uuid`,
        )
      )[0] as Record<string, unknown>
    const link = async (id: string) =>
      (
        await q(
          `select external_id, sync_state, sync_error, synced_revision from public.task_links where task_id = ${lit(id)}::uuid and provider = 'vikunja'`,
        )
      )[0]
    const countTasks = async (title: string) =>
      Number(
        (
          await q(
            `select count(*)::int as n from public.tasks where office_id = ${lit(office)}::uuid and title = ${lit(title)}`,
          )
        )[0]?.n,
      )

    beforeAll(async () => {
      db = await isolated(REPLICA as string)
      office = String((await q('select app.test_office() as o'))[0]?.o)
    })
    afterAll(async () => {
      await db.end()
    })
    beforeEach(async () => {
      v = new FakeVikunja()
      p = mkProvider()
      await q('begin')
    })
    afterEach(async () => {
      await q('rollback')
    })

    it('create here: pushed once, marked, linked, and a second round changes nothing', async () => {
      const id = await add(
        'Pay the printer',
        `, p_detail => 'Before Friday', p_priority => 20, p_due_on => '2026-10-09'`,
      )
      const r1 = await round()
      expect(r1).toMatchObject({ pushed: 1, created: 0, failed: 0, down: null })
      const [rt] = [...v.tasks.values()]
      expect(rt?.title).toBe('Pay the printer')
      expect(rt?.priority).toBe(3)
      expect(rt?.due_date).toBe('2026-10-09T00:00:00Z')
      expect(rt?.description).toContain(`[agentic:${id}]`)
      expect((await link(id))?.sync_state).toBe('ok')
      const writes = v.calls.filter((c) => /^(PUT|POST|DELETE)/.test(c)).length
      const r2 = await round()
      expect(r2).toMatchObject({ pushed: 0, deleted: 0, created: 0, conflicts: 0, failed: 0 })
      expect(v.calls.filter((c) => /^(PUT|POST|DELETE)/.test(c)).length).toBe(writes)
      // and the pull did not move the canonical revision (idempotent apply)
      expect((await task(id)).detail).toBe('Before Friday')
    })

    it('a multi-line note round-trips unchanged (what he wrote is what he reads)', async () => {
      const id = await add('Note', `, p_detail => E'line one\\nline two'`)
      await round()
      await round()
      expect((await task(id)).detail).toBe('line one\nline two')
    })

    it('edit here: the same remote task is UPDATED (by external id), never recreated', async () => {
      const id = await add('Draft the brief')
      await round()
      await edit(id, `p_title => 'Draft the brief v2', p_priority => 10`)
      const r = await round()
      expect(r.pushed).toBe(1)
      expect(v.tasks.size).toBe(1)
      const rt = [...v.tasks.values()][0]
      expect(rt?.title).toBe('Draft the brief v2')
      expect(rt?.priority).toBe(4)
    })

    it('edit in Vikunja: pulled into the office, and not pushed straight back', async () => {
      const id = await add('Call the roofer')
      await round()
      const rt = [...v.tasks.values()][0]
      v.edit(Number(rt?.id), {
        title: 'Call the roofer today',
        done: true,
        priority: 4,
        due_date: '2026-10-12T15:30:00Z',
      })
      const r = await round()
      expect(r).toMatchObject({ pulled: 1, conflicts: 0 })
      expect(await task(id)).toMatchObject({
        title: 'Call the roofer today',
        state: 'done',
        priority: 10,
        due_on: '2026-10-12',
      })
      const writes = v.calls.filter((c) => /^(PUT|POST)/.test(c)).length
      const r2 = await round()
      expect(r2.pushed).toBe(0)
      expect(v.calls.filter((c) => /^(PUT|POST)/.test(c)).length).toBe(writes)
    })

    it('a task made in Vikunja arrives once, and its title colliding with an existing one makes a second, not a merge', async () => {
      await add('Invoice run')
      await round()
      v.seed('Invoice run')
      const r = await round()
      expect(r.created).toBe(1)
      expect(await countTasks('Invoice run')).toBe(2)
      await round()
      await round()
      expect(await countTasks('Invoice run')).toBe(2)
      expect(v.tasks.size).toBe(2)
    })

    it('delete here: the remote is removed, the tombstone is cleared, and nothing is resurrected', async () => {
      const id = await add('Cancel the van')
      await round()
      await q(`select app.my_task_delete(${lit(office)}::uuid, ${lit(id)}, 'test')`)
      const r = await round()
      expect(r.deleted).toBe(1)
      expect(v.tasks.size).toBe(0)
      expect(
        Number(
          (
            await q(
              "select count(*)::int as n from public.task_tombstones where cleared_at is null and title = 'Cancel the van'",
            )
          )[0]?.n,
        ),
      ).toBe(0)
      const r2 = await round()
      expect(r2).toMatchObject({ deleted: 0, created: 0 })
      expect(await countTasks('Cancel the van')).toBe(0)
    })

    it('delete here while the gate holds the remote delete: the remote is NOT re-imported as new', async () => {
      const id = await add('Return the keys')
      await round()
      await q(`select app.my_task_delete(${lit(office)}::uuid, ${lit(id)}, 'test')`)
      const hold: SyncGate = { mayWrite: async () => true, mayDelete: async () => false }
      const r = await round(hold)
      expect(r.held).toBeGreaterThan(0)
      expect(v.tasks.size).toBe(1)
      expect(await countTasks('Return the keys')).toBe(0)
      // approved on a later round
      expect((await round()).deleted).toBeGreaterThan(0)
      expect(v.tasks.size).toBe(0)
    })

    it('a lost create record is ADOPTED by the next round, not duplicated', async () => {
      const id = await add('Order the timber')
      // The remote create happened; the crash came before app.task_pushed.
      await mkProvider().upsert({
        id,
        revision: 1,
        title: 'Order the timber',
        detail: '',
        done: false,
        priority: null,
        dueOn: null,
        externalId: null,
        externalProjectId: null,
      })
      expect(v.tasks.size).toBe(1)
      const r = await round()
      expect(r.pushed).toBe(1)
      expect(v.tasks.size).toBe(1)
      expect(await countTasks('Order the timber')).toBe(1)
      expect((await link(id))?.external_id).toBe(String([...v.tasks.keys()][0]))
    })

    it('a lost create record is adopted even when the push never gets to it (held or past the limit): the pull must not import a second copy', async () => {
      const id = await add('Book the venue')
      await mkProvider().upsert({
        id,
        revision: 1,
        title: 'Book the venue',
        detail: '',
        done: false,
        priority: null,
        dueOn: null,
        externalId: null,
        externalProjectId: null,
      })
      const holdWrites: SyncGate = { mayWrite: async () => false, mayDelete: async () => true }
      await round(holdWrites)
      expect(await countTasks('Book the venue')).toBe(1)
      expect(v.tasks.size).toBe(1)
      // and the remote copy is now linked to the task he already has
      expect((await link(id))?.external_id).toBe(String([...v.tasks.keys()][0]))
    })

    it('a marked remote task whose canonical task was deleted is not brought back to life', async () => {
      const id = await add('Ghost task')
      await mkProvider().upsert({
        id,
        revision: 1,
        title: 'Ghost task',
        detail: '',
        done: false,
        priority: null,
        dueOn: null,
        externalId: null,
        externalProjectId: null,
      })
      // He deletes it here before the link was ever recorded: no link, so no tombstone is written.
      await q(`select app.my_task_delete(${lit(office)}::uuid, ${lit(id)}, 'test')`)
      await round()
      expect(await countTasks('Ghost task')).toBe(0)
    })

    it('both sides changed: the copy here wins and the remote is brought into line', async () => {
      const id = await add('Pick the paint')
      await round()
      const rt = [...v.tasks.values()][0]
      await edit(id, `p_title => 'Pick the paint (here)'`)
      v.edit(Number(rt?.id), { title: 'Pick the paint (there)' })
      const r = await round()
      expect((await task(id)).title).toBe('Pick the paint (here)')
      expect([...v.tasks.values()][0]?.title).toBe('Pick the paint (here)')
      // Recorded for the audit: whether the round told anyone it overwrote his Vikunja edit.
      expect(typeof r.conflicts).toBe('number')
    })

    describe('known limits, pinned as they are today (not defects fixed here; see docs/ux-be-vik-vikunja-audit.md)', () => {
      it('a title longer than Vikunja allows (250) is cut there and the cut copy is pulled back over the original', async () => {
        const long = `${'a'.repeat(260)}`
        const id = await add(long)
        await round()
        await round()
        expect(String((await task(id)).title)).toHaveLength(250)
      })

      it('a task deleted in Vikunja is not deleted here; editing it here then fails at the provider on every round', async () => {
        const id = await add('Deleted over there')
        await round()
        v.tasks.clear()
        expect(await countTasks('Deleted over there')).toBe(1)
        await edit(id, `p_title => 'Deleted over there v2'`)
        const r = await round()
        expect(r.failed).toBe(1)
        expect(String((await link(id))?.sync_error)).toMatch(/404/)
        expect((await link(id))?.sync_state).toBe('error')
      })

      it('a Vikunja edit made while the office also edited is overwritten without being counted as a conflict', async () => {
        const id = await add('Quiet overwrite')
        await round()
        const rt = [...v.tasks.values()][0]
        await edit(id, `p_title => 'Quiet overwrite (here)'`)
        v.edit(Number(rt?.id), { title: 'Quiet overwrite (there)' })
        const r = await round()
        expect(r.conflicts).toBe(0)
        expect([...v.tasks.values()][0]?.title).toBe('Quiet overwrite (here)')
      })
    })

    describe('failure behaviour', () => {
      it('an outage mid-round (503) changes nothing and the watermark does not move; the next round catches up', async () => {
        const id = await add('Chase the invoice')
        v.faults = [{ on: 'PUT', status: 503, times: 1 }]
        const r1 = await round()
        expect(r1.down).toMatch(/503/)
        expect(await link(id)).toBeUndefined()
        expect(v.tasks.size).toBe(0)
        const r2 = await round()
        expect(r2).toMatchObject({ pushed: 1, down: null })
        expect(v.tasks.size).toBe(1)
      })

      it('a listing that fails (page 2) pulls nothing and reports the outage', async () => {
        for (let i = 0; i < 60; i += 1) v.seed(`remote ${String(i)}`)
        v.faults = [{ on: 'page=2', status: 502 }]
        const r = await round()
        expect(r.down).toMatch(/502/)
        expect(r.created).toBe(0)
        expect(await countTasks('remote 0')).toBe(0)
      })

      it('a 401 ends the round with a sentence about the token, not about reachability', async () => {
        await add('Anything')
        v.faults = [{ on: '', status: 401 }]
        const r = await round()
        expect(r.down).toMatch(/token was refused/)
        expect(r.failed).toBe(0)
      })

      it('a 400 on one create is recorded against that task and the others still go', async () => {
        const bad = await add('Bad one')
        await add('Good one')
        v.faults = [{ on: 'PUT', status: 400, times: 1 }]
        const r = await round()
        expect(r).toMatchObject({ failed: 1, pushed: 1 })
        expect((await link(bad))?.sync_state).toBe('error')
        expect(v.tasks.size).toBe(1)
      })

      it('a task whose first create was refused is CREATED on a later round, not updated at an id that never existed', async () => {
        const id = await add('Retry me')
        v.faults = [{ on: 'PUT', status: 400, times: 1 }]
        await round()
        const r = await round()
        expect(r).toMatchObject({ pushed: 1, failed: 0 })
        expect(v.calls.some((c) => c.includes('/tasks/pending'))).toBe(false)
        expect(v.tasks.size).toBe(1)
        expect((await link(id))?.sync_state).toBe('ok')
      })

      it('deleting a task whose first create was refused does not wedge every later round', async () => {
        const id = await add('Doomed')
        await add('Innocent bystander')
        v.faults = [{ on: 'PUT', status: 400, times: 2 }]
        await round()
        await q(`select app.my_task_delete(${lit(office)}::uuid, ${lit(id)}, 'test')`)
        v.faults = []
        const r = await round()
        expect(r.down).toBeNull()
        expect(v.byTitle('Innocent bystander')).toHaveLength(1)
        expect(v.calls.some((c) => c.includes('/tasks/pending'))).toBe(false)
      })

      it('a refused delete at the remote (403) does not stop the rest of the round', async () => {
        const id = await add('Stuck delete')
        await round()
        await q(`select app.my_task_delete(${lit(office)}::uuid, ${lit(id)}, 'test')`)
        await add('Fresh task')
        v.faults = [{ on: 'DELETE', status: 403 }]
        const r = await round()
        // 403 is a refused credential: the round ends in words and nothing else is half-done.
        expect(r.down).toMatch(/token was refused/)
      })
    })
  },
)
