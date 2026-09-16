/**
 * A correction becomes a standing rule, and only on a press (#147).
 *
 *   npm run verify:rules
 *
 * Migrations 0390 and 0391. The reader half is unit-tested in
 * `tests/agents/correction.test.ts`, which is the right place for it: it is
 * pure text and thirty cases cost milliseconds. What cannot be unit-tested is
 * the half that matters most here — that ACCEPTING actually performs the
 * offer — because that is four SQL objects agreeing with each other, and 0390
 * shipped with two of them disagreeing.
 *
 * ## What this exists to catch
 *
 * 0390's `decide_suggestion` wrote `state = 'accepted'`. `suggestions_state_
 * check` permits `open | acted | dismissed | stale`, so the first press Grant
 * ever made would have raised 23514 — and because `app.learn` runs BEFORE the
 * update in the same statement, the rule would have been rolled back with it.
 * The migration applied cleanly, the function compiled, and the feature was
 * dead. It was found by running the press, which is the only thing that could
 * have found it.
 *
 * So every check below drives the REAL function. None of them asserts the
 * mechanism — not a state name in the abstract, not a row count on its own —
 * they assert the property Grant would notice: after a press the rule is in
 * the office's memory, and after a decline it is not.
 *
 * ## Inside a rollback, and the call is what is wrapped
 *
 * `app.learn` is a real write into the office's memory, so an unwrapped run
 * would teach Grant's office something from a probe. CLAUDE.md's rule from
 * `verify:disconnect`: wrap the CALL, not the assertion, because a wrapper
 * cannot know a call was destructive until it already has been. Each arc below
 * is therefore ONE statement — `begin`, the work, one select, `rollback` — and
 * the assertions happen here in TypeScript against what that select returned.
 */

import { readCorrection } from '../../src/agents/correction.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, string>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, string>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)

console.log(`\nverify:rules — ${run}\n`)

/* ------------------------------------------------------------------ *
 * The reader, against the office's own definition of a correction.
 * ------------------------------------------------------------------ */
console.log('the reader')

const said = 'no, at the end of the message, not after every bullet'
const correction = readCorrection(said, true)
check(
  'a correction after an answer is recognised',
  correction === null ? 'not recognised' : correction.rule,
  correction !== null,
)
check(
  'the drafted rule is his words, framed — not a rewrite of them',
  correction?.rule ?? '',
  (correction?.rule ?? '').includes('at the end of the message, not after every bullet'),
)
check(
  'the same words with nothing to correct are not a correction',
  'readCorrection(said, false)',
  readCorrection(said, false) === null,
)

/* ------------------------------------------------------------------ *
 * The arc: offered once, visible as a decision, and PERFORMED on accept.
 * ------------------------------------------------------------------ */
console.log('\naccepting performs the offer')

const RULE = `From now on, put the summary at the end of the message rather than after every bullet ${run}.`

/*
  One statement, because the id from the propose step is needed by the press
  and a second round trip would be a second transaction. The results are
  collected as columns rather than rows so the assertions below can be about
  named properties instead of about an ordering.
*/
const arc = await one(`
  begin;
  create temp table _r (k text primary key, v text);
  do $$
  declare v jsonb; v_id uuid; v_body text := ${lit(RULE)};
  begin
    v := app.propose_standing_rule(v_body, 'global', null, null, null,
           '{"signals":["it followed an answer","it is short"]}'::jsonb);
    v_id := (v ->> 'suggestion_id')::uuid;
    insert into _r values ('offered', v ->> 'offered'), ('rule', v ->> 'rule');

    -- Nothing is in the office's memory yet, and that is the whole design.
    insert into _r values ('learned_before',
      (select count(*)::text from public.lessons where body = v_body));

    -- The same class again, punctuated differently. It must not come back.
    v := app.propose_standing_rule(v_body || '  ', 'global');
    insert into _r values ('again', v ->> 'offered'), ('again_why', v ->> 'why');

    -- What the page is given: a suggestion that carries an offer is a
    -- decision, and one that does not is a note. Without this field the
    -- studio would draw Accept on things that perform nothing.
    insert into _r
      select 'page_' || k, x ->> k
        from jsonb_array_elements(app.hq_governance(400) -> 'noticed') x,
             unnest(array['offer','state','body']) k
       where x ->> 'id' = v_id::text;

    -- The press.
    v := app.decide_suggestion(v_id, true, 'grant');
    insert into _r values ('accepted', v ->> 'accepted'), ('did', v ->> 'did'),
                          ('lesson_id', coalesce(v ->> 'lesson_id', '')),
                          ('decide_error', coalesce(v ->> 'error', ''));
    insert into _r values ('state_after',
      (select state from public.suggestions where suggestion_id = v_id));
    insert into _r values ('learned_after',
      (select count(*)::text from public.lessons where body = v_body));
    insert into _r values ('learned_scope',
      (select scope::text from public.lessons where body = v_body limit 1));

    -- And pressing it again decides nothing twice.
    v := app.decide_suggestion(v_id, true, 'grant');
    insert into _r values ('twice', coalesce(v ->> 'already', ''));
  end $$;
  select
    (select v from _r where k = 'offered')       as offered,
    (select v from _r where k = 'rule')          as rule,
    (select v from _r where k = 'learned_before') as learned_before,
    (select v from _r where k = 'again')         as again,
    (select v from _r where k = 'again_why')     as again_why,
    (select v from _r where k = 'page_offer')    as page_offer,
    (select v from _r where k = 'page_state')    as page_state,
    (select v from _r where k = 'page_body')     as page_body,
    (select v from _r where k = 'accepted')      as accepted,
    (select v from _r where k = 'did')           as did,
    (select v from _r where k = 'decide_error')  as decide_error,
    (select v from _r where k = 'state_after')   as state_after,
    (select v from _r where k = 'learned_after') as learned_after,
    (select v from _r where k = 'learned_scope') as learned_scope,
    (select v from _r where k = 'twice')         as twice;
  rollback;
`)

check('the rule is offered once', `offered=${arc.offered}`, arc.offered === 'true')
check(
  'the offer stores his sentence verbatim, not a summary of it',
  (arc.rule ?? '').slice(0, 60),
  arc.rule === RULE,
)
check(
  'nothing is learned before the press',
  `${arc.learned_before} lesson(s) with that body`,
  arc.learned_before === '0',
)
check(
  'the same class is not offered twice',
  `again=${arc.again} (${arc.again_why})`,
  arc.again === 'false',
)
check(
  'the page is told this one carries an offer',
  `offer=${arc.page_offer} state=${arc.page_state}`,
  arc.page_offer === 'learn' && arc.page_state === 'open',
)
check(
  'the page shows the drafted text he is approving',
  (arc.page_body ?? '').slice(0, 60),
  arc.page_body === RULE,
)
/*
  The check 0390 did not have.

  Not "the state is acted" — that is the mechanism, and asserting a mechanism
  is what this repository has been caught doing five times. The property is
  that after the press the office HAS the rule.
*/
check(
  'the press puts the rule in the office memory',
  `accepted=${arc.accepted} did=${arc.did} error=${arc.decide_error || 'none'}`,
  arc.accepted === 'true' && arc.decide_error === '',
)
check(
  'and the memory really holds it, at the scope it was offered at',
  `${arc.learned_after} lesson(s), scope ${arc.learned_scope}`,
  arc.learned_after === '1' && arc.learned_scope === 'global',
)
check(
  'the suggestion settles into a word the table allows',
  `state=${arc.state_after}`,
  arc.state_after === 'acted',
)
check('pressing it twice does not learn it twice', `already=${arc.twice}`, arc.twice === 'acted')

/* ------------------------------------------------------------------ *
 * Declining, which must leave the office exactly as it was.
 * ------------------------------------------------------------------ */
console.log('\ndeclining performs nothing')

const NO = `From now on, never open a reply with a greeting ${run}.`
const declined = await one(`
  begin;
  create temp table _r (k text primary key, v text);
  do $$
  declare v jsonb; v_id uuid; v_body text := ${lit(NO)};
  begin
    v := app.propose_standing_rule(v_body, 'global');
    v_id := (v ->> 'suggestion_id')::uuid;
    v := app.decide_suggestion(v_id, false, 'grant');
    insert into _r values ('accepted', v ->> 'accepted');
    insert into _r values ('state',
      (select state from public.suggestions where suggestion_id = v_id));
    insert into _r values ('dismissals',
      (select dismissals::text from public.suggestions where suggestion_id = v_id));
    insert into _r values ('learned',
      (select count(*)::text from public.lessons where body = v_body));
    -- A declined offer must not come back, which is #49's own last box.
    v := app.propose_standing_rule(v_body, 'global');
    insert into _r values ('again', v ->> 'offered');
  end $$;
  select
    (select v from _r where k = 'accepted')   as accepted,
    (select v from _r where k = 'state')      as state,
    (select v from _r where k = 'dismissals') as dismissals,
    (select v from _r where k = 'learned')    as learned,
    (select v from _r where k = 'again')      as again;
  rollback;
`)

check('a decline is a decision', `accepted=${declined.accepted}`, declined.accepted === 'false')
check(
  'and it teaches the office nothing',
  `${declined.learned} lesson(s)`,
  declined.learned === '0',
)
check(
  'the decline is counted, so a hint not taken is visible',
  `state=${declined.state} dismissals=${declined.dismissals}`,
  declined.state === 'dismissed' && declined.dismissals === '1',
)
check('a declined rule does not come back', `again=${declined.again}`, declined.again === 'false')

/* ------------------------------------------------------------------ *
 * The scopes, which is where the two vocabularies could disagree.
 * ------------------------------------------------------------------ */
console.log('\nevery scope it will accept, it can also perform')

/*
  `propose_standing_rule` validates the scope it is given; `decide_suggestion`
  casts that same string to `lesson_scope` when the press arrives. Those are
  two separate lists in two separate functions, and a scope permitted by the
  first and unknown to the second is an offer that can be made and can never be
  accepted — a failure that appears months later, on a press, to Grant.

  Driven rather than read, and driven through BOTH halves, because reading the
  two lists and comparing them by eye is exactly how they came to differ.
*/
for (const scope of ['global', 'project', 'staff', 'agent', 'kind'] as const) {
  const body = `From now on, use the shorter form for ${scope} things ${run}.`
  const r = await one(`
    begin;
    create temp table _r (k text primary key, v text);
    do $$
    declare v jsonb; v_id uuid; v_body text := ${lit(body)};
    begin
      v := app.propose_standing_rule(v_body, ${lit(scope)}, 'chief-of-staff',
             (select project_id from public.projects where status = 'active' limit 1));
      insert into _r values ('offered', coalesce(v ->> 'offered', 'false')),
                            ('why', coalesce(v ->> 'error', ''));
      v_id := (v ->> 'suggestion_id')::uuid;
      if v_id is not null then
        begin
          v := app.decide_suggestion(v_id, true, 'grant');
          insert into _r values ('accepted', coalesce(v ->> 'accepted', 'false')),
                                ('raised', '');
        exception when others then
          insert into _r values ('accepted', 'false'), ('raised', sqlstate || ' ' || sqlerrm);
        end;
      end if;
    end $$;
    select (select v from _r where k = 'offered')  as offered,
           (select v from _r where k = 'why')      as why,
           (select coalesce(v, '') from _r where k = 'accepted') as accepted,
           (select coalesce(v, '') from _r where k = 'raised')   as raised;
    rollback;
  `)
  const offered = r.offered === 'true'
  check(
    `scope ${scope}: offered and acceptable, or refused up front`,
    offered ? `offered, accepted=${r.accepted} ${r.raised || ''}`.trim() : `refused: ${r.why}`,
    offered ? r.accepted === 'true' && (r.raised ?? '') === '' : (r.why ?? '') !== '',
  )
}

/* ------------------------------------------------------------------ *
 * The press, over HTTP, which is the layer the page actually uses.
 * ------------------------------------------------------------------ */
console.log('\nthe press is reachable from a browser')

/*
  Every check above went through `app.` directly. PostgREST exposes only
  `public`, and `verify:search` is this repository's warning about what that
  costs: `app.search_documents` worked perfectly, had no public wrapper, and
  nothing with a browser could call it. The suite that should have caught it
  skipped the HTTP layer.

  Nothing is written here. A suggestion id that cannot exist proves the whole
  path — the action is registered, its required arguments are enforced, the
  public wrapper resolves and the function runs — by coming back with the
  function's OWN refusal rather than with "unknown action" or a 502. A check
  whose happy path is a refusal has to assert on the words, or it passes for
  the wrong reason.
*/
const ENDPOINT = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api`
const apiToken = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
if (apiToken === '') {
  check('the hq.api_token is in the vault', 'it is not — run npm run deploy:hq', false)
} else {
  const post = async (args: Record<string, unknown>): Promise<{ status: number; body: string }> => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'suggestion_decide', args }),
    })
    return { status: response.status, body: await response.text() }
  }

  const absent = await post({
    p_suggestion_id: '00000000-0000-0000-0000-000000000000',
    p_accept: true,
  })
  check(
    'the action exists and reaches the function',
    `http ${String(absent.status)} ${absent.body.slice(0, 80)}`,
    absent.status === 200 && absent.body.includes('there is no such suggestion'),
  )

  /*
    And a missing verdict is refused rather than defaulted.

    A boolean that defaults to false would turn a dropped field into a silent
    DECLINE, and a decline cannot be undone here: the offer never comes back.
  */
  const noVerdict = await post({ p_suggestion_id: '00000000-0000-0000-0000-000000000000' })
  check(
    'a press with no verdict is refused, not read as a decline',
    `http ${String(noVerdict.status)} ${noVerdict.body.slice(0, 80)}`,
    noVerdict.status === 400 && noVerdict.body.includes('p_accept'),
  )
}

/* ------------------------------------------------------------------ *
 * Nothing this suite did survives it.
 * ------------------------------------------------------------------ */
console.log('\nteardown')

const left = await one(`
  select count(*)::text as n from public.suggestions where body like ${lit(`%${run}%`)}`)
check('no offer this run made is still on the page', `${left.n} row(s)`, left.n === '0')
const leftLessons = await one(`
  select count(*)::text as n from public.lessons where body like ${lit(`%${run}%`)}`)
check(
  'and the office learned nothing from a probe',
  `${leftLessons.n} row(s)`,
  leftLessons.n === '0',
)

const bad = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} checks passed\n`)
process.exit(bad === 0 ? 0 : 1)
