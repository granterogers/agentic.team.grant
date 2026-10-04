-- #412: the answer envelope (src/providers/envelope.ts) is a contract change for every handler that reads a model's plain
-- text, so it is on only for the offices named here, and the list starts as the Sample office alone.
--
-- A list in system_config rather than a column on offices: it is a deployment decision made and withdrawn by an operator,
-- it carries no per-person data, and widening it must be one reviewed edit of one row. An unlisted office, an unreadable
-- row or a malformed row all mean OFF (fail closed): the envelope turns a model's mistake into a failed turn, so doubt
-- must not enable it.
insert into public.system_config (key, value, description)
values (
  'answers.envelope_offices',
  '["205669cc-c270-4f11-ad63-b7ac4f994340"]'::jsonb,
  'Offices whose answering turns ask the model to put its reply inside answer tags (#412). Sample only until the fallback models have been measured.'
)
on conflict (key) do nothing;

create or replace function app.answer_envelope_on(p_office uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select coalesce(
    (select case when jsonb_typeof(c.value) = 'array' then c.value ? p_office::text else false end
       from public.system_config c where c.key = 'answers.envelope_offices'),
    false)
$f$;

revoke all on function app.answer_envelope_on(uuid) from public, anon, authenticated, service_role;
