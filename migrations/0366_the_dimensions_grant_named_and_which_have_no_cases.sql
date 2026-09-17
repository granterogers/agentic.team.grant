-- The coverage dimensions, as data, and a way to tag a case with them.
--
-- Issue #235, workstream G. Grant named thirty-nine dimensions and then said
-- what to do with them:
--
--   "Do NOT reduce this to 200 random prompts. First build the coverage matrix
--    and determine what dimensions are actually represented."
--
-- The point of a matrix over a list of prompts is that it can show a ZERO, and
-- the zeroes are the number worth knowing. A list cannot.
--
-- Why a table rather than an array in a script: it is the same reasoning as
-- 0201 moving routing vocabulary into staff.expertise. Grant edits what the
-- office knows about itself; a dimension list living in TypeScript is one he
-- cannot add to, and his long-range instruction is to reduce his dependence on
-- a coding session for exactly this kind of change.

create table if not exists public.breadth_dimensions (
  dimension   text primary key,
  family      text not null,
  note        text not null default '',
  added_at    timestamptz not null default app.now_utc()
);

comment on table public.breadth_dimensions is
  'The coverage dimensions of #235. Grant may add rows; nothing in code enumerates them.';

insert into public.breadth_dimensions (dimension, family, note) values
  ('agents',                    'who',      'every member of the roster is reachable'),
  ('declared-capabilities',     'who',      'what an agent says it can do'),
  ('tools-and-integrations',    'who',      'the meaningful ones, not every registry row'),
  ('research',                  'work',     ''),
  ('analysis',                  'work',     ''),
  ('planning',                  'work',     ''),
  ('recommendations',           'work',     ''),
  ('creation',                  'work',     'writing and making, as opposed to answering'),
  ('actions',                   'work',     'the office changes something outside itself'),
  ('project-management',        'work',     ''),
  ('software-and-project-reasoning', 'work', ''),
  ('business-strategy',         'domain',   ''),
  ('monetisation',              'domain',   ''),
  ('finance',                   'domain',   ''),
  ('marketing-and-growth',      'domain',   ''),
  ('communications',            'domain',   ''),
  ('operations',                'domain',   ''),
  ('quality-and-risk',          'domain',   ''),
  ('connected-knowledge',       'context',  'work that depends on an attached source'),
  ('project-scoped-work',       'context',  ''),
  ('cross-project-work',        'context',  ''),
  ('memory-dependent-work',     'context',  'needs what was said earlier'),
  ('single-agent-work',         'shape',    ''),
  ('multi-agent-work',          'shape',    ''),
  ('tool-heavy-work',           'shape',    ''),
  ('no-tool-reasoning',         'shape',    ''),
  ('permission-gated-actions',  'shape',    'the office is allowed to refuse'),
  ('unavailable-capabilities',  'failure',  'asked for something it genuinely cannot do'),
  ('provider-failures',         'failure',  ''),
  ('malformed-inputs',          'failure',  ''),
  ('contradictory-instructions','failure',  ''),
  ('corrections',               'failure',  'Grant says the previous answer was wrong'),
  ('changed-intent',            'failure',  'he wants something else now'),
  ('ambiguous-requests',        'language', ''),
  ('long-multi-clause',         'language', ''),
  ('voice-and-speech-style',    'language', 'how he actually talks into a phone'),
  ('hallucination-traps',       'failure',  'the answer is only available by making it up')
on conflict (dimension) do nothing;

alter table public.eval_cases
  add column if not exists dimensions text[] not null default '{}';

comment on column public.eval_cases.dimensions is
  'Which #235 dimensions this case covers. Every element must exist in breadth_dimensions.';

/*
  Validated by a trigger rather than by a CHECK listing the words.

  A CHECK constraint enumerating thirty-seven dimensions is the pattern 0311
  spent a migration undoing, and it would mean a code change every time Grant
  adds one. A trigger against the table lets the vocabulary grow where it lives
  and still refuses a typo -- which is the actual risk, since a misspelled
  dimension does not error, it silently creates a zero somewhere and hides a
  case from the count.
*/
create or replace function app.eval_case_dimensions_exist()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_unknown text;
begin
  select string_agg(d, ', ')
    into v_unknown
    from unnest(new.dimensions) as d
   where not exists (select 1 from public.breadth_dimensions b where b.dimension = d);

  if v_unknown is not null then
    raise exception
      'no such coverage dimension: %. Add it to public.breadth_dimensions first, '
      'or fix the spelling -- an unknown dimension does not fail, it silently '
      'creates a zero in the matrix and hides this case from the count.',
      v_unknown
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists eval_cases_dimensions_exist on public.eval_cases;
create trigger eval_cases_dimensions_exist
  before insert or update of dimensions on public.eval_cases
  for each row execute function app.eval_case_dimensions_exist();

-- Tag the twenty cases that already exist. Nothing is invented here: each tag
-- is read off the case's own `ask` and the Issue it was written for.
update public.eval_cases set dimensions = case slug
  when 'bullets-inverted'                  then array['creation','communications']
  when 'capability-false-claim'            then array['declared-capabilities','hallucination-traps']
  when 'capability-false-denial'           then array['declared-capabilities','unavailable-capabilities']
  when 'capability-honest-and-proposes'    then array['declared-capabilities','unavailable-capabilities','recommendations']
  when 'clause-all-accounted'              then array['long-multi-clause']
  when 'clause-dropped-silently'           then array['long-multi-clause']
  when 'delegation-nominal'                then array['multi-agent-work','agents']
  when 'evidence-claimed-read'             then array['hallucination-traps','connected-knowledge']
  when 'evidence-honest-about-not-looking' then array['hallucination-traps','connected-knowledge']
  when 'list-arrives-as-a-list'            then array['creation','communications']
  when 'no-documents'                      then array['connected-knowledge','project-scoped-work']
  when 'notebook-recovery'                 then array['tools-and-integrations','provider-failures']
  when 'notebook-sayback'                  then array['tools-and-integrations','long-multi-clause']
  when 'project-asks-when-ambiguous'       then array['ambiguous-requests','project-scoped-work']
  when 'project-guessed-when-ambiguous'    then array['ambiguous-requests','project-scoped-work']
  when 'prose-stays-prose'                 then array['creation','communications']
  when 'rambling-voice-note'               then array['voice-and-speech-style','long-multi-clause']
  when 'telegram-buttons'                  then array['declared-capabilities','tools-and-integrations']
  when 'thumbs-placement'                  then array['declared-capabilities']
  when 'ux-plan'                           then array['planning','software-and-project-reasoning']
  else dimensions end
 where slug in (
   'bullets-inverted','capability-false-claim','capability-false-denial',
   'capability-honest-and-proposes','clause-all-accounted','clause-dropped-silently',
   'delegation-nominal','evidence-claimed-read','evidence-honest-about-not-looking',
   'list-arrives-as-a-list','no-documents','notebook-recovery','notebook-sayback',
   'project-asks-when-ambiguous','project-guessed-when-ambiguous','prose-stays-prose',
   'rambling-voice-note','telegram-buttons','thumbs-placement','ux-plan');

grant select on public.breadth_dimensions to authenticated, anon, service_role;
