-- 0272 — an output can declare its shape
--
-- Issue #130. `outputs.body` is text for every job kind. A research summary, a
-- list of extracted tasks and a draft document are three different things, and
-- every consumer re-parses prose to find out what it got.
--
-- That is why **IMPORT TO PROJECT (#28) is reading English** to work out what
-- to import, and why a list of extracted tasks cannot simply become tasks —
-- even though `hq_task_add` has been a complete write path since #11 and #106.
--
-- ## `body` stays, and that is not a compromise
--
-- Prose is what Grant reads and it is the right thing to send to Telegram. The
-- structure sits BESIDE it, never instead of it. #130 says it plainly:
--
--   > An output that is only structured is an output nobody wants to receive.
--
-- ## One authority for the shapes, in the database
--
-- The obvious design is a TypeScript type per shape, and it is wrong here. The
-- validator has to run where the row is written, the consumers are SQL (the
-- studio payload, the import step, `hq_task_add`), and a shape declared in
-- TypeScript would be a rule the database could not enforce — so a row could
-- be written that no consumer can read, which is exactly the state this issue
-- is about, moved one layer down.
--
-- So the shapes are ROWS. A handler names one; the insert validates against it.
-- `verify:shapes` then holds the handlers against the table, so a handler
-- naming a shape nobody declared fails at the check rather than at runtime.
--
-- ## Why the spec is a small vocabulary rather than JSON Schema
--
-- JSON Schema in plpgsql is a project. What is actually needed is: which keys
-- must be there, and roughly what each one is. Seven type words cover every
-- shape below, they can be read by a person in the table, and the error names
-- the key and what it should have been. A validator nobody can read is a
-- validator people route around.
--
--     string · number · boolean · object · array
--     array<string> · array<object>
--
-- ## The shapes are not invented
--
-- #130: *"Not invented. The kinds that already exist and already imply a shape
-- ... Each one has a consumer today that is guessing."* Every row below is
-- something the office already produces in prose.

begin;

create table public.output_shapes (
  shape        text        primary key,
  description  text        not null,

  -- {key: type}. Both are the small vocabulary above; `required` refuses the
  -- output when absent, `optional` is only type-checked when present.
  required     jsonb       not null default '{}'::jsonb,
  optional     jsonb       not null default '{}'::jsonb,

  created_at   timestamptz not null default app.now_utc(),

  constraint output_shapes_name_format
    check (shape ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint output_shapes_described
    check (length(trim(description)) >= 20),
  constraint output_shapes_specs_are_objects
    check (jsonb_typeof(required) = 'object' and jsonb_typeof(optional) = 'object')
);

comment on table public.output_shapes is
  '#130. What an output of a given shape must carry. Rows rather than '
  'TypeScript types, because the validator has to run where the row is written '
  'and every consumer is SQL.';

alter table public.outputs
  add column shape text references public.output_shapes (shape),
  add column facts jsonb;

comment on column public.outputs.facts is
  '#130. The structure beside the prose, never instead of it. Null when the '
  'handler claims no shape, which is most of them and is honest.';

-- Shape and facts arrive together or not at all. One without the other is
-- either a claim with nothing behind it or data nobody can interpret.
alter table public.outputs add constraint outputs_shape_and_facts_together
  check ((shape is null) = (facts is null));

create index outputs_by_shape on public.outputs (shape) where shape is not null;

-- ---------------------------------------------------------------------------
-- The validator
-- ---------------------------------------------------------------------------

/**
 * Does this value match that type word?
 *
 * `array<object>` and `array<string>` check the ELEMENTS, because an empty
 * promise is the common failure: a summary claiming three sources and carrying
 * an array of nulls passes a naive "it is an array" and is useless to the
 * consumer that asked for it.
 */
create or replace function app.output_value_is(p_value jsonb, p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'string'        then jsonb_typeof(p_value) = 'string'
    when 'number'        then jsonb_typeof(p_value) = 'number'
    when 'boolean'       then jsonb_typeof(p_value) = 'boolean'
    when 'object'        then jsonb_typeof(p_value) = 'object'
    when 'array'         then jsonb_typeof(p_value) = 'array'
    when 'array<string>' then jsonb_typeof(p_value) = 'array'
      and not exists (select 1 from jsonb_array_elements(p_value) e
                       where jsonb_typeof(e) <> 'string')
    when 'array<object>' then jsonb_typeof(p_value) = 'array'
      and not exists (select 1 from jsonb_array_elements(p_value) e
                       where jsonb_typeof(e) <> 'object')
    else false
  end
$$;

/**
 * What is wrong with these facts, as a sentence, or null when nothing is.
 *
 * A sentence rather than a boolean, for the same reason every refusal in this
 * schema is: `hq_dashboard_layout_set` says which panels are malformed and
 * `job_plan_set` says how many steps are. "Invalid" sends somebody reading the
 * table definition; "findings should be array<string>, got string" is a fix.
 *
 * Missing and wrong are reported apart, because they are different mistakes: a
 * key nobody set is usually a handler that forgot, and a key of the wrong type
 * is usually a handler that assumed.
 */
create or replace function app.output_shape_problem(p_shape text, p_facts jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_spec public.output_shapes;
  v_missing text[];
  v_wrong text[];
begin
  if p_shape is null and p_facts is null then return null; end if;
  if p_shape is null then
    return 'facts were given with no shape to interpret them';
  end if;

  select * into v_spec from public.output_shapes where shape = p_shape;
  if not found then
    return format('%L is not a declared output shape', p_shape);
  end if;

  if coalesce(jsonb_typeof(p_facts), 'missing') <> 'object' then
    return 'facts must be an object';
  end if;

  -- `coalesce(jsonb_typeof(...), 'missing')` throughout: `p_facts -> key` is
  -- SQL NULL when the key is ABSENT, and a NULL comparison is dropped rather
  -- than failing. Migration 0251 lost a day to exactly that on the dashboard
  -- layout, and 0267 to the same thing on plan steps.
  select array_agg(k.key order by k.key) into v_missing
    from jsonb_each_text(v_spec.required) k
   where coalesce(jsonb_typeof(p_facts -> k.key), 'missing') = 'missing';

  select array_agg(format('%s should be %s', k.key, k.value) order by k.key)
    into v_wrong
    from jsonb_each_text(v_spec.required) k
   where coalesce(jsonb_typeof(p_facts -> k.key), 'missing') <> 'missing'
     and not app.output_value_is(p_facts -> k.key, k.value);

  if v_wrong is null then
    select array_agg(format('%s should be %s', k.key, k.value) order by k.key)
      into v_wrong
      from jsonb_each_text(v_spec.optional) k
     where coalesce(jsonb_typeof(p_facts -> k.key), 'missing') <> 'missing'
       and not app.output_value_is(p_facts -> k.key, k.value);
  end if;

  if v_missing is not null then
    return format('a %s output is missing %s', p_shape, array_to_string(v_missing, ', '));
  end if;
  if v_wrong is not null then
    return format('a %s output has %s', p_shape, array_to_string(v_wrong, ', '));
  end if;
  return null;
end;
$$;

comment on function app.output_shape_problem is
  '#130. Null when the facts match the declared shape, otherwise a sentence '
  'naming the key and what it should have been.';

/*
  Enforced at the moment of writing.

  #130: *"an output that does not match is a job failure at the moment it
  happens rather than a surprise at the moment it is read."* A trigger rather
  than a check on the caller, because the caller is not the only possible
  caller, and a rule enforced in one of two write paths is a rule.
*/
create or replace function app.outputs_match_their_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_problem text;
begin
  v_problem := app.output_shape_problem(new.shape, new.facts);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger outputs_match_their_shape
  before insert or update of shape, facts on public.outputs
  for each row execute function app.outputs_match_their_shape();

-- ---------------------------------------------------------------------------
-- The shapes themselves
-- ---------------------------------------------------------------------------

insert into public.output_shapes (shape, description, required, optional) values
  ('tasks_extracted',
   'A list of things to do, found in something the office read. The headline '
   'case: each entry can become a real task through hq_task_add, which has '
   'been a complete write path since #11 and #106 and had nothing to feed it.',
   '{"tasks": "array<object>"}'::jsonb,
   '{"from": "string"}'::jsonb),

  ('research_summary',
   'What was found, and where it came from. #116''s judge can check this '
   'without a model: a summary claiming three sources and carrying one is '
   'objectively wrong and no LLM is needed to say so.',
   '{"findings": "array<string>", "sources": "array<object>"}'::jsonb,
   '{"unanswered": "array<string>"}'::jsonb),

  ('draft_document',
   'A document the office wrote, ready to be imported into a project. The '
   'title is separate from the markdown so the import step has something to '
   'name the row with rather than taking the first line and hoping.',
   '{"title": "string", "markdown": "string"}'::jsonb,
   '{"suggested_collection": "string", "tags": "array<string>"}'::jsonb),

  ('comparison',
   'Several options weighed against each other. Every consumer of one of '
   'these today re-reads the prose to find out which option won.',
   '{"options": "array<object>"}'::jsonb,
   '{"recommended": "string", "criteria": "array<string>"}'::jsonb),

  ('recommendation',
   'One course of action and the reasons for it. The reasons are a list '
   'rather than a paragraph so that a follow-up can check whether any of them '
   'has stopped being true.',
   '{"recommend": "string", "because": "array<string>"}'::jsonb,
   '{"alternatives": "array<string>", "confidence_note": "string"}'::jsonb),

  ('nothing_happened',
   'A duty that ran and found nothing to do. Structured because "nothing '
   'changed" is the answer sixteen times a day and a consumer should not have '
   'to read a sentence to establish it.',
   '{"changed": "boolean"}'::jsonb,
   '{"looked_at": "number"}'::jsonb)
on conflict (shape) do nothing;

alter table public.output_shapes enable row level security;
alter table public.output_shapes force  row level security;
grant select on public.output_shapes to ai_team_app;
create policy output_shapes_app_read on public.output_shapes
  for select to ai_team_app using (true);
grant execute on function app.output_shape_problem(text, jsonb) to ai_team_app;
grant execute on function app.output_value_is(jsonb, text) to ai_team_app;

/** The declared shapes, for a check and for anything that renders one. */
create or replace function public.hq_output_shapes()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'shape', s.shape, 'description', s.description,
           'required', s.required, 'optional', s.optional) order by s.shape), '[]'::jsonb)
    from public.output_shapes s
$$;

commit;
