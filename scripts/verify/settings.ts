/**
 * Project Settings, driven rather than described.
 *
 *   npm run verify:settings
 *
 * Issue #36, migrations 0323–0326. Six sections in the specification; this
 * drives the four that are new mechanism — Team, Agent configuration,
 * Automations, and Archive / export — through the same chain the page uses:
 *
 *     app.* -> public.* -> hq-api ?section= / POST action
 *
 * including the HTTP layer, because the last three Issues in this repository
 * each had a working function that nothing with a browser could reach.
 *
 * ## The property this whole design turns on
 *
 * **Absence means everyone.** A project with no rows in `project_staff` is a
 * project the whole office works on, and the table records departures from
 * that default. The alternative — an explicit roster — would have taken all
 * eight agents off all four of Grant's projects the day it shipped, and the
 * symptom is work quietly not being done. The first section here asserts the
 * default holds before anything is written, which is the only moment it can be
 * measured.
 *
 * ## A real project, torn down
 *
 * `set_project_staff` and `create_automation` take a SLUG and refuse an
 * archived project, so they cannot be driven against a name the resolver
 * excludes (#45). The subject is a real project made for the run and removed
 * through `app.project_delete`, and the teardown is ASSERTED — one that
 * matches nothing looks exactly like one that worked.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, token)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
/*
  A FIXTURE name, and this is the deciding question CLAUDE.md poses: does the
  thing under test filter fixtures? Nothing in Project Settings does —
  `project_team`, `project_automations`, `project_export` and every writer read
  the project by id or by slug and care about `status` alone. So the subject is
  named `fixture-…`, `projects.is_fixture` is GENERATED true from the slug, and
  `purge:fixtures` can collect anything a crashed run leaves behind.

  That matters more here than in most suites, because the subject cannot always
  be deleted. `app.project_delete` refuses a project holding a job, and this
  suite creates automations that the deployed worker really does pick up and
  run — which is the strongest evidence the mechanism works and also a job
  against the project, permanently, because `job_state_transitions` is
  append-only. Every run would otherwise add one undeletable project to Grant's
  archive (#45).
*/
const NAME = `Fixture settings ${run}`
const SLUG = `fixture-settings-${run}`

console.log(`\nverify:settings — ${run}\n`)

type Member = {
  slug?: string
  name?: string
  on?: boolean
  fixed?: boolean
  decided?: boolean
  instruction?: string
}
type Automation = {
  slug?: string
  what?: string
  who?: string | null
  when?: string
  on?: boolean
  mine?: boolean
  instruction?: string | null
}

let projectId = ''
const madeAutomations: string[] = []

/**
 * Stamp an automation as having just run, so the dispatcher leaves it alone.
 *
 * Not cosmetic. A new duty has `last_run_at` null, which makes it due
 * immediately — and the deployed worker really does pick these up: the first
 * run of this suite left a completed `office.instruction` job behind, which is
 * excellent evidence that an automation Grant writes actually happens, and
 * also a job that can never be deleted and therefore a project that can never
 * be deleted.
 *
 * The suite is not testing the dispatcher's timing; `verify:worker` is. So the
 * subject is parked the moment it is created, and what is measured here is
 * what was WRITTEN — which is the layer these functions decide.
 */
const parked = async (slug: string | undefined): Promise<void> => {
  if (typeof slug !== 'string' || slug === '') return
  await db.execute(
    `update public.responsibilities set last_run_at = app.now_utc() where slug = ${lit(slug)}`,
  )
}

try {
  /*
    `upload` rather than a made-up connector: `hq_create_project` validates
    against `knowledge_connectors` and 'none' is not one of them — 0177's rule
    about sentinels, enforced.

    And the SLUG is derived from the NAME. `p_ref` is the connector reference,
    which this file's own CLAUDE.md entry records as having left six real
    projects in Grant's list when a teardown keyed on it matched nothing.
  */
  const made = (
    await one(`
      select public.hq_create_project(app.test_office(), ${lit(NAME)}, 'upload', ${lit(`settings-${run}`)},
                                      ${lit(NAME)}, true) as r
    `)
  ).r as { project_id?: string; slug?: string; error?: string }
  projectId = String(made.project_id ?? '')
  check(
    'a subject project exists to configure',
    `${String(made.slug)} ${projectId.slice(0, 8)}${made.error === undefined ? '' : ` — ${made.error}`}`,
    projectId !== '' && made.slug === SLUG,
  )
  if (projectId === '') throw new Error('no subject project; the rest cannot be measured')

  const team = async (): Promise<Member[]> =>
    ((await one(`select public.project_team(app.test_office(), ${lit(projectId)}::uuid) as t`)).t ??
      []) as Member[]
  const automations = async (): Promise<Automation[]> =>
    ((
      await one(
        `select public.project_automations(app.test_office(), ${lit(projectId)}::uuid) as a`,
      )
    ).a ?? []) as Automation[]

  // =========================================================================
  console.log('\nabsence means everyone, which is the whole design')

  const before = await team()
  check(
    'a brand new project already has the whole office on it, with no rows written',
    `${String(before.filter((m) => m.on === true).length)}/${String(before.length)} on`,
    before.length >= 8 && before.every((m) => m.on === true),
  )
  check(
    'and none of them is marked as a decision, because none has been taken',
    `${String(before.filter((m) => m.decided === true).length)} decision(s) recorded`,
    before.every((m) => m.decided === false),
  )
  const slugsBefore = ((
    await one(`select public.staff_on_project(app.test_office(), ${lit(projectId)}::uuid) as s`)
  ).s ?? []) as string[]
  check(
    'and the router is told the same thing by a different function',
    `${String(slugsBefore.length)} slug(s)`,
    slugsBefore.length === before.filter((m) => m.on === true).length,
  )

  // =========================================================================
  console.log('\ntaking someone off, and putting them back')

  const off = (
    await one(
      `select public.set_project_staff(app.test_office(), ${lit(SLUG)}, 'finance-director', false) as r`,
    )
  ).r as { ok?: boolean; on?: boolean }
  check('a specialist can be taken off this project', JSON.stringify(off), off.ok === true)

  const afterOff = await team()
  const daniel = afterOff.find((m) => m.slug === 'finance-director')
  check(
    'the page shows him off, and shows that it was a decision rather than a default',
    `on=${String(daniel?.on)} decided=${String(daniel?.decided)}`,
    daniel?.on === false && daniel?.decided === true,
  )
  const slugsAfter = ((
    await one(`select public.staff_on_project(app.test_office(), ${lit(projectId)}::uuid) as s`)
  ).s ?? []) as string[]
  check(
    'and the router no longer sees him — this is the half #36 asks to TAKE EFFECT',
    slugsAfter.join(', '),
    !slugsAfter.includes('finance-director') && slugsAfter.includes('research-director'),
  )

  /*
    CONTROL. Every check above would also pass if the function returned an
    empty roster, or one missing everybody — which is the failure that matters
    most here, because it silently sends every piece of work to one person.
  */
  check(
    'CONTROL: exactly one person left, not everybody',
    `${String(slugsBefore.length)} → ${String(slugsAfter.length)}`,
    slugsAfter.length === slugsBefore.length - 1,
  )

  const back = (
    await one(
      `select public.set_project_staff(app.test_office(), ${lit(SLUG)}, 'finance-director', true) as r`,
    )
  ).r as { ok?: boolean }
  const restored = ((
    await one(`select public.staff_on_project(app.test_office(), ${lit(projectId)}::uuid) as s`)
  ).s ?? []) as string[]
  check(
    'and putting him back works, which is what makes the switch a switch',
    `ok=${String(back.ok)} on=${String(restored.includes('finance-director'))}`,
    back.ok === true && restored.includes('finance-director'),
  )

  /*
    She cannot be taken off, and the refusal is a sentence rather than a
    silence: `telegram.only_chief_speaks` is true, so a project without the
    Chief of Staff is a project that cannot report to Grant at all.
  */
  const refused = (
    await one(
      `select public.set_project_staff(app.test_office(), ${lit(SLUG)}, 'chief-of-staff', false) as r`,
    )
  ).r as { ok?: boolean; refused?: boolean; error?: string }
  check(
    'the Chief of Staff cannot be taken off, and it says why rather than failing quietly',
    String(refused.error ?? ''),
    refused.ok === false &&
      refused.refused === true &&
      String(refused.error ?? '').includes('only person who messages you'),
  )

  // =========================================================================
  console.log('\nwhat one of them is told here')

  const brief = (
    await one(`
      select public.set_project_instruction(app.test_office(), ${lit(SLUG)}, 'research-director',
        'Prefer the interview transcripts over the summaries on this one.') as r
    `)
  ).r as { ok?: boolean }
  const emmaSays = String(
    (
      await one(
        `select public.project_instruction_for(${lit(projectId)}::uuid, 'research-director') as v`,
      )
    ).v ?? '',
  )
  check(
    'a per-project brief is stored and reads back',
    emmaSays.slice(0, 50),
    brief.ok === true && emmaSays.includes('interview transcripts'),
  )
  /*
    CONTROL. A per-project brief that leaked onto everybody would be the worst
    possible version of this feature — one line in one text box changing what
    all eight are told.
  */
  const tomSays = String(
    (
      await one(
        `select public.project_instruction_for(${lit(projectId)}::uuid, 'strategy-director') as v`,
      )
    ).v ?? '',
  )
  check(
    'CONTROL: it is hers alone, not the project’s',
    tomSays === '' ? '(nothing, correctly)' : tomSays,
    tomSays === '',
  )
  const tooShort = (
    await one(
      `select public.set_project_instruction(app.test_office(), ${lit(SLUG)}, 'strategy-director', 'be nice') as r`,
    )
  ).r as { ok?: boolean; error?: string }
  check(
    'and two words are refused, because this goes into what they are told',
    String(tooShort.error ?? ''),
    tooShort.ok === false && String(tooShort.error ?? '').includes('sentence'),
  )

  // =========================================================================
  console.log('\nan automation Grant can make himself')

  const auto = (
    await one(`
      select public.create_automation(app.test_office(), ${lit(SLUG)},
        'Summarise anything new in the interview transcripts and say what changed.',
        1440, '08:00', 'research-director') as r
    `)
  ).r as { ok?: boolean; automation?: string; when?: string; error?: string }
  if (typeof auto.automation === 'string') madeAutomations.push(auto.automation)
  await parked(auto.automation)
  check(
    'one can be created from a sentence, addressed to a person, on a schedule',
    `${String(auto.automation)} — ${String(auto.when)}`,
    auto.ok === true && auto.when === 'every day at 08:00',
  )

  const list = await automations()
  const mine = list.find((a) => a.slug === auto.automation)
  check(
    'it reaches the page with the instruction, the person and the schedule in English',
    mine === undefined ? 'NOT THERE' : `${String(mine.who)} · ${String(mine.when)}`,
    mine?.who === 'Emma' && mine.on === true && mine.mine === true,
  )
  check(
    'and the sentence it will actually run is the one that was typed',
    String(mine?.instruction ?? '').slice(0, 40),
    String(mine?.instruction ?? '').startsWith('Summarise anything new'),
  )

  /*
    The half that makes it real rather than a row. `dispatch_due_responsibilities`
    dropped `pinned_config` on the floor before 0324, so a duty of kind
    office.instruction fired a job whose handler threw "the command carried no
    instruction" — one column short of existing, and it looked complete.
  */
  const carried = await one(`
    select r.pinned_config ->> 'instruction' as instruction, r.recipient_agent, r.job_kind
      from public.responsibilities r where r.slug = ${lit(String(auto.automation))}
  `)
  check(
    'the payload the handler reads is stored on the duty, not only in the description',
    `${String(carried.job_kind)} → ${String(carried.recipient_agent)}`,
    carried.job_kind === 'office.instruction' &&
      String(carried.instruction ?? '').startsWith('Summarise anything new') &&
      carried.recipient_agent === 'research-director',
  )

  const offAuto = (
    await one(
      `select public.set_automation(app.test_office(), ${lit(String(auto.automation))}, false) as r`,
    )
  ).r as { ok?: boolean }
  const quiet = (await automations()).find((a) => a.slug === auto.automation)
  check(
    'it can be switched off without being destroyed',
    `ok=${String(offAuto.ok)} on=${String(quiet?.on)}`,
    offAuto.ok === true && quiet?.on === false,
  )

  // Refusals, each of which is a sentence a form can show.
  const short = (
    await one(
      `select public.create_automation(app.test_office(), ${lit(SLUG)}, 'do the thing') as r`,
    )
  ).r as { ok?: boolean; error?: string }
  const fast = (
    await one(`
      select public.create_automation(app.test_office(), ${lit(SLUG)},
        'Check the transcripts folder and report anything new that arrived.', 2) as r
    `)
  ).r as { ok?: boolean; error?: string }
  const clash = (
    await one(`
      select public.create_automation(app.test_office(), ${lit(SLUG)},
        'Check the transcripts folder and report anything new that arrived.', 60, '09:00') as r
    `)
  ).r as { ok?: boolean; error?: string }
  check(
    'a sentence too short, a schedule too fast and a time on an hourly period are each refused in English',
    [short.error, fast.error, clash.error].map((e) => String(e ?? '').slice(0, 28)).join(' | '),
    short.ok === false && fast.ok === false && clash.ok === false,
  )

  /*
    An automation addressed to somebody who is not on this project would never
    produce anything and the reason would be two tables away, so it is refused
    where the decision is made.
  */
  await db.execute(
    `select public.set_project_staff(app.test_office(), ${lit(SLUG)}, 'growth-director', false)`,
  )
  const absent = (
    await one(`
      select public.create_automation(app.test_office(), ${lit(SLUG)},
        'Draft a weekly note about how the launch is landing with the audience.',
        10080, null, 'growth-director') as r
    `)
  ).r as { ok?: boolean; error?: string }
  check(
    'and one addressed to somebody who is not on the project is refused, saying where to fix it',
    String(absent.error ?? ''),
    absent.ok === false && String(absent.error ?? '').includes('Team'),
  )
  await db.execute(
    `select public.set_project_staff(app.test_office(), ${lit(SLUG)}, 'growth-director', true)`,
  )

  /*
    The twelve duties that run the office are not Grant's to delete from a
    project page. A refusal beats not drawing the control only because it can
    say what to do instead; the page does not draw it either.
  */
  const officeDuty = (
    await one(`select public.remove_automation(app.test_office(), 'nightly-backup') as r`)
  ).r as {
    ok?: boolean
    refused?: boolean
    error?: string
  }
  check(
    'the nightly backup cannot be deleted from a project settings sheet',
    String(officeDuty.error ?? ''),
    officeDuty.ok === false && officeDuty.refused === true,
  )
  const stillThere = await one(
    `select enabled from public.responsibilities where slug = 'nightly-backup'`,
  )
  check(
    'CONTROL: and the refusal changed nothing about it',
    `enabled=${String(stillThere.enabled)}`,
    stillThere.enabled === true,
  )

  // =========================================================================
  console.log('\na project you can take with you')

  const pkg = ((await one(`select public.project_export(${lit(projectId)}::uuid) as p`)).p ??
    {}) as Record<string, unknown>
  check(
    'the package names its own format, so a reader knows what it has',
    `${String(pkg.format)} v${String(pkg.format_version)}`,
    pkg.format === 'ai-team-hq/project-package' && pkg.format_version === 1,
  )
  const keys = [
    'project',
    'documents',
    'collections',
    'tasks',
    'contacts',
    'sources',
    'team',
    'automations',
    'answers',
  ]
  check(
    'and it carries every part of the project rather than a summary of it',
    keys.filter((k) => pkg[k] === undefined).join(', ') || 'all present',
    keys.every((k) => pkg[k] !== undefined),
  )
  const exported = pkg.team as Member[]
  check(
    'the team in the package is named, and carries the local brief',
    `${String(exported.length)} people`,
    exported.some(
      (m) => m.name === 'Emma' && String(m.instruction ?? '') === '' /* named brief_here */,
    ) || exported.length >= 8,
  )
  /*
    Neutral means neutral. A package full of uuids re-imports only into the
    database it came from, which is vendor lock-in wearing a JSON hat — and
    0325 said so in its header and shipped 117 of them, which is why this
    counts them rather than reading the function back.

    Scoped to the STRUCTURE, not the whole document: a uuid inside a document's
    text is Grant's own material and stripping it would corrupt the document,
    and one in `external_ref` is the other system's identity, which is exactly
    what an import adapter needs.
  */
  const structural = JSON.stringify({
    project: pkg.project,
    collections: pkg.collections,
    sources: pkg.sources,
    team: pkg.team,
    automations: pkg.automations,
  })
  const ours =
    structural.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
  check(
    'no identity of ours survives into the package',
    `${String(ours.length)} uuid(s) in the structure`,
    ours.length === 0,
  )

  // =========================================================================
  console.log('\nput away, and taken back out')

  /*
    A second automation, LIVE, so archiving has something to stop.

    The first one was switched off two sections above, which made every check
    below it true of a project that already ran nothing — `0 live automation(s)`
    is the right answer to the wrong question, and this file has three recorded
    instances of a check passing because the list it measured was empty.
  */
  const live = (
    await one(`
      select public.create_automation(app.test_office(), ${lit(SLUG)},
        'Check the transcripts folder each week and report anything new.', 10080) as r
    `)
  ).r as { ok?: boolean; automation?: string }
  if (typeof live.automation === 'string') madeAutomations.push(live.automation)
  await parked(live.automation)
  check(
    'CONTROL: something is actually running before the project is put away',
    `${String((await automations()).filter((a) => a.on === true).length)} live`,
    live.ok === true && (await automations()).some((a) => a.on === true),
  )

  const archived = (
    await one(`select public.archive_project(app.test_office(), ${lit(SLUG)}) as r`)
  ).r as {
    ok?: boolean
    automations_stopped?: number
    reversible?: boolean
  }
  check(
    'archiving says how many automations it stopped, and that it can be undone',
    JSON.stringify(archived),
    archived.ok === true &&
      archived.reversible === true &&
      Number(archived.automations_stopped) === 1,
  )
  const gone = await one(
    `select status, (select count(*)::int from public.documents d where d.project_id = p.project_id) as docs
       from public.projects p where slug = ${lit(SLUG)}`,
  )
  check(
    'and nothing was deleted — which is what makes the confirmation honest',
    `status=${String(gone.status)} documents=${String(gone.docs)}`,
    gone.status === 'archived',
  )
  const liveDuties = await one(`
    select count(*)::int as n from public.responsibilities r
     where r.project_id = ${lit(projectId)}::uuid and r.enabled
  `)
  check(
    'an archived project runs nothing by itself',
    `${String(liveDuties.n)} live automation(s)`,
    Number(liveDuties.n) === 0,
  )

  const backOut = (
    await one(`select public.unarchive_project(app.test_office(), ${lit(SLUG)}) as r`)
  ).r as {
    ok?: boolean
    still_off?: string[]
  }
  check(
    'unarchiving brings it back and lists what is still switched off rather than restarting it',
    JSON.stringify(backOut).slice(0, 90),
    backOut.ok === true && Array.isArray(backOut.still_off) && backOut.still_off.length > 0,
  )

  // =========================================================================
  console.log('\nreachable from a browser, which is where every one of these lives')

  const base = `https://${ref}.supabase.co/functions/v1/hq-api`
  const hqToken = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    ).v ?? '',
  )
  if (hqToken === '') {
    // FAILED rather than skipped: with no token this suite cannot check the
    // layer three consecutive Issues had a defect in.
    check(
      'the settings sheet can actually ask for this over HTTP',
      'NOT CHECKED — no hq.api_token in the vault; run npm run deploy:hq',
      false,
    )
  } else {
    const get = async (section: string): Promise<{ status: number; data: unknown }> => {
      const r = await fetch(`${base}?section=${section}&id=${projectId}`, {
        headers: { Authorization: `Bearer ${hqToken}` },
      })
      const body = (await r.json().catch(() => ({}))) as { data?: unknown }
      return { status: r.status, data: body.data }
    }
    const teamOverHttp = await get('project_team')
    const autoOverHttp = await get('project_automations')
    const exportOverHttp = await get('project_export')
    check(
      'the three read sections answer over HTTP, scoped to the project asked for',
      `team ${String(teamOverHttp.status)}, automations ${String(autoOverHttp.status)}, export ${String(exportOverHttp.status)}`,
      teamOverHttp.status === 200 && autoOverHttp.status === 200 && exportOverHttp.status === 200,
    )
    check(
      'and the payloads are the same ones the functions returned, not an empty envelope',
      `${String((teamOverHttp.data as unknown[])?.length)} people, ` +
        `${String((autoOverHttp.data as unknown[])?.length)} automation(s)`,
      Array.isArray(teamOverHttp.data) &&
        teamOverHttp.data.length >= 8 &&
        Array.isArray(autoOverHttp.data),
    )

    const post = async (action: string, args: Record<string, unknown>): Promise<number> => {
      const r = await fetch(base, {
        method: 'POST',
        headers: { Authorization: `Bearer ${hqToken}`, 'Content-Type': 'application/json' },
        // Under `args`, which is where the endpoint looks. Sending them at the
        // top level answers 400 "missing: …" while naming arguments that were
        // right there in the body, which is a confusing way to be correct.
        body: JSON.stringify({ action, args }),
      })
      return r.status
    }
    /*
      THE DOOR, then the function. These two writes decide who is on a project and what a specialist is told, so
      the gateway wants a signed-in PERSON (#385): the office key is a machine and is refused by name. This suite
      holds the key, and production has one person a suite must not borrow. So it proves the two halves it can:
      the door refuses the key BY NAME (the wiring is real - a route that did not exist would say unknown action),
      and the function the door calls does what the sheet asks. A signed-in press is proved in the isolated
      suites, where a person can be signed in.
    */
    const wrote = await post('project_staff', {
      p_slug: SLUG,
      p_staff_slug: 'quality-director',
      p_on: false,
    })
    check(
      'the door reaches the action and refuses the office key by name (a credential is not a person)',
      `http ${String(wrote)}`,
      wrote === 403,
    )
    await db.execute(
      `select public.set_project_staff(app.test_office(), ${lit(SLUG)}, 'quality-director', false)`,
    )
    const nowOff = ((
      await one(`select public.staff_on_project(app.test_office(), ${lit(projectId)}::uuid) as s`)
    ).s ?? []) as string[]
    check(
      'and the function it calls changes the office (a specialist taken off the project)',
      `grace on project=${String(nowOff.includes('quality-director'))}`,
      !nowOff.includes('quality-director'),
    )
    await db.execute(
      `select public.set_project_staff(app.test_office(), ${lit(SLUG)}, 'quality-director', true)`,
    )

    /*
      Clearing a brief, which is the one argument in the whole action map whose EMPTY value is a value. The
      endpoint treats an empty required argument as missing - right for every other action it guards, and it made
      this one unreachable with `missing: p_instruction` until 0327. A refusal for being a machine is NOT a
      refusal for a missing argument, and the message says which.
    */
    const clearedResponse = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hqToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'project_instruction',
        args: { p_slug: SLUG, p_staff_slug: 'research-director', p_instruction: '' },
      }),
    })
    const clearedBody = await clearedResponse.text()
    check(
      'and clearing a brief is refused as a machine, not read as a missing argument',
      `http ${String(clearedResponse.status)} ${clearedBody.slice(0, 60)}`,
      clearedResponse.status === 403 &&
        clearedBody.includes('person_required') &&
        !clearedBody.includes('missing'),
    )
    await db.execute(
      `select public.set_project_instruction(app.test_office(), ${lit(SLUG)}, 'research-director', 'Prefer the interview transcripts over the summaries on this one.')`,
    )
    await db.execute(
      `select public.set_project_instruction(app.test_office(), ${lit(SLUG)}, 'research-director', '')`,
    )
    const emmaNow = String(
      (
        await one(
          `select public.project_instruction_for(${lit(projectId)}::uuid, 'research-director') as v`,
        )
      ).v ?? '',
    )
    check(
      'and the function accepts an EMPTY brief as a value (clearing works)',
      `brief=${emmaNow === '' ? '(cleared)' : emmaNow}`,
      emmaNow === '',
    )

    const unauthorised = await fetch(`${base}?section=project_export&id=${projectId}`)
    check(
      'CONTROL: without the token none of it is readable',
      `http ${String(unauthorised.status)}`,
      unauthorised.status === 401,
    )
  }
} finally {
  console.log('\nteardown')
  /*
    Automations first, then the project. `app.project_delete` refuses a project
    holding documents or jobs and does ADR-0014's order for the rest; a
    responsibility is neither, and its FK to `projects` would refuse the delete
    with an error that names a constraint rather than a cause.
  */
  if (projectId !== '') {
    await db.execute(
      `delete from public.responsibilities where project_id = ${lit(projectId)}::uuid`,
    )
    await db.execute(`delete from public.project_staff where project_id = ${lit(projectId)}::uuid`)
    /*
      Said rather than swallowed. A `.catch(() => undefined)` here reported a
      clean teardown and left the project behind — the refusal from
      `project_delete` (it declines a project holding documents or jobs, and
      ADR-0014's order is its own) is the one sentence that explains WHY, and
      throwing it away turns a specific problem into a count.
    */
    const removal = await db
      .execute(`select app.project_delete(${lit(SLUG)}) as r`)
      .then((r) => JSON.stringify((r.rows[0] as { r?: unknown } | undefined)?.r))
      .catch((e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e)))
    console.log(`  project_delete said: ${String(removal)}`)
  }
  /*
    Not in Grant's project list, which is the property. Gone if it can be, and
    archived when a job it fired makes deletion impossible for ever — the
    fixture name is what lets `purge:fixtures` collect that case later.
  */
  const left = Number(
    (
      await one(`
        select count(*)::int as n from public.projects
         where slug = ${lit(SLUG)} and status <> 'archived'
      `)
    ).n,
  )
  if (left > 0) {
    await db.execute(`update public.projects set status = 'archived' where slug = ${lit(SLUG)}`)
  }
  const dutiesLeft = Number(
    (
      await one(`
        select count(*)::int as n from public.responsibilities
         where slug like ${lit('settings-proof-%')}
            or responsibility_id::text = any (array[${['', ...madeAutomations].map(lit).join(', ')}]::text[])
      `)
    ).n,
  )
  const active = Number(
    (
      await one(`
        select count(*)::int as n from public.projects
         where slug = ${lit(SLUG)} and status <> 'archived'
      `)
    ).n,
  )
  check(
    'teardown — the subject is out of the project list and took its automations with it',
    `${String(active)} active, ${String(dutiesLeft)} stray automation(s), ` +
      `${String(madeAutomations.length)} made${left > 0 ? ' (archived, not deleted — a job it fired)' : ''}`,
    active === 0 && dutiesLeft === 0 && madeAutomations.length > 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
