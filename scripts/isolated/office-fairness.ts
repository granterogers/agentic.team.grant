/**
 * Tenant fairness and the shared budget (deep systems audit 6 October 2026, A-1 / C8 / A-2; migration 1025).
 *
 *   npx tsx scripts/isolated/office-fairness.ts <replica database>
 *
 * Runs on a LOCAL replica only (guard.ts). Everything happens inside one transaction that is rolled back, so the
 * replica is left exactly as it was found. The same file is the reproduction: pointed at a schema before 1025 it
 * goes red on the three defects, and pointed at 1025 it goes green.
 *
 *   1. one office driving an agent past ITS ceiling must not defer another office's queued work for that agent
 *   2. the office-wide ceiling counts the office's own spend and nobody else's
 *   3. a person's own conversation is never parked by the budget
 *   4. one office's burst must not make another office (the operator included) wait behind all of it
 *
 * Every refusal has its positive control (an office over its OWN ceiling is still held; a lone office still uses
 * every slot; a normal day moves nothing), because a proof made only of "nothing happened" passes on a system that
 * does nothing.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'fairness')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string) => (await rows(sql))[0] ?? {}
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
/** Run a block and report an exception as a failed check, so a missing function reads as red and not as a crash. */
const attempt = async <T>(what: string, f: () => Promise<T>): Promise<T | undefined> => {
  await db.execute('savepoint attempt')
  try {
    const r = await f()
    await db.execute('release savepoint attempt')
    return r
  } catch (error) {
    await db.execute('rollback to savepoint attempt')
    check(what, false, `threw: ${(error as Error).message.slice(0, 160)}`)
    return undefined
  }
}

const BG = 'office.notice' // a background kind the budget may park
const INT = 'office.instruction' // a person's conversation, which it may not

type Office = { id: string; tag: string }
let seq = 0
const job = async (
  o: Office,
  s: {
    kind?: string
    state?: 'queued' | 'complete'
    agent?: string
    pence?: number
    by?: string
    priority?: number
    ageSeconds?: number
  } = {},
): Promise<string> => {
  seq += 1
  const state = s.state ?? 'queued'
  const r = await one(`
    insert into public.jobs (office_id, correlation_id, kind, state, requested_by, recipient_agent, priority,
                             idempotency_key, created_at, finished_at, trace_pence)
    values (${lit(o.id)}::uuid, gen_random_uuid(), ${lit(s.kind ?? BG)}, ${lit(state)},
            ${lit(s.by ?? `teamhq:${o.tag}`)}, ${lit(s.agent ?? 'research-director')}, ${String(s.priority ?? 100)},
            ${lit(`fair-${run}-${String(seq)}`)},
            now() - make_interval(secs => ${String(s.ageSeconds ?? 0)}),
            ${state === 'complete' ? 'app.now_utc()' : 'null'},
            ${s.pence === undefined ? 'null' : String(s.pence)})
    returning job_id::text as id`)
  return String(r.id)
}
const spend = (o: Office, agent: string, pence: number, by?: string) =>
  job(o, { state: 'complete', agent, pence, ...(by === undefined ? {} : { by }) })

const view = async (id: string) =>
  await one(`select state::text as state, state_reason,
                    (not_before is not null and not_before > app.now_utc()) as parked
               from public.jobs where job_id = ${lit(id)}::uuid`)
const parked = async (id: string) => (await view(id)).parked === true

const savepoint = async (name: string, body: () => Promise<void>) => {
  await db.execute(`savepoint ${name}`)
  try {
    await body()
  } finally {
    await db.execute(`rollback to savepoint ${name}`)
  }
}

await db.execute('begin')
try {
  // ---- a clean stage: nothing queued from earlier work, the shipped numbers, three slots ---------------------------
  await db.execute(`update public.jobs set state = 'cancelled', state_reason = 'proof: stage cleared'
                     where state = 'queued'`)
  await db.execute(`update public.system_config set value = to_jsonb(60) where key = 'budget.pence_per_agent_per_day';
                    update public.system_config set value = to_jsonb(200) where key = 'budget.pence_for_the_office_per_day'`)
  await db.execute(`update public.system_config set value = jsonb_set(value, '{max_concurrent_jobs}', '3')
                     where key = 'jobs.capacity'`)
  const mk = async (name: string): Promise<Office> => {
    // A person office needs a login first; the replica's auth.users takes a bare row.
    await db.execute(`insert into auth.users (id, email)
                      values (gen_random_uuid(), ${lit(`fair-${name}-${run}@example.invalid`)})`)
    const r = await one(`select (app.provision_person_office(${lit(`Fairness ${name}`)},
                                  ${lit(`fair-${name}-${run}@example.invalid`)},
                                  ${lit(`fair-${name.toLowerCase()}-${run}`)})->>'office_id') as id`)
    return { id: String(r.id), tag: `fair-${name.toLowerCase()}-${run}` }
  }
  const A = await mk('A')
  const B = await mk('B')
  const OP: Office = {
    id: String((await one('select app.operator_office()::text as id')).id),
    tag: `operator-${run}`,
  }
  check(
    'three distinct offices: the operator and two people',
    new Set([A.id, B.id, OP.id]).size === 3,
    `${OP.id.slice(0, 8)} ${A.id.slice(0, 8)} ${B.id.slice(0, 8)}`,
  )

  // ======================================================================================================== BUDGET
  await savepoint('s1', async () => {
    // (1) B pushes ONE agent past its own ceiling. Nobody else spent anything.
    await spend(B, 'research-director', 70)
    const aBg = await job(A, { agent: 'research-director' })
    const aInt = await job(A, { kind: INT, agent: 'research-director' })
    const bBg = await job(B, { agent: 'research-director' })
    const bInt = await job(B, { kind: INT, agent: 'research-director' })
    const bOther = await job(B, { agent: 'strategy-director' })
    await attempt('defer_over_budget runs', () => rows('select app.defer_over_budget()'))
    check(
      "another office's queued work for that agent is NOT parked by B's spending",
      !(await parked(aBg)) && !(await parked(aInt)),
      `A background parked=${String(await parked(aBg))}, A conversation parked=${String(await parked(aInt))}`,
    )
    const held = await view(bBg)
    check(
      'POSITIVE CONTROL: the office that spent it is held, with the sentence on the job and the agent named',
      held.parked === true &&
        String(held.state_reason).includes('research-director') &&
        String(held.state_reason).includes('daily limit'),
      `B background parked=${String(held.parked)} reason=${String(held.state_reason).slice(0, 80)}`,
    )
    check(
      "B's conversation is not parked even though B is over (a person's turn is never swallowed)",
      !(await parked(bInt)),
      `B conversation parked=${String(await parked(bInt))}`,
    )
    check(
      'the ceiling is per agent: B is not held for an agent it did not overspend',
      !(await parked(bOther)),
      `B other agent parked=${String(await parked(bOther))}`,
    )
    const aHeld = await one(`select (app.held_for_budget(${lit(A.id)}::uuid))->>'jobs' as n`)
    const bHeld = await one(`select (app.held_for_budget(${lit(B.id)}::uuid))->>'jobs' as n`)
    check(
      "the dashboard's held count follows the same boundary",
      Number(aHeld.n) === 0 && Number(bHeld.n) === 1,
      `held_for_budget A=${String(aHeld.n)} B=${String(bHeld.n)}`,
    )
  })

  await savepoint('s2', async () => {
    // (2) The office-wide ceiling. B spends 210p spread over seven agents (30p each: none is over its own 60p).
    for (let i = 1; i <= 7; i += 1) await spend(B, `agent-${String(i)}`, 30)
    const aBg = await job(A, { agent: 'agent-1' })
    const bFresh = await job(B, { agent: 'agent-8' }) // an agent B has not spent on at all
    const spentA = await attempt('spent_today(office) runs', () =>
      one(`select app.spent_today(${lit(A.id)}::uuid) as a, app.spent_today(${lit(B.id)}::uuid) as b,
                  app.spent_today(${lit(OP.id)}::uuid) as op`),
    )
    check(
      "spent_today counts each office's own spend only",
      spentA !== undefined &&
        Number(spentA.a) === 0 &&
        Number(spentA.b) === 210 &&
        Number(spentA.op) === 0,
      JSON.stringify(spentA),
    )
    const why = await attempt('over_budget(office, agent) runs', () =>
      one(
        `select app.over_budget(${lit(A.id)}::uuid, 'agent-1') as a, app.over_budget(${lit(B.id)}::uuid, 'agent-8') as b`,
      ),
    )
    check(
      "the office ceiling does not count other offices: A is under (the old 'office' ceiling was the deployment's)",
      why !== undefined && why.a === null,
      `over_budget(A) = ${String(why?.a)}`,
    )
    check(
      'POSITIVE CONTROL: B, over the office ceiling on its own spend, is told so',
      why !== undefined && String(why.b).includes('the office has spent 210p'),
      `over_budget(B) = ${String(why?.b)}`,
    )
    await rows('select app.defer_over_budget()')
    check(
      "A's queued work is not held by B's office-wide spend",
      !(await parked(aBg)),
      `A parked=${String(await parked(aBg))}`,
    )
    check(
      'POSITIVE CONTROL: B is held for an agent it never spent on, because its office is over',
      await parked(bFresh),
      `B fresh-agent parked=${String(await parked(bFresh))}`,
    )
  })

  await savepoint('s2b', async () => {
    // An office over its OWN ceiling is still deferred, whoever else is under.
    await spend(A, 'research-director', 70)
    const aBg = await job(A, { agent: 'research-director' })
    const bBg = await job(B, { agent: 'research-director' })
    await rows('select app.defer_over_budget()')
    check(
      'POSITIVE CONTROL: A over ITS OWN per-agent ceiling is held; B (under) is not',
      (await parked(aBg)) && !(await parked(bBg)),
      `A parked=${String(await parked(aBg))} B parked=${String(await parked(bBg))}`,
    )
  })

  await savepoint('s2c', async () => {
    // The operator's own office over its ceiling: background held, conversation never.
    for (let i = 1; i <= 7; i += 1) await spend(OP, `agent-${String(i)}`, 30)
    const opBg = await job(OP, { agent: 'agent-9' })
    const opInt = await job(OP, { kind: INT, agent: 'agent-9' })
    const opPursue = await job(OP, { kind: 'office.pursue', agent: 'agent-9' })
    const aBg = await job(A, { agent: 'agent-9' })
    await rows('select app.defer_over_budget()')
    check(
      "the operator's conversation is never silently deferred (turn and plan continuation), though its background is",
      (await parked(opBg)) &&
        !(await parked(opInt)) &&
        !(await parked(opPursue)) &&
        !(await parked(aBg)),
      `background parked=${String(await parked(opBg))} turn parked=${String(await parked(opInt))} pursue parked=${String(await parked(opPursue))} other office parked=${String(await parked(aBg))}`,
    )
  })

  await savepoint('s2d', async () => {
    // Harness spend is nobody's spend; free work is no work; a normal two-office day moves nothing.
    await spend(B, 'research-director', 900, 'verify:fair-probe')
    for (let i = 0; i < 40; i += 1) await spend(B, 'research-director', 0)
    await spend(A, 'research-director', 10)
    await spend(B, 'research-director', 20)
    const a = await job(A)
    const b = await job(B)
    const i = await job(B, { kind: INT })
    const out = await one('select app.defer_over_budget() as r')
    check(
      'CONTROL: harness spend and free work are not spend, and a normal two-office day parks nothing',
      !(await parked(a)) &&
        !(await parked(b)) &&
        !(await parked(i)) &&
        Number((out.r as { agents_held: number }).agents_held) === 0,
      `agents_held=${JSON.stringify(out.r)}`,
    )
  })

  await savepoint('s2e', async () => {
    let said = 'accepted'
    await db.execute('savepoint nullprobe')
    try {
      await rows('select app.spent_today(null::uuid)')
    } catch (error) {
      said = (error as Error).message
    }
    await db.execute('rollback to savepoint nullprobe')
    check(
      'a null office is refused, never read as the whole deployment',
      said.includes('no_office'),
      said.slice(0, 100),
    )
  })

  // ======================================================================================================== QUEUE
  const claim = async (
    scope: string | null = null,
  ): Promise<{ id: string; office: string } | null> => {
    const r = await rows(`select job_id::text as id, office_id::text as office
                            from app.dequeue_job('fair-w-${run}', true, true, null,
                                                 ${scope === null ? 'null' : lit(scope)})`)
    return r[0] === undefined ? null : { id: String(r[0].id), office: String(r[0].office) }
  }
  const free = (id: string) =>
    rows(`update public.jobs set state = 'cancelled', state_reason = 'proof: slot freed'
           where job_id = ${lit(id)}::uuid`)

  const burstThen = async (late: Office, label: string) => {
    await savepoint(`q_${label}`, async () => {
      // B enqueues 200 jobs, oldest first, then a late office enqueues one.
      await rows(`insert into public.jobs (office_id, correlation_id, kind, state, requested_by, recipient_agent,
                                           idempotency_key, created_at)
                  select ${lit(B.id)}::uuid, gen_random_uuid(), ${lit(BG)}, 'queued', ${lit(`teamhq:${B.tag}`)},
                         'research-director', ${lit(`burst-${run}-${label}-`)} || g,
                         now() - make_interval(secs => 1000 - g)
                    from generate_series(1, 200) g`)
      const running: string[] = []
      for (let i = 0; i < 3; i += 1) {
        const c = await claim()
        if (c) running.push(c.id)
      }
      const fromB = (
        await rows(`select count(*)::int as n from public.jobs
                                  where job_id = any(${lit(`{${running.join(',')}}`)}::uuid[]) and office_id = ${lit(B.id)}::uuid`)
      )[0]
      check(
        `CONTROL (${label}): a lone office still fills every slot (no cap while nobody else is waiting)`,
        running.length === 3 && Number(fromB?.n) === 3,
        `${String(running.length)} running, ${String(fromB?.n)} of them B's`,
      )
      const lateId = await job(late, { ageSeconds: 0, kind: INT, by: `teamhq:${late.tag}` })
      let waitedBehind = 0
      let served = false
      for (let step = 0; step < 260 && !served; step += 1) {
        const oldest = running.shift()
        if (oldest !== undefined) await free(oldest)
        const c = await claim()
        if (c === null) break
        running.push(c.id)
        if (c.id === lateId) served = true
        else waitedBehind += 1
      }
      check(
        `a late office's job (${label}) does not wait behind the other office's burst`,
        served && waitedBehind <= 2,
        `served=${String(served)} after ${String(waitedBehind)} of B's 200 jobs`,
      )
    })
  }
  await burstThen(A, 'person')
  await burstThen(OP, 'operator')

  await savepoint('q_share', async () => {
    // After the late office is in, it keeps a share: five more of A's jobs are not each queued behind B's remainder.
    await rows(`insert into public.jobs (office_id, correlation_id, kind, state, requested_by, recipient_agent,
                                         idempotency_key, created_at)
                select ${lit(B.id)}::uuid, gen_random_uuid(), ${lit(BG)}, 'queued', ${lit(`teamhq:${B.tag}`)},
                       'research-director', ${lit(`share-${run}-`)} || g, now() - make_interval(secs => 1000 - g)
                  from generate_series(1, 120) g`)
    for (let g = 0; g < 6; g += 1) await job(A, { ageSeconds: 0, by: `teamhq:${A.tag}` })
    const running: string[] = []
    const claimedOrder: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const c = await claim()
      if (c) {
        running.push(c.id)
        claimedOrder.push(c.office === A.id ? 'A' : 'B')
      }
    }
    for (let step = 0; step < 60 && claimedOrder.filter((x) => x === 'A').length < 6; step += 1) {
      const oldest = running.shift()
      if (oldest !== undefined) await free(oldest)
      const c = await claim()
      if (c === null) break
      running.push(c.id)
      claimedOrder.push(c.office === A.id ? 'A' : 'B')
    }
    const lastA = claimedOrder.lastIndexOf('A')
    check(
      "a late office's whole small queue is served within a bounded number of claims, not after the burst",
      claimedOrder.filter((x) => x === 'A').length === 6 && lastA < 20,
      `A's sixth job was claim ${String(lastA + 1)}: ${claimedOrder.slice(0, 16).join('')}`,
    )
  })

  await savepoint('q_single', async () => {
    // One office alone: the order is exactly priority then age, as it always was.
    const ids: string[] = []
    ids.push(await job(B, { ageSeconds: 50 }))
    ids.push(await job(B, { ageSeconds: 40 }))
    ids.push(await job(B, { ageSeconds: 30, priority: 5 })) // outranks the older ones
    const got: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const c = await claim()
      if (c) got.push(c.id)
    }
    const want = [ids[2], ids[0], ids[1]]
    check(
      'CONTROL: a single office queue keeps its order (priority first, then oldest)',
      JSON.stringify(got) === JSON.stringify(want),
      `claimed ${got.map((g) => ids.indexOf(g)).join(',')} want 2,0,1`,
    )
  })

  await savepoint('q_priority', async () => {
    // Priority outranks fairness: another office's more urgent job is still taken first.
    for (let i = 0; i < 2; i += 1) await job(B, { ageSeconds: 100 - i })
    const first = await claim()
    const urgent = await job(B, { ageSeconds: 0, priority: 1 })
    await job(A, { ageSeconds: 0 })
    const second = await claim()
    check(
      'CONTROL: priority still outranks the fair-share term',
      first !== null && second !== null && second.id === urgent,
      `second claim was ${second?.id === urgent ? 'the urgent job' : 'something else'}`,
    )
  })

  await savepoint('q_scope', async () => {
    // #184: a caller scoped to one requester takes that requester's job and is not blocked by anybody's share.
    for (let i = 0; i < 3; i += 1) await job(B, { ageSeconds: 100 - i })
    const mine = await job(A, { by: `verify:fair-scope-${run}` })
    const c = await claim(`verify:fair-scope-${run}`)
    check(
      'CONTROL: a scoped dequeue still takes exactly its own scope',
      c !== null && c.id === mine,
      `claimed ${c === null ? 'nothing' : c.id === mine ? 'its own job' : 'another job'}`,
    )
  })
} finally {
  await db.execute('rollback')
}

const passed = results.filter(Boolean).length
console.log(`\n${String(passed)}/${String(results.length)} checks passed`)
await db.end()
process.exit(passed === results.length ? 0 : 1)
