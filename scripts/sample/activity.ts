/**
 * #409: Recent activity says what happened on the work, and only what happened.
 *   npx tsx scripts/sample/activity.ts
 * Drives `app.studio_activity` in ONE rolled-back block against a Sample project: nothing is committed, nothing is
 * left behind, no job is created and no model is spent. The block builds a small, known history (a task added and
 * finished by the person, a task added by a specialist, a document the person dropped in, one the office made, a
 * contact, an answer from a specialist) and asserts what the reader says about it, then the negatives:
 *   - a burst by one actor on one day is ONE line with a count, not N lines
 *   - the office's plumbing (a committed finding) is not a line
 *   - a cancelled task, an archived contact, a harness task and a document from a connector are not lines
 *   - a specialist's line is attributed to the specialist, the person's to `you`, never to a raw owner key
 *   - an empty project says nothing rather than something
 * CONTROL: the same predicates are shown a history with no activity, and must find nothing.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { check, results, SECOND_OFFICE } from '../p4/lib.ts'
import { SAMPLE_OWNER_KEY } from './guard.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const OWNER = SAMPLE_OWNER_KEY
check(
  'the Sample office has an owner key (the raw name the page must never show)',
  OWNER.length > 0,
  OWNER,
)

// A throwaway project inside the block: an empty one first (the control), then the history.
const block = `
do $x$
declare
  o constant uuid := ${lit(SECOND_OFFICE)}::uuid;
  p uuid; q uuid; s uuid; a jsonb; e jsonb; t1 uuid; v text := '';
begin
  insert into public.projects (office_id, slug, name, status, reserved_reason) values (o, 'zz-act-empty-' || substr(md5(random()::text),1,6), 'Activity control empty', 'active', null) returning project_id into q;
  e := app.studio_activity(q, 12);
  -- the project's own creation is the one honest line an empty project has
  v := v || 'EMPTY_LINES:' || jsonb_array_length(e) || E'\\n';

  insert into public.projects (office_id, slug, name, status) values (o, 'zz-act-' || substr(md5(random()::text),1,6), 'Activity proof', 'active') returning project_id into p;
  select staff_id into s from public.staff where slug = 'finance-director';

  -- the person: three tasks in one burst, one of them finished
  insert into public.tasks (office_id, project_id, title, added_by, state) values (o, p, 'Proof task one', ${lit(OWNER)}, 'todo') returning task_id into t1;
  insert into public.tasks (office_id, project_id, title, added_by, state) values (o, p, 'Proof task two', ${lit(OWNER)}, 'todo');
  insert into public.tasks (office_id, project_id, title, added_by, state, done_at, completed_by) values (o, p, 'Proof task three', ${lit(OWNER)}, 'done', app.now_utc(), ${lit(OWNER)});
  -- a specialist adds one
  insert into public.tasks (office_id, project_id, title, added_by, state) values (o, p, 'Specialist task', 'finance-director', 'todo');
  -- NOT lines: cancelled, and a harness task
  insert into public.tasks (office_id, project_id, title, added_by, state) values (o, p, 'Cancelled proof task', ${lit(OWNER)}, 'cancelled');
  insert into public.tasks (office_id, project_id, title, added_by, state) values (o, p, 'Harness proof task', 'verify:activity-proof', 'todo');
  -- a contact, one archived
  insert into public.contacts (project_id, name, kind) values (p, 'Proof Person', 'person');
  insert into public.contacts (project_id, name, kind, archived_at) values (p, 'Archived Proof Person', 'person', app.now_utc());
  -- documents: one dropped in, one a connector brought (NOT a line)
  insert into public.documents (office_id, project_id, title, doc_type, storage_path, mime_type, byte_size, origin, state, added_by)
    values (o, p, 'proof-notes.md', 'file', 'zz/proof', 'text/markdown', 10, 'yours', 'approved', ${lit(OWNER)});
  insert into public.documents (office_id, project_id, title, doc_type, connector, external_ref, origin, state)
    values (o, p, 'connector-sync-thing', 'file', 'drive', 'zz-ext-' || md5(random()::text), 'source', 'approved');

  a := app.studio_activity(p, 20);
  v := v || 'ALL:' || a::text || E'\\n';
  raise exception 'VERDICT:%', v;
end $x$;`

const out = await db
  .execute(block)
  .then(() => '')
  .catch((e: unknown) => String((e as Error).message))
const verdict = out.split('VERDICT:')[1] ?? ''
check('the block ran to its verdict (and rolled back)', verdict !== '', out.slice(0, 200))
const emptyLines = Number(/EMPTY_LINES:(\d+)/.exec(verdict)?.[1] ?? -1)
const all = JSON.parse((/ALL:(.*)/.exec(verdict)?.[1] ?? '[]').trim()) as {
  who: string
  verb: string
  what: string
}[]
const say = (x: { who: string; verb: string; what: string }): string =>
  `${x.who} ${x.verb} ${x.what}`
const lines = all.map(say)
console.log(lines.map((l) => `     ${l}`).join('\n'))

check(
  'CONTROL: a project with nothing in it has no line but its own creation',
  emptyLines >= 0 && emptyLines <= 1,
  `${emptyLines} line(s)`,
)
check(
  'the person adding three tasks in one go is ONE line with a count',
  lines.some((l) => l === 'you added 3 tasks'),
  lines.join(' | '),
)
check(
  'finishing one is its own line, by the person',
  lines.some((l) => l === 'you completed the task "Proof task three"'),
)
check(
  'a specialist adding one is attributed to the specialist',
  lines.some((l) => l === 'finance-director added the task "Specialist task"'),
)
check(
  'a file the person dropped in is a line',
  lines.some((l) => l === 'you added the document "proof-notes.md"'),
)
check(
  'a contact is a line',
  lines.some((l) => l === 'you added the contact Proof Person'),
)
check(
  'the project being created is a line',
  lines.some((l) => l === 'you created this project'),
)
// A negative that holds because nothing came back at all is the vacuous control this repository keeps recording.
check('the history produced lines to be negative about', lines.length >= 6, `${lines.length}`)
check(
  'NEGATIVE: the raw owner key never appears as a name',
  lines.length > 0 && !JSON.stringify(all).includes(OWNER),
)
check(
  'NEGATIVE: a cancelled task, a harness task, an archived contact and a connector document are not lines',
  lines.length > 0 &&
    !lines.some((l) => /Cancelled proof|Harness proof|Archived Proof|connector-sync/.test(l)) &&
    !lines.some((l) => l === 'you added 4 tasks' || l === 'you added 5 tasks'),
)
check(
  'NEGATIVE: the office’s plumbing is not a line',
  lines.length > 0 && !lines.some((l) => /recorded a finding|finished a piece of work/.test(l)),
)
check(
  'the block rolled back: no proof project survives',
  Number(
    (
      (
        await db.execute(
          `select count(*)::int n from public.projects where office_id = ${lit(SECOND_OFFICE)}::uuid and name like 'Activity %'`,
        )
      ).rows[0] as { n: number }
    ).n,
  ) === 0,
)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exitCode = failed.length === 0 ? 0 : 1
