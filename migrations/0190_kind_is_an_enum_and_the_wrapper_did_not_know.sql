-- `briefings.kind` is an enum, and app.write_briefing did not know.
--
-- Issue #56. 0188 declared the parameter as `text` and inserted it straight
-- into a `public.briefing_kind` column:
--
--     ERROR: 42804: column "kind" is of type public.briefing_kind but
--            expression is of type text
--
-- It failed at the first call, which is the good version of this bug. The bad
-- version was available and close: had the duty fired against a deployed worker
-- before the verification ran, the briefing job would have failed at 07:00 with
-- a type error, retried, failed again, and Grant's first morning briefing would
-- have been silence — with the reason buried in `state_reason`.
--
-- The enum is (`morning`, `evening`), which is §12's pair. Taking `text` and
-- casting is deliberate rather than taking the enum type directly: the callers
-- are a TypeScript handler and PostgREST, and both send a string. A signature
-- that forces every caller to know the type name of an internal enum is a
-- signature people work around with `::text` on their side, which is the same
-- cast in a worse place.
--
-- An unrecognised value now fails with a list of what is allowed, rather than
-- with the raw cast error, because "invalid input value for enum" does not tell
-- you what the valid ones are.
--
-- `drop` first, by exact signature: `create or replace` does not replace a
-- function whose argument list changed, it creates a second overload and calls
-- become ambiguous. The list has not changed here, but the same drop is what
-- the public wrapper needs and doing one and not the other is how the pair
-- drifts.

begin;

drop function if exists app.write_briefing(text, date, text, jsonb, text);
drop function if exists public.write_briefing(text, date, text, jsonb, text);

create or replace function app.write_briefing(
  p_kind      text,
  p_for_date  date,
  p_body      text,
  p_inputs    jsonb,
  p_scope_ref text default 'grant'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  as_kind public.briefing_kind;
  made    public.briefings%rowtype;
begin
  begin
    as_kind := p_kind::public.briefing_kind;
  exception when invalid_text_representation then
    return jsonb_build_object(
      'error', format('%L is not a briefing kind; expected one of: %s',
                      p_kind,
                      (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
                         from pg_catalog.pg_enum e
                         join pg_catalog.pg_type t on t.oid = e.enumtypid
                        where t.typname = 'briefing_kind')));
  end;

  insert into public.briefings (kind, for_date, scope_ref, body, inputs)
  values (as_kind, p_for_date, p_scope_ref, p_body, coalesce(p_inputs, '{}'::jsonb))
  on conflict (kind, scope_ref, for_date) do nothing
  returning * into made;

  if made.briefing_id is null then
    return jsonb_build_object(
      'already_written', true,
      'for_date', p_for_date,
      'briefing_id', (select b.briefing_id from public.briefings b
                       where b.kind = as_kind and b.scope_ref = p_scope_ref
                         and b.for_date = p_for_date)
    );
  end if;

  return jsonb_build_object('briefing_id', made.briefing_id, 'already_written', false);
end;
$$;

comment on function app.write_briefing(text, date, text, jsonb, text) is
  'Store a briefing, at most one per kind per scope per day. Takes text and '
  'casts, because every caller is a string; an unrecognised kind is told what '
  'the valid ones are. Relies on the unique index rather than checking first: '
  'a check-then-insert has a race and an index does not.';

create or replace function public.write_briefing(
  p_kind text, p_for_date date, p_body text, p_inputs jsonb,
  p_scope_ref text default 'grant'
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.write_briefing(p_kind, p_for_date, p_body, p_inputs, p_scope_ref) $$;

commit;
