-- 0273 — a shape with no facts says so
--
-- 0272's validator handles "facts with no shape" by name and handles the
-- opposite by accident: a shape with null facts falls through to
--
--     facts must be an object
--
-- which is true and useless. The caller did not send a badly-typed object; they
-- sent a claim with nothing behind it, which is a different mistake with a
-- different fix. The column constraint `outputs_shape_and_facts_together` says
-- the right thing and never gets to speak, because a BEFORE trigger runs first.
--
-- Found by `verify:shapes`, which asserted the pairing and got the wrong
-- sentence — the check being specific about the WORDS is what turned an
-- accepted behaviour into a visible one. Every other refusal in this validator
-- names the key and what it should have been; this one should too.

begin;

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
  -- The other half of the pair, said in its own words rather than falling
  -- through to a complaint about the type of nothing.
  if p_facts is null then
    return format('a %s output was claimed with no facts behind it', p_shape);
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

commit;
