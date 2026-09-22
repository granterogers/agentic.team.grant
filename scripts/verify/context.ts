/**
 * Does a conversation remember which project it is about? — #308.
 *
 *   npm run verify:context
 *
 * ## What this drives, and why it is the canonical layer
 *
 * `app.enqueue_inbound` is where a message becomes a job and where the project
 * is decided. §5 says an adapter may only translate, so the continuity belongs
 * here and nowhere else — and asserting it here means every surface gets it
 * at once rather than three adapters getting it three ways.
 *
 * Every case below writes a real `inbound_commands` row and calls the real
 * function, inside a transaction that is rolled back — because
 * `enqueue_inbound` creates a JOB and a job can never be deleted. That is
 * #210's rule: wrap the CALL, not the assertion, since a wrapper cannot know a
 * call was destructive until it already has been.
 *
 * ## Containment runs both ways
 *
 * #310 is why this is asserted rather than assumed. A harness conversation's
 * ref is its own, so it can neither read a real conversation's context nor
 * write one — and both directions are checked, because the lesson from #310
 * was that a lookup scoped by relevance instead of by class of traffic
 * retracted one of Grant's real standing rules.
 */

import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const run = Date.now().toString(36)

/*
  ONE STATEMENT, ROLLED BACK, and the answers carried out in a temp table.

  A `do` block cannot return anything and the rollback discards whatever it
  wrote, so every scenario is run as a single script whose last statement
  selects the collected answers before the rollback. CLAUDE.md records both
  halves of this: a data-modifying CTE's rows are invisible to the rest of its
  own statement, and only the last select comes back.
*/
const scenario = async (name: string, body: string): Promise<Record<string, string>> => {
  /*
    ONE SCRIPT, ROLLED BACK, WITH THE ANSWERS CARRIED OUT IN A VARIABLE.

    Three constraints that together decide this shape, and the first draft
    satisfied none of them:

      - `enqueue_inbound` creates a JOB and a job can never be deleted, so
        every call has to be inside something that is rolled back. #210: wrap
        the CALL, not the assertion.
      - the rollback has to come at the END of a scenario rather than per
        turn, because the whole point is that turn 2 inherits what turn 1
        established.
      - anything written to a table before the rollback is undone with it,
        answers included. A plpgsql VARIABLE is not transactional, so the
        answers accumulate in one and are written out by the exception
        handler, which runs after the rollback.

    The temp table is created by its own statement, outside the block, for the
    same reason: created inside, it would vanish with everything else.
  */
  const sql = `
    create temp table if not exists answers (k text primary key, v text);
    delete from answers;
    do $outer$
    declare
      v_p uuid; v_q uuid; v_c uuid; v_ans jsonb := '{}'::jsonb; k text; v text;
    begin
      /*
        Two REAL, NAMED projects, and both adjectives were learned the hard
        way.

        Not a fixture, because app.current_project returns nothing for a
        switch pointing at one (0164) and a fixture subject would make every
        check below pass for the wrong reason.

        And not the reserved unnamed project, because enqueue_inbound treats a
        caller naming it as naming nothing - correctly, it is the absence of a
        project. The first draft picked it as the second subject, tried to
        "switch" to it, and reported the office as broken for doing exactly
        the right thing. Third time today the test was wrong before the
        product was.
      */
      select project_id into v_p from public.projects
       where status = 'active' and not is_fixture
         and project_id <> app.unnamed_project() order by updated_at desc limit 1;
      select project_id into v_q from public.projects
       where status = 'active' and not is_fixture
         and project_id <> app.unnamed_project() and project_id <> v_p
       order by updated_at desc limit 1;
      if v_p is null or v_q is null then
        insert into answers values ('skipped', 'fewer than two real, named, active projects');
        return;
      end if;
      ${body}
      raise exception 'rolling back' using errcode = 'RS001';
    exception when sqlstate 'RS001' then
      for k, v in select * from jsonb_each_text(v_ans) loop
        insert into answers values (k, v);
      end loop;
    end
    $outer$;
    select k, v from answers`
  const { rows } = await db.execute(sql)
  const out: Record<string, string> = {}
  for (const r of rows as { k: string; v: string }[]) out[r.k] = r.v
  if (out.skipped !== undefined) console.log(`  (skipped ${name}: ${out.skipped})`)
  return out
}

/** A message, through the real door. `say` returns the job's project. */
const SAY = (ref: string, key: string, project: 'v_p' | 'v_q' | 'none') => `
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, subject, instruction${project === 'none' ? '' : ', project_id'}, dedupe_key)
  values ('telegram', '${ref}', '${ref.split(':')[0]}', 'ctx-${run}',
          'A message.'${project === 'none' ? '' : `, ${project}`}, '${key}')
  returning command_id into v_c;
  perform app.enqueue_inbound(v_c);`

const answer = (k: string) => `
  v_ans := v_ans || jsonb_build_object('${k}',
    coalesce((select p.slug from public.jobs j
                left join public.projects p on p.project_id = j.project_id
               where j.idempotency_key = format('inbound-%s', v_c)), 'NONE'));`
const slugOf = (which: 'v_p' | 'v_q') => `
  v_ans := v_ans || jsonb_build_object('${which}',
    (select slug from public.projects where project_id = ${which}));`

console.log(`\n#308 — a conversation remembers its project  (run ${run})\n`)

// ------------------------------------------------- the invariant itself
{
  const r = await scenario(
    'inherit',
    `${slugOf('v_p')}
     ${SAY(`8${run}1:1`, `telegram:ctx:${run}_a`, 'v_p')} ${answer('first')}
     ${SAY(`8${run}1:2`, `telegram:ctx:${run}_b`, 'none')} ${answer('second')}
     ${SAY(`8${run}1:3`, `telegram:ctx:${run}_c`, 'none')} ${answer('third')}
     ${SAY(`8${run}1:4`, `telegram:ctx:${run}_d`, 'none')} ${answer('fourth')}`,
  )
  if (r.skipped === undefined) {
    ok('the named project lands on the first turn', r.first === r.v_p, `${r.first}`)
    ok('the second turn inherits it', r.second === r.v_p, `${r.second}`)
    ok('and so does the third', r.third === r.v_p, `${r.third}`)
    ok('and the fourth — it does not decay', r.fourth === r.v_p, `${r.fourth}`)
  }
}

// ------------------------------------------------- switching, and back
{
  const r = await scenario(
    'switch',
    `${slugOf('v_p')} ${slugOf('v_q')}
     ${SAY(`8${run}2:1`, `telegram:ctx:${run}_e`, 'v_p')} ${answer('one')}
     ${SAY(`8${run}2:2`, `telegram:ctx:${run}_f`, 'v_q')} ${answer('switched')}
     ${SAY(`8${run}2:3`, `telegram:ctx:${run}_g`, 'none')} ${answer('after')}
     ${SAY(`8${run}2:4`, `telegram:ctx:${run}_h`, 'v_p')} ${answer('back')}
     ${SAY(`8${run}2:5`, `telegram:ctx:${run}_i`, 'none')} ${answer('stayed')}`,
  )
  if (r.skipped === undefined) {
    ok(
      'an explicit switch moves the conversation',
      r.switched === r.v_q,
      `got ${r.switched}, wanted ${r.v_q} (first turn was ${r.one} / ${r.v_p})`,
    )
    ok(
      'the next implicit turn follows the switch',
      r.after === r.v_q,
      `got ${r.after}, wanted ${r.v_q}`,
    )
    ok('switching back works', r.back === r.v_p, `${r.back}`)
    ok('and the conversation stays there', r.stayed === r.v_p, `${r.stayed}`)
  }
}

// ------------------------------------------------- a different conversation
{
  const r = await scenario(
    'isolation',
    `${slugOf('v_p')}
     ${SAY(`8${run}3:1`, `telegram:ctx:${run}_j`, 'v_p')} ${answer('established')}
     ${SAY(`8${run}4:1`, `telegram:ctx:${run}_k`, 'none')} ${answer('elsewhere')}`,
  )
  if (r.skipped === undefined) {
    ok('one conversation establishes a project', r.established === r.v_p)
    /*
      THE PROPERTY THAT STOPS THIS BEING A GLOBAL GUESS. A different chat has
      its own memory and must inherit nothing — otherwise "context" is just
      the most recent project by another name, which is the heuristic this
      replaces.
    */
    ok('a different conversation inherits NOTHING from it', r.elsewhere !== r.v_p, `${r.elsewhere}`)
  }
}

// ------------------------------------------------- only explicit resolutions
{
  const r = await scenario(
    'no-guess',
    `${SAY(`8${run}5:1`, `telegram:ctx:${run}_l`, 'none')} ${answer('unresolved')}
     v_ans := v_ans || jsonb_build_object('remembered',
       coalesce(app.current_project('telegram_chat', '8${run}5')::text, 'NONE'));`,
  )
  if (r.skipped === undefined) {
    /*
      A turn nothing could resolve falls to Unnamed, which is ADR-0024 and is
      correct. What must NOT happen is that the fallback becomes the
      conversation's memory — a guess written there would lock the whole
      exchange onto something nobody said, which is worse than guessing once
      because it compounds.
    */
    ok('an unresolvable first turn still goes to Unnamed', r.unresolved === 'unnamed')
    ok('and the conversation remembers NOTHING from a guess', r.remembered === 'NONE')
  }
}

// ------------------------------------------------- containment, both ways
{
  const r = await scenario(
    'containment',
    `${slugOf('v_p')}
     ${SAY(`8${run}6:1`, `telegram:ctx:${run}_m`, 'v_p')} ${answer('real')}
     insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
       select 'telegram_chat', '8${run}6', project_id, 'harness', 'a synthetic switch'
         from public.projects where is_fixture and status = 'active' limit 1;
     v_ans := v_ans || jsonb_build_object('after_synthetic',
       coalesce(app.current_project('telegram_chat', '8${run}6')::text, 'NONE'));`,
  )
  if (r.skipped === undefined) {
    ok('a real conversation establishes its project', r.real === r.v_p)
    /*
      And a synthetic switch on top of it reads as NO scope rather than as the
      fixture — 0164's rule, which is what stops a harness session handing a
      real conversation its own project. The real project is not returned
      either, which is the honest outcome: the latest thing said about this
      scope was synthetic, so the office knows nothing rather than something
      stale.
    */
    ok(
      'a synthetic switch cannot give a real conversation a fixture project',
      r.after_synthetic === 'NONE',
      r.after_synthetic,
    )
  }
}

// ------------------------------------------------- a paused project
{
  const r = await scenario(
    'paused',
    `insert into public.projects (slug, name, purpose, status)
     values ('verify-ctx-paused-${run}', 'Context paused ${run}', 'Thrown away', 'paused')
     returning project_id into v_q;
     insert into public.inbound_commands
       (origin_channel, origin_ref, actor, subject, instruction, project_id, dedupe_key)
     values ('telegram', '8${run}7:1', '8${run}7', 'ctx-${run}', 'A message.', v_q, 'telegram:ctx:${run}_p')
     returning command_id into v_c;
     perform app.enqueue_inbound(v_c); ${answer('paused')}`,
  )
  if (r.skipped === undefined) {
    /*
      0548. `project_switches` refuses anything but an active project, and
      0547 put that refusal in the path of every inbound message — so a
      message about a PAUSED project raised and was lost before the job
      existed. Remembering is best-effort; delivering is not.
    */
    ok(
      'a message about a paused project still becomes a job',
      r.paused === `verify-ctx-paused-${run}`,
      `${r.paused}`,
    )
  }
}

// ------------------------------------------------- the other channels
{
  const r = await scenario(
    'channels',
    `${slugOf('v_p')}
     insert into public.inbound_commands
       (origin_channel, origin_ref, actor, subject, instruction, project_id, dedupe_key)
     values ('voice', 'call${run}:1', 'grant', 'ctx-${run}', 'A call.', v_p, 'voice:ctx:${run}_v1')
     returning command_id into v_c;
     perform app.enqueue_inbound(v_c); ${answer('voice_first')}
     insert into public.inbound_commands
       (origin_channel, origin_ref, actor, subject, instruction, dedupe_key)
     values ('voice', 'call${run}:2', 'grant', 'ctx-${run}', 'More of the call.', 'voice:ctx:${run}_v2')
     returning command_id into v_c;
     perform app.enqueue_inbound(v_c); ${answer('voice_second')}`,
  )
  if (r.skipped === undefined) {
    /*
      Voice matters most: 52% of Grant's voice notes carry no project at all,
      which is the measurement that makes this foundational rather than an
      edge case.
    */
    ok('a voice turn establishes the project', r.voice_first === r.v_p, `${r.voice_first}`)
    ok(
      'and a later one with no metadata inherits it',
      r.voice_second === r.v_p,
      `${r.voice_second}`,
    )
  }
}

/*
  Nothing to tear down: every statement above ran inside a `do` block that
  ends in a rollback, so no job, no command and no switch survives. Asserted
  rather than assumed, because a teardown that matches nothing looks exactly
  like one that worked.
*/
const left = await db.execute(`
  select (select count(*) from public.inbound_commands where subject = 'ctx-${run}') as commands,
         (select count(*) from public.project_switches where scope_ref like '8${run}%') as switches`)
const l = left.rows[0] as { commands: number; switches: number }
ok(
  'the suite left no command and no switch behind',
  Number(l.commands) === 0 && Number(l.switches) === 0,
  `${String(l.commands)} command(s), ${String(l.switches)} switch(es)`,
)

console.log(`\n${pass}/${pass + fail} checks passed\n`)
process.exit(fail === 0 ? 0 : 1)
