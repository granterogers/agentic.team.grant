/**
 * The inverse is exact.
 *
 *   npm run verify:inverse
 *
 * Issue #118, migrations 0263-0265.
 *
 * ## What this measures that `verify:undo` does not
 *
 * `verify:undo` proves the CLAIM: one reversal per action however many requests
 * arrive, append-only records, honest words for a lapsed offer. All of that was
 * built in 0029 and all of it held. None of it says whether pressing Undo puts
 * the world back where it was, because until 0263 nothing in the office had
 * ever recorded an inverse to perform.
 *
 * #118's rule is the whole design and it is the whole of this file:
 *
 *   > **Only offer undo where the inverse is exact.** An undo that silently
 *   > does something slightly different from the inverse is worse than no undo,
 *   > because it is trusted.
 *
 * So every check here is the same shape: read the row, do the thing, undo it,
 * read the row again, and require the two reads to be **identical** — not
 * similar, not "the important fields". A partial restore is precisely the
 * failure the rule names, and a check that compares three of five columns is a
 * check that passes for it.
 *
 * ## And the half people leave out
 *
 * An action with no exact inverse must offer NOTHING. Creating a project,
 * disconnecting a service, replacing a photo. Those are asserted too, because
 * "we did not get round to it" and "this one is deliberate" look identical from
 * outside and only one of them is honest.
 *
 * ## The control
 *
 * A suite of equality assertions is worthless if the equality is vacuous. So
 * one case records an inverse that restores the WRONG value, undoes it, and
 * requires the comparison to notice. If that check ever passes silently, every
 * other check in this file is decoration.
 *
 * ## Subjects
 *
 * A fixture project (`verify-...`, which is what makes `projects.is_fixture`
 * true) and its own task, torn down at the end and the teardown asserted —
 * Issue #45's lesson, and the six real projects a `p_ref`-keyed teardown once
 * left in Grant's list.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4637
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const SLUG = 'verify-inverse'

/**
 * Do something, then undo it, and hand back both readings of the world.
 *
 * `snapshot` is any SQL returning one row. Whatever it selects is what
 * "identical" means for that action, so each caller chooses the columns that
 * the action can touch — and choosing too few is how this kind of check passes
 * for a partial restore.
 */
/*
  Every action id this suite brings into being, so the teardown can remove
  exactly those.

  It used to delete by matching the DESCRIPTION, which the RPC writes from the
  NEW value -- 'Renamed to A completely different name' -- and no pattern keyed
  on the fixture's slug or its old name could ever match it. Seven rename
  records accumulated across seven runs while the teardown reported success,
  which is the failure mode CLAUDE.md warns about in as many words: a teardown
  that matches nothing looks exactly like a teardown that worked.

  An id cannot be missed by a pattern.
*/
const made: string[] = []

/**
 * Call an RPC and collect any undo id it hands back.
 *
 * Every call the suite makes goes through here or through `roundTrip`, because
 * a setup call records an offer exactly as a measured one does — the three that
 * did not (two task states and one arrangement) left three rows behind per run
 * while the teardown reported success.
 */
const did = async (expr: string): Promise<Record<string, unknown>> => {
  const answer = ((await one(`select ${expr} as r`)).r ?? {}) as Record<string, unknown>
  const undo = answer.undo
  if (typeof undo === 'string' && undo !== '') made.push(undo)
  return answer
}

const roundTrip = async (
  snapshot: string,
  action: string,
): Promise<{ before: string; mid: string; after: string; undo: string | null; said: unknown }> => {
  const before = JSON.stringify(await one(snapshot))
  const result = await did(action)
  const undo = (result.undo as string | null) ?? null
  const mid = JSON.stringify(await one(snapshot))
  let said: unknown = null
  if (undo !== null) said = (await one(`select public.hq_undo(${lit(undo)}) as r`)).r
  const after = JSON.stringify(await one(snapshot))
  return { before, mid, after, undo, said }
}

// ===========================================================================
// A subject of our own, which is not one of Grant's
// ===========================================================================

/*
  Inserted rather than created through `hq_create_project`.

  Grant: *"Please don't assume I wish to create a new project — this is a large
  task and should always be confirmed."* A verify suite is not a person
  confirming, and `hq_create_project` does connector work this has no business
  doing. A row is a row.
*/
/*
  Two attachments, and both inserted in the same transaction as the project.

  ADR-0014: `projects_need_an_attachment` refuses an active project with no
  enabled attachment, and it is a DEFERRABLE constraint trigger, so the project
  and its first source have to arrive together rather than one after the other.

  Two rather than one, because the detach check below disables one of them and
  the same rule would refuse to let the last one go — which is correct behaviour
  and would have read here as a broken undo.
*/
await db.execute(`
  begin;
  set constraints all deferred;
  insert into public.projects (slug, name, status, purpose, icon, icon_hue)
  values (${lit(SLUG)}, 'Inverse verification', 'active',
          'Exercises the undo path. Deleted by the suite that made it.',
          'flask', 'p-moss')
  on conflict (office_id, slug) do update set name = excluded.name, status = 'active',
    icon = excluded.icon, icon_hue = excluded.icon_hue;
  /*
    channel_prefix is DERIVED from the name -- hq_rename_project recomputes it
    on every rename -- so a real project's prefix always matches its name, and
    restoring the name restores the prefix. Set here so the fixture starts in
    that same consistent state; without it the rename check fails on an
    inconsistency this suite introduced rather than on anything undo did wrong.

    (Plain words, no backticks: a backtick inside a comment inside a template
    literal ends the string, which is how this edit failed the first time.)
  */
  update public.projects set channel_prefix = 'inverse-verification'
   where slug = ${lit(SLUG)};
  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role, enabled)
  select project_id, 'drive', 'verify-inverse-anchor',
         'The source that keeps the project legal', 'source', true
    from public.projects where slug = ${lit(SLUG)}
  on conflict do nothing;
  commit;
`)
const projectRow = await one(
  `select project_id::text as id from public.projects where slug = ${lit(SLUG)}`,
)
const PROJECT = String(projectRow.id)

/*
  Inserted rather than added through `hq_task_add`, and this is Issue #45's trap
  rather than a shortcut.

  `hq_task_add` resolves its project through `app.resolve_project_by_name`,
  which filters `not p.is_fixture`. A fixture project is invisible to it, so the
  call returns an error and `id` comes back undefined -- which is exactly the
  shape that once spent eleven failing checks on a feature that worked.

  The subject has to be a fixture (it is a whole project, and Grant's list must
  not grow one), so the task is written directly.
*/
const taskRow = await one(`
  insert into public.tasks (project_id, title, detail, due_on, added_by)
  values (${lit(PROJECT)}::uuid, 'A task that will be edited and put back',
          'the original detail', '2026-11-30'::date, 'verify:inverse')
  returning task_id::text as id
`)
const TASK = String(taskRow.id)

// ===========================================================================
// 1. Exactness, one action at a time
// ===========================================================================

console.log('\nthe inverse is exact')

// --- a project's name -------------------------------------------------------
const renamed = await roundTrip(
  `select name, channel_prefix from public.projects where slug = ${lit(SLUG)}`,
  `public.hq_rename_project(app.test_office(), ${lit(SLUG)}, 'A completely different name')`,
)
check(
  'renaming a project and undoing it restores the name AND the channel prefix',
  renamed.before === renamed.after ? renamed.before : `${renamed.before} then ${renamed.after}`,
  renamed.before === renamed.after && renamed.mid !== renamed.before,
)

// --- how it looks -----------------------------------------------------------
const looked = await roundTrip(
  `select icon, icon_hue from public.projects where slug = ${lit(SLUG)}`,
  `public.hq_project_look(app.test_office(), ${lit(SLUG)}, 'rocket', 'p-plum')`,
)
check(
  'changing the icon and hue and undoing it restores both',
  looked.before === looked.after ? looked.before : `${looked.before} then ${looked.after}`,
  looked.before === looked.after && looked.mid !== looked.before,
)

/*
  The one that a `coalesce`-shaped inverse gets wrong.

  Every one of these RPCs treats null as "leave this alone", so an inverse built
  only from previous VALUES cannot restore a field that was previously empty —
  it passes null, which means "leave it", which leaves the new value in place.
  The clear list is the fix and this is the check that would catch its absence.
*/
await db.execute(
  `update public.projects set icon = null, icon_hue = null where slug = ${lit(SLUG)}`,
)
const fromEmpty = await roundTrip(
  `select icon, icon_hue from public.projects where slug = ${lit(SLUG)}`,
  `public.hq_project_look(app.test_office(), ${lit(SLUG)}, 'anchor', 'p-iris')`,
)
check(
  'and undoing a change to a field that was EMPTY empties it again',
  `${fromEmpty.mid} then ${fromEmpty.after}`,
  fromEmpty.after === '{"icon":null,"icon_hue":null}',
)
await db.execute(
  `update public.projects set icon = 'flask', icon_hue = 'p-moss' where slug = ${lit(SLUG)}`,
)

// --- a task's state ---------------------------------------------------------
const ticked = await roundTrip(
  `select state, blocked_on, (done_at is not null) as done from public.tasks where task_id = ${lit(TASK)}`,
  `public.hq_task_state(${lit(TASK)}, 'done')`,
)
check(
  'ticking a task done and undoing it restores the state and clears done_at',
  `${ticked.mid} then ${ticked.after}`,
  ticked.before === ticked.after && ticked.mid !== ticked.before,
)

/*
  Blocked carries a reason, and `blocked` without one is refused. An inverse
  that dropped the reason would produce an undo that CANNOT BE APPLIED — the
  reversal would come back as an error rather than doing something subtly
  wrong, which is a different failure and just as much a broken undo.
*/
await did(`public.hq_task_state(${lit(TASK)}, 'blocked', 'waiting on the thing')`)
const unblocked = await roundTrip(
  `select state, blocked_on from public.tasks where task_id = ${lit(TASK)}`,
  `public.hq_task_state(${lit(TASK)}, 'doing')`,
)
check(
  'un-blocking a task and undoing it puts the blocked REASON back, not just the state',
  `${unblocked.mid} then ${unblocked.after}`,
  unblocked.before === unblocked.after && unblocked.after.includes('waiting on the thing'),
)
await did(`public.hq_task_state(${lit(TASK)}, 'todo')`)

// --- editing a task ---------------------------------------------------------
const TASK_COLS = `title, detail, due_on, starts_on, is_milestone, priority,
                   parent_task_id, assignee_staff`
const edited = await roundTrip(
  `select ${TASK_COLS} from public.tasks where task_id = ${lit(TASK)}`,
  `public.hq_task_update(${lit(TASK)}, 'Renamed by the suite', 'a different detail',
                         '2027-01-01'::date, null, null, null, true, 5, array[]::text[])`,
)
check(
  'editing eight fields of a task and undoing it restores all eight',
  edited.before === edited.after ? 'identical' : `${edited.before}\n         then ${edited.after}`,
  edited.before === edited.after && edited.mid !== edited.before,
)

// --- the arrangement --------------------------------------------------------
const LAYOUT = `select coalesce((select panels::text from public.dashboard_layouts
                                  where project_id = ${lit(PROJECT)}::uuid and owner = 'grant'),
                                'none') as panels`
const PANELS_A = `'[{"id":"tasks","x":0,"y":0,"w":6,"h":4}]'::jsonb`
const PANELS_B = `'[{"id":"tasks","x":2,"y":1,"w":4,"h":8},{"id":"docs","x":0,"y":0,"w":2,"h":2}]'::jsonb`

/*
  Two different inverses, and getting the first one wrong is invisible.

  Arranging a board that had NO saved arrangement must undo by REMOVING the row,
  not by writing an empty one: no row falls back to the default layout and an
  empty row does not. A reversal that wrote `[]` would look like it worked and
  would leave the board permanently blank.
*/
await db.execute(`delete from public.dashboard_layouts where project_id = ${lit(PROJECT)}::uuid`)
const firstArrange = await roundTrip(
  LAYOUT,
  `public.hq_dashboard_layout_set(app.test_office(), ${lit(SLUG)}, ${PANELS_A})`,
)
check(
  'arranging a board for the FIRST time undoes to no saved arrangement, not an empty one',
  `${firstArrange.mid.slice(0, 40)}… then ${firstArrange.after}`,
  firstArrange.after === '{"panels":"none"}',
)

await did(`public.hq_dashboard_layout_set(app.test_office(), ${lit(SLUG)}, ${PANELS_A})`)
const rearranged = await roundTrip(
  LAYOUT,
  `public.hq_dashboard_layout_set(app.test_office(), ${lit(SLUG)}, ${PANELS_B})`,
)
check(
  'and rearranging it restores the previous arrangement exactly',
  rearranged.before === rearranged.after ? 'identical' : 'DIFFERENT',
  rearranged.before === rearranged.after && rearranged.mid !== rearranged.before,
)

// --- detaching a source -----------------------------------------------------
/*
  Upserted, not inserted. An earlier run that died mid-way leaves this row
  behind, and a suite whose SETUP fails on its own leftovers is a suite that can
  only be run once -- which is how a check stops being run at all.
*/
const attached = await one(`
  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role, enabled)
  values (${lit(PROJECT)}::uuid, 'drive', 'verify-inverse-folder',
          'A folder the suite attached', 'source', true)
  on conflict (project_id, connector, external_ref, role)
    do update set enabled = true, disabled_reason = null
  returning attachment_id::text as id
`)
const ATTACHMENT = String(attached.id)
const detached = await roundTrip(
  `select enabled, disabled_reason from public.project_attachments
    where attachment_id = ${lit(ATTACHMENT)}::uuid`,
  `public.hq_detach(app.test_office(), ${lit(ATTACHMENT)}::uuid)`,
)
check(
  'detaching a source and undoing it re-enables the same row',
  `${detached.mid} then ${detached.after}`,
  detached.before === detached.after && detached.mid.includes('false'),
)

// ===========================================================================
// 2. And the actions that must offer nothing
// ===========================================================================

console.log('\nand nothing is offered where the inverse is not exact')

const photo = {
  r: await did(`public.hq_project_look(app.test_office(), ${lit(SLUG)}, null, null,
    'data:image/png;base64,iVBORw0KGgo=')`),
}
check(
  'replacing a project photo offers no undo, because the old one is not kept',
  JSON.stringify((photo.r as Record<string, unknown>).undo),
  (photo.r as Record<string, unknown>).undo === null,
)
const photoSaid = await one(`
  select count(*)::int as n from public.undoable_actions
   where kind = 'project.photo' and status = 'not_undoable'
     and performed_at > app.now_utc() - interval '2 minutes'
`)
check(
  'and it SAYS so, rather than saying nothing at all',
  `${String(photoSaid.n)} not_undoable record(s)`,
  Number(photoSaid.n) >= 1,
)
await db.execute(`update public.projects set image = null where slug = ${lit(SLUG)}`)
// The not_undoable record the photo change wrote has no id in the answer -- by
// design, there is nothing to offer -- so it is collected by its kind and time.
const photoRows = (
  await db.execute(`
    select action_id::text as id from public.undoable_actions
     where kind = 'project.photo' and performed_at > app.now_utc() - interval '10 minutes'
  `)
).rows as { id: string }[]
made.push(...photoRows.map((r) => r.id))

/*
  Disconnecting. The credential is deleted from the Vault, so there is nothing
  to put back — #118 allows an undo only *"while the credential is still ours to
  put back"* and it is not.

  Asked about a service that has no disconnect at all, so nothing is removed
  from anywhere: the property under test is what the answer CARRIES, and doing
  it by signing the office out of something real would be a verification with a
  side effect Grant did not ask for.
*/
const refused = { r: await did(`public.hq_disconnect('openrouter')`) }
check(
  'a refused disconnect carries no undo, because it changed nothing',
  String((refused.r as Record<string, unknown>).error ?? '').slice(0, 46),
  (refused.r as Record<string, unknown>).undo === undefined &&
    (refused.r as Record<string, unknown>).error !== undefined,
)

const nothingOffered = await one(`
  select count(*)::int as n from public.undo_offers
   where kind in ('project.create', 'service.disconnect', 'project.photo')
`)
check(
  'creating a project and disconnecting a service are never OFFERED',
  `${String(nothingOffered.n)} offer(s) of a kind that has no inverse`,
  Number(nothingOffered.n) === 0,
)

// ===========================================================================
// 3. The control — a wrong inverse must be caught
// ===========================================================================

console.log('\nCONTROL: the checks above are load-bearing')

/*
  Every assertion in part 1 is an equality. If the equality were vacuous — the
  wrong columns, a comparison that cannot fail — the whole file would pass
  against an undo that does nothing.

  So: record an inverse BY HAND that restores the wrong name, press it, and
  require the same comparison to notice. This is the reintroduced bug, made
  safe: it is a bad reversal for a fixture project, not a change to the code
  that writes real ones.
*/
const wrongName = await one(`
  insert into public.undoable_actions
    (correlation_id, kind, description, reversal, status, undo_deadline)
  values (gen_random_uuid(), 'project.rename',
          'A deliberately WRONG inverse, written by verify:inverse',
          jsonb_build_object('action', 'rename_project',
            'args', jsonb_build_object('p_slug', ${lit(SLUG)}, 'p_name', 'The Wrong Name')),
          'available', app.now_utc() + interval '2 minutes')
  returning action_id::text as id
`)
made.push(String(wrongName.id))
const nameBefore = JSON.stringify(
  await one(`select name from public.projects where slug = ${lit(SLUG)}`),
)
await db.execute(`select public.hq_undo(${lit(String(wrongName.id))})`)
const nameAfter = JSON.stringify(
  await one(`select name from public.projects where slug = ${lit(SLUG)}`),
)
check(
  'a reversal that restores the WRONG value is detected by the same comparison',
  `${nameBefore} then ${nameAfter}`,
  nameBefore !== nameAfter,
)
await db.execute(
  `update public.projects set name = 'Inverse verification' where slug = ${lit(SLUG)}`,
)

/*
  And a reversal naming an action nothing can perform must refuse rather than
  quietly consume the offer. Recorded by hand for the same reason: this is what
  a future action getting its `reversal` shape wrong would look like.
*/
const nonsense = await one(`
  insert into public.undoable_actions
    (correlation_id, kind, description, reversal, status, undo_deadline)
  values (gen_random_uuid(), 'nonsense.kind',
          'A reversal naming something that cannot be performed',
          '{"action":"fly_to_the_moon","args":{}}'::jsonb,
          'available', app.now_utc() + interval '2 minutes')
  returning action_id::text as id
`)
made.push(String(nonsense.id))
let refusedNonsense = ''
try {
  await db.execute(`select public.hq_undo(${lit(String(nonsense.id))})`)
  refusedNonsense = '(it was ACCEPTED)'
} catch (error) {
  refusedNonsense = (error as Error).message.replace(/\s+/g, ' ').slice(0, 90)
}
check(
  'a reversal nothing can perform raises, so the offer is not silently consumed',
  refusedNonsense,
  refusedNonsense.includes('no way to perform the reversal'),
)
const survived = await one(`
  select status::text as s from public.undoable_actions
   where action_id = ${lit(String(nonsense.id))}::uuid
`)
check(
  'and the claim rolled back with it — the offer is still there',
  `status=${String(survived.s)}`,
  survived.s === 'available',
)

// ===========================================================================
// 4. The page
// ===========================================================================

console.log('\nand the strip the person actually sees')

const studio = ((await db.execute('select app.hq_studio() as d')).rows[0] as { d: unknown }).d

const server = createServer(async (rq, rs) => {
  let f = join('web/studio', decodeURIComponent((rq.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  // A dotless path is a route, as on the host (#382: the older studio is under /classic).
  if (!existsSync(f) && extname(f) === '') f = join('web/studio', 'index.html')
  if (!existsSync(f)) {
    rs.writeHead(404)
    rs.end('not here')
    return
  }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  rs.end(await readFile(f))
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const crashes: string[] = []
page.on('pageerror', (e) => crashes.push(e.message.slice(0, 120)))

/*
  The shim answers every write with whatever `window.__NEXT` says, and records
  what was asked for. Driving the real `office.js` rather than a copy of it is
  the point: the property under test is that `act` offers a strip for EVERY
  write without any button having to know, so the check has to go through `act`.
*/
// The page has to know which office it belongs to before its first line
// runs, or the shim below never sees a URL with hq-api in it. ADR-0048.
await page.addInitScript(namesAnOffice())

await page.addInitScript(`
  window.__S = ${JSON.stringify({ studio })};
  window.__ASKED = [];
  window.__NEXT = { ok: true, note: 'Renamed to Something Else', undo: 'aaaaaaaa-0000-4000-8000-000000000001' };
  try { localStorage.setItem('hq.token', 'verify-inverse'); } catch (e) {}
  window.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes('hq-api')) {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init && init.method === 'POST') {
      const sent = JSON.parse(init.body);
      window.__ASKED.push(sent);
      // An undo answers with no undo id of its own, exactly as hq_undo does.
      const answer = sent.action === 'undo'
        ? { ok: true, outcome: 'undone', note: 'Undone' }
        : window.__NEXT;
      return new Response(JSON.stringify({ result: answer }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const m = /section=([a-z_]+)/.exec(url);
    return new Response(JSON.stringify({ data: m ? (window.__S[m[1]] ?? {}) : {} }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
`)
await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2_500)

const strip = async (): Promise<{ up: boolean; words: string; count: number; go: boolean }> =>
  (await page.evaluate(`(() => {
    const all = document.querySelectorAll('.undobar');
    const bar = document.getElementById('undobar');
    return {
      up: bar !== null && !bar.hidden,
      words: bar?.querySelector('.undoword')?.textContent ?? '',
      count: [...all].filter((b) => !b.hidden).length,
      go: bar?.querySelector('[data-undo]') !== null && bar?.querySelector('[data-undo]') !== undefined,
    };
  })()`)) as { up: boolean; words: string; count: number; go: boolean }

const write = async (label: string): Promise<void> => {
  await page.evaluate(`(async () => {
    const o = await import('./office.js');
    window.__NEXT = { ok: true, note: ${JSON.stringify(label)},
                      undo: 'aaaaaaaa-0000-4000-8000-00000000000' + (window.__ASKED.length + 1) };
    await o.act('rename_project', { p_slug: 'x', p_name: 'y' });
  })()`)
  await page.waitForTimeout(500)
}

const before = await strip()
check('no strip before anything has been written', before.up ? 'one is up' : 'none', !before.up)

await write('Renamed to Something Else')
const first = await strip()
check(
  'a write puts one up, in the server’s own words',
  `${first.up ? 'up' : 'absent'}: "${first.words}"`,
  first.up && first.words === 'Renamed to Something Else' && first.go,
)

await write('Detached the Drive folder')
if (process.env.SHOT === '1') await page.screenshot({ path: '.out/inverse-desktop.png' })
const second = await strip()
check(
  'a second write REPLACES it rather than stacking a second one',
  `${String(second.count)} strip(s), saying "${second.words}"`,
  second.count === 1 && second.words === 'Detached the Drive folder',
)

/*
  A result with no undo id must leave the strip alone rather than putting up an
  empty one. Most writes are not reversible and the honest answer is silence.
*/
await page.evaluate(`(async () => {
  const o = await import('./office.js');
  window.__NEXT = { ok: true, note: 'Something with no way back' };
  await o.act('create_project', { p_name: 'x', p_connector: 'notion', p_ref: 'y' });
})()`)
await page.waitForTimeout(400)
const unchanged = await strip()
check(
  'a write with no inverse offers nothing, and does not disturb what is there',
  `"${unchanged.words}"`,
  unchanged.words === 'Detached the Drive folder',
)

// And the press.
await page.evaluate(`document.querySelector('[data-undo]')?.click()`)
await page.waitForTimeout(900)
const asked = (await page.evaluate('window.__ASKED')) as {
  action: string
  args: Record<string, string>
}[]
const undoCall = asked.find((a) => a.action === 'undo')
check(
  'pressing Undo sends the id the server gave, through the same door as every write',
  undoCall === undefined ? 'nothing was sent' : String(undoCall.args.p_action_id),
  undoCall !== undefined && String(undoCall.args.p_action_id).startsWith('aaaaaaaa-'),
)
const gone = await strip()
check('and the strip goes once it is done', gone.up ? 'still up' : 'gone', !gone.up)

/*
  It must not cover a control.

  The bottom navigation is `position: fixed` at the bottom of the viewport on a
  phone, which is exactly where a strip anchored to the bottom edge lands. This
  repo has already shipped one bar across the top of the page by forgetting how
  fixed positioning interacts with what is around it, so this is hit-tested
  rather than reasoned about: the centre of every nav item must still be that
  nav item.
*/
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
const small = await phone.newPage()
// The phone context is a second browser and needs the office named too.
await small.addInitScript(namesAnOffice())
await small.addInitScript(`
  window.__S = ${JSON.stringify({ studio })};
  window.__ASKED = [];
  try { localStorage.setItem('hq.token', 'verify-inverse'); } catch (e) {}
  window.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes('hq-api')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    if (init && init.method === 'POST') {
      return new Response(JSON.stringify({ result: { ok: true, note: 'A thing happened on a phone',
        undo: 'aaaaaaaa-0000-4000-8000-000000000009' } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const m = /section=([a-z_]+)/.exec(url);
    return new Response(JSON.stringify({ data: m ? (window.__S[m[1]] ?? {}) : {} }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
`)
await small.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
await small.waitForTimeout(2_500)
await small.evaluate(`(async () => {
  const o = await import('./office.js');
  await o.act('rename_project', { p_slug: 'x', p_name: 'y' });
})()`)
await small.waitForTimeout(700)

/*
  Only the items actually on screen.

  The bottom navigation scrolls horizontally -- the project entries live in it
  and there are more of them than fit -- so an item whose centre is off the side
  of the window hit-tests as nothing, and reporting those as covered would be
  the check crying wolf about something the strip has nothing to do with. This
  is the same correction verify:controls needed when its phone sweep came back
  with nothing pressable.
*/
const covered = (await small.evaluate(`(() => {
  const hidden = [];
  let looked = 0;
  for (const item of document.querySelectorAll('.navgroup .navitem')) {
    const r = item.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    looked += 1;
    const at = document.elementFromPoint(x, y);
    if (at === null || !item.contains(at)) {
      hidden.push((item.textContent ?? '').trim().slice(0, 18) + ' <- ' +
        (at === null ? 'nothing' : at.className));
    }
  }
  // A sweep that looked at nothing passes for the wrong reason.
  if (looked === 0) hidden.push('NO NAV ITEM WAS ON SCREEN TO TEST');
  return hidden;
})()`)) as string[]
check(
  'on a phone the strip sits ABOVE the bottom navigation rather than over it',
  covered.length === 0 ? 'every nav item is still pressable' : covered.join(' | '),
  covered.length === 0,
)

const stripBox = (await small.evaluate(`(() => {
  const bar = document.getElementById('undobar');
  if (bar === null || bar.hidden) return null;
  const r = bar.getBoundingClientRect();
  const go = bar.querySelector('[data-undo]')?.getBoundingClientRect();
  return { right: Math.round(r.right), width: Math.round(r.width),
           inner: window.innerWidth, goh: go ? Math.round(go.height) : 0 };
})()`)) as { right: number; width: number; inner: number; goh: number } | null
check(
  'and it fits the phone, with a 44px target on it',
  stripBox === null
    ? 'no strip'
    : `${String(stripBox.width)}px wide in ${String(stripBox.inner)}px, Undo is ${String(stripBox.goh)}px`,
  stripBox !== null && stripBox.right <= stripBox.inner && stripBox.goh >= 44,
)

if (process.env.SHOT === '1') await small.screenshot({ path: '.out/inverse-phone.png' })

check('no uncaught JavaScript', crashes.join(' | ') || 'none', crashes.length === 0)

await phone.close()
await browser.close()
server.close()

// ===========================================================================
// 5. Put everything back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

/*
  ADR-0014 forces the order: archive, then attachments, then the project — the
  trigger fires on the attachment delete. And the undo records go before the
  actions they claim, because `undo_requests` has a foreign key to them.
*/
let sweptSaid = ''
let sweptClean = false
try {
  await db.execute(`delete from public.tasks where project_id = ${lit(PROJECT)}::uuid`)
  const ids = made.map((id) => lit(id)).join(', ')
  if (ids !== '') {
    await db.execute(`delete from public.undo_requests where action_id in (${ids})`)
    await db.execute(`delete from public.undoable_actions where action_id in (${ids})`)
  }
  await db.execute(`
    delete from public.undo_requests where action_id in (
      select action_id from public.undoable_actions
       where description like ${lit(`%${SLUG}%`)}
          or description like '%A task that will be edited and put back%')
  `)
  await db.execute(`
    delete from public.undoable_actions
     where description like ${lit(`%${SLUG}%`)}
        or description like '%A task that will be edited and put back%'
  `)
  await db.execute(`delete from public.dashboard_layouts where project_id = ${lit(PROJECT)}::uuid`)
  /*
    Nothing should have queued a job against a fixture project since 0266 --
    hq_rename_project skips the channel rename for one. Asserted rather than
    assumed, because a job can NEVER be deleted (job_state_transitions is
    append-only by §6 and has a foreign key to jobs), so one appearing here
    makes the subject undeletable for ever and the next run inherits it.
  */
  const stray = await one(`
    select count(*)::int as n from public.jobs where project_id = ${lit(PROJECT)}::uuid
  `)
  if (Number(stray.n) > 0) {
    throw new Error(
      `${String(stray.n)} job(s) were queued against the fixture project; it can never be deleted now`,
    )
  }
  // Archive FIRST. The trigger fires on the attachment delete, and an active
  // project losing its last enabled source is refused.
  await db.execute(`update public.projects set status = 'archived' where slug = ${lit(SLUG)}`)
  await db.execute(
    `delete from public.project_attachments where project_id = ${lit(PROJECT)}::uuid`,
  )
  await db.execute(`delete from public.projects where slug = ${lit(SLUG)}`)

  const left = await one(`
    select (select count(*) from public.projects where slug = ${lit(SLUG)})
         + (select count(*) from public.tasks where project_id = ${lit(PROJECT)}::uuid)
         + (select count(*) from public.project_attachments
             where project_id = ${lit(PROJECT)}::uuid)
         + (select count(*) from public.undoable_actions
             where action_id in (${ids === '' ? 'null' : ids}))
         /* And anything at all that still names this suite's subjects, in case
            a future action records an offer through a path not collected
            above. Scoped to the subjects, never to a time window, so a real
            write of Grant's happening during a run is never touched. */
         + (select count(*) from public.undoable_actions
             where description like ${lit(`%${SLUG}%`)}
                or description like '%A task that will be edited and put back%')
         as n
  `)
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} row(s) left behind`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
/*
  Asserted, because a teardown that matches nothing looks exactly like a
  teardown that worked — and a `p_ref`-keyed one once left six real, active
  projects in Grant's list while reporting success.
*/
check('the fixture project and everything under it is gone', sweptSaid, sweptClean)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
