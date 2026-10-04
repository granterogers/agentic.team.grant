/**
 * A project named in a message is the message's project, when no surface stated one (#416, migration 0880).
 *   npm run verify:named-project
 *
 * Everything runs inside ONE block that ends in a deliberate exception, so nothing is committed: commands and jobs are
 * created in the Sample office (never Grant's) and rolled back, which is how this repository drives a function that
 * writes (a suite that creates real jobs leaves them for ever). The answers come back in the error text and are asserted
 * from there. Includes the negative controls that stop recall being bought with precision:
 *   - two projects named is a comparison, not a choice;
 *   - a surface that STATED a project beats a name in the words;
 *   - the dashboard (teamhq) never takes its project from the words;
 *   - a project that exists only in another office is not found by name;
 *   - a name shorter than four characters, or only part of a word, matches nothing.
 */
import { db, lit, rows, sampleOffice } from '../sample/lib.ts'

let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const office = (await sampleOffice()).officeId
const mine = (
  await rows(
    `select slug, name from public.projects where office_id = ${lit(office)}::uuid and status = 'active' and not is_fixture and slug <> 'unnamed' order by name`,
  )
).map((r) => ({ slug: String(r.slug), name: String(r.name) }))
const [a, b] = mine
if (a === undefined || b === undefined) throw new Error('the Sample needs two active projects')

// A project of somebody else's, read only for its NAME.
const theirs = String(
  (
    await rows(
      `select p.name from public.projects p
        where p.office_id = app.operator_office() and p.status = 'active' and not p.is_fixture and p.slug <> 'unnamed'
          and char_length(p.name) >= 8
          and not exists (select 1 from public.projects m where m.office_id = ${lit(office)}::uuid and lower(m.name) = lower(p.name))
        limit 1`,
    )
  )[0]?.name ?? '',
)

const run = Math.random().toString(36).slice(2, 8)
let seq = 0
const say = (channel: string, chat: string, words: string, stated: string | null): string => {
  seq += 1
  // The key's shape is checked by the table (channel:kind:rest), and `named-<run>` is what teardown looks for.
  const key = `${channel}:message:named-${run}-${seq}`
  return `
    insert into public.inbound_commands
      (office_id, origin_channel, origin_ref, actor, instruction, ${stated === null ? '' : 'project_id, '}dedupe_key)
    values (${lit(office)}::uuid, ${lit(channel)}, ${lit(`${chat}:${seq}`)}, ${lit(chat)}, ${lit(words)},
            ${stated === null ? '' : `(select project_id from public.projects where office_id = ${lit(office)}::uuid and slug = ${lit(stated)}), `}${lit(key)})
    returning command_id into v_c;
    perform app.enqueue_inbound(v_c);
    v_out := v_out || jsonb_build_object(${lit(`k${seq}`)},
      coalesce((select p.slug from public.jobs j join public.projects p on p.project_id = j.project_id
                 where j.idempotency_key = format('inbound-%s', v_c)), 'NONE'));`
}

const cases: { id: string; sql: string }[] = [
  { id: 'named', sql: say('telegram', `9${run}1`, `How is the ${a.name} going?`, null) },
  // the same chat, no name: the conversation remembers what was named
  { id: 'remembered', sql: say('telegram', `9${run}1`, 'And what is still outstanding?', null) },
  { id: 'two', sql: say('telegram', `9${run}2`, `Compare ${a.name} with ${b.name}`, null) },
  { id: 'none', sql: say('telegram', `9${run}3`, 'What is the weather like?', null) },
  // A conversation already about A (it named A) is moved by naming B: an explicit name beats the remembered project.
  { id: 'overrides-set', sql: say('telegram', `9${run}4`, `How is ${a.name} going?`, null) },
  {
    id: 'overrides',
    sql: say('telegram', `9${run}4`, `Actually, tell me about ${b.name}`, null),
  },
  { id: 'stated', sql: say('telegram', `9${run}5`, `Mention ${b.name} in passing`, a.slug) },
  { id: 'teamhq', sql: say('teamhq', `9${run}6`, `Compare this with ${b.name}`, a.slug) },
  { id: 'short', sql: say('telegram', `9${run}7`, 'Is the Ja plan ready?', null) },
  {
    id: 'partial',
    sql: say(
      'telegram',
      `9${run}8`,
      `What about ${a.name.slice(0, Math.max(4, a.name.length - 3))}ing?`,
      null,
    ),
  },
  ...(theirs === ''
    ? []
    : [{ id: 'foreign', sql: say('telegram', `9${run}9`, `How is ${theirs} going?`, null) }]),
]

const script = `
declare v_c uuid; v_out jsonb := '{}'::jsonb;
begin
  ${cases.map((c) => c.sql).join('\n')}
  raise exception 'RESULT %', v_out::text;
end`

const answer = await db
  .execute(`do $x$ ${script} $x$`)
  .then(() => null)
  .catch(
    (e: Error) => /RESULT (\{.*\})/s.exec(e.message)?.[1] ?? `ERROR ${e.message.slice(0, 300)}`,
  )

if (answer === null || answer.startsWith('ERROR')) {
  check('the block ran and reported', false, answer ?? 'no result')
} else {
  const got = JSON.parse(answer) as Record<string, string>
  const at = (id: string): string =>
    got[`k${cases.findIndex((c) => c.id === id) + 1}`] ?? '(missing)'
  check(
    'a project named in the words is the job’s project',
    at('named') === a.slug,
    `${at('named')} (wanted ${a.slug})`,
  )
  check(
    'and the conversation remembers it for the next message',
    at('remembered') === a.slug,
    at('remembered'),
  )
  check(
    'two projects named is a comparison: it is NOT resolved to either',
    at('two') !== a.slug && at('two') !== b.slug,
    at('two'),
  )
  check(
    'no project named: unchanged, the general conversation',
    at('none') === 'unnamed',
    at('none'),
  )
  check(
    'a name beats the conversation’s remembered project',
    at('overrides') === b.slug,
    `${at('overrides')} (wanted ${b.slug})`,
  )
  check(
    'a project the surface STATED beats a name in the words',
    at('stated') === a.slug,
    `${at('stated')} (wanted ${a.slug})`,
  )
  check(
    'the dashboard never takes its project from the words',
    at('teamhq') === a.slug,
    at('teamhq'),
  )
  check('a name under four characters matches nothing', at('short') === 'unnamed', at('short'))
  check('part of a word is not a name', at('partial') !== a.slug, at('partial'))
  if (theirs === '') console.log('  (no foreign project name to test isolation against)')
  else
    check(
      'a project that exists only in another office is not found by name',
      at('foreign') === 'unnamed',
      `${at('foreign')} for "${theirs}"`,
    )
}

const leftover = Number(
  (
    await rows(
      `select count(*) n from public.inbound_commands where dedupe_key like ${lit(`%named-${run}-%`)}`,
    )
  )[0]?.n ?? -1,
)
check('nothing was committed (the block rolled back)', leftover === 0, `${leftover} rows`)
console.log(failed === 0 ? '\nNAMED PROJECT: PASS' : `\nNAMED PROJECT: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
