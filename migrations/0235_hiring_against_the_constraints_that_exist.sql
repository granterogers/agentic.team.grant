-- Hiring, written against the constraints that are actually there.
--
-- 0233 and 0234 each fixed one constraint and then hit the next, which is the
-- failure mode CLAUDE.md names after it cost four attempts on `documents`:
-- *read all the rows of pg_constraint in ONE query before writing the first
-- insert.* I did not, twice, and it cost the same round twice more.
--
-- So, everything on public.staff, read in one go and handled here:
--
--   staff_name_present                 length(trim(name)) > 0
--   staff_title_present                length(trim(title)) > 0
--   staff_slug_format                  ^[a-z0-9]+(-[a-z0-9]+)*$
--   staff_slug_key                     unique
--   staff_responsibilities_substantive length(trim(responsibilities)) >= 20
--   staff_temporary_expires            permanent = (expires_at is null)
--   staff_temporary_is_justified       permanent or length(trim(justification)) >= 30
--   staff_prompt_version_positive      prompt_version >= 1
--   trigger enforce_specialist_cap     §9, a hard cap on live temporaries
--   trigger enforce_permanence
--   trigger staff_touch_updated_at
--
-- Three of those needed real work rather than a default.
--
-- ## Thirty characters of justification, said before it is refused
--
-- `staff_temporary_is_justified` wants 30. The RPC only refused an EMPTY
-- reason, so "because" reached the database and came back as a constraint
-- name. The number is now in the message, because "say more" without saying
-- how much more is a form that fails twice.
--
-- ## Twenty characters of remit, and not padded to reach them
--
-- `responsibilities` is NOT NULL with no default and wants 20 characters. It
-- is read into the prompt this person actually works from, so satisfying it
-- with '' or with a repeated title is a column that is technically full and
-- functionally empty. The fallback is a real sentence built from the title.
--
-- ## The specialist cap speaks for itself
--
-- `enforce_specialist_cap` raises a good, specific exception - how many slots
-- are in use, out of how many, and why the cap exists. Uncaught, the page
-- would show a 500 and Grant would learn nothing. Caught, its own words reach
-- him. The handler returns SQLERRM rather than a rewrite of it, so if the cap
-- changes its reasoning the interface says the new reason with no change here.

create or replace function app.hq_staff_hire(
  p_name          text,
  p_title         text,
  p_justification text,
  p_expires_at    timestamptz,
  p_remit         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_slug   text;
  v_name   text := btrim(coalesce(p_name, ''));
  v_title  text := btrim(coalesce(p_title, ''));
  v_why    text := btrim(coalesce(p_justification, ''));
  v_remit  text := btrim(coalesce(p_remit, ''));
  v        jsonb;
begin
  if v_name = '' then
    return jsonb_build_object('error', 'a person needs a name');
  end if;
  if v_title = '' then
    return jsonb_build_object('error', 'say what they are here to do');
  end if;
  if v_why = '' then
    return jsonb_build_object('error', 'say why they are needed — a hire with no reason is how a team grows without anyone deciding to grow it');
  end if;
  -- The number, not just "longer". staff_temporary_is_justified wants 30.
  if length(v_why) < 30 then
    return jsonb_build_object('error', format(
      'say a little more about why — %s characters so far, and a temporary hire needs at least 30',
      length(v_why)));
  end if;
  if p_expires_at is null then
    return jsonb_build_object('error', 'say when they go — someone brought in for a piece of work needs an end');
  end if;
  if p_expires_at <= now() then
    return jsonb_build_object('error', 'that expiry is in the past');
  end if;
  if p_expires_at > now() + interval '180 days' then
    return jsonb_build_object('error', 'six months is the longest a temporary agent can be booked for — make them permanent deliberately instead');
  end if;

  v_slug := btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-');
  if v_slug = '' then
    return jsonb_build_object('error', 'that name does not make a usable slug');
  end if;

  -- The name first: this is the check that let a second Claire through, since
  -- her slug is `chief-of-staff` and nothing derived from her name matches it.
  if exists (select 1 from public.staff where lower(btrim(name)) = lower(v_name)) then
    return jsonb_build_object('error', format('%s is already on the roster', v_name));
  end if;
  if exists (select 1 from public.staff where slug = v_slug) then
    return jsonb_build_object('error', format(
      'that name collapses onto the handle %L, which someone already has — try a fuller name', v_slug));
  end if;

  -- A real sentence, not padding to clear a length check.
  if length(v_remit) < 20 then
    v_remit := format('Brought in to work on %s, and nothing else.', v_title);
  end if;

  begin
    insert into public.staff (
      slug, name, title, permanent, active, justification, expires_at,
      responsibilities, communication_style
    )
    values (
      v_slug, v_name, v_title, false, true, v_why, p_expires_at,
      v_remit,
      'Brought in for a piece of work. Says what they found and what they could not, and stops there.'
    )
    returning jsonb_build_object(
      'slug', slug, 'name', name, 'title', title,
      'expires_at', expires_at, 'permanent', permanent
    ) into v;
  exception when check_violation then
    -- The specialist cap, in its own words. See the note above.
    return jsonb_build_object('error', SQLERRM);
  end;

  return v;
end;
$$;
