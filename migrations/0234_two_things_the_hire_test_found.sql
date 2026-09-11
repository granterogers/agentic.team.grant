-- Two bugs in 0233, both found by running it against the real database rather
-- than by reading it back.
--
-- ## 1. A second Claire
--
-- The duplicate check was `exists (select 1 from staff where slug = v_slug)`.
-- Claire's slug is `chief-of-staff`. So hiring someone called "Claire" derived
-- the slug `claire`, found no collision, and tried to insert a SECOND person
-- named Claire onto a roster where every message Grant receives comes from the
-- first one.
--
-- This is the trap that is already in CLAUDE.md, one table over: *a project's
-- slug is derived from its NAME, not from p_ref* -- and a teardown keyed on the
-- wrong one matched nothing and left six real projects in Grant's list. Same
-- shape here. The key you derive is not the key you must check.
--
-- Both are checked now, and the messages are different, because they are
-- different problems: one is "that person is already here" and the other is
-- "that name collapses onto someone else's handle", which is confusing enough
-- to deserve saying out loud.
--
-- ## 2. Two NOT NULL columns nobody read
--
-- `responsibilities` and `communication_style` are both NOT NULL with no
-- default. 0233 passed null for the first and omitted the second, so every
-- valid hire failed at the insert.
--
-- Exactly the failure that took four attempts on `documents` (#9): inventing
-- constraints instead of reading them. The rule earned there is in CLAUDE.md
-- and says read all the rows of the constraint list in ONE query before
-- writing the first insert. I did not, and it cost the same debugging round
-- again. So the defaults here are honest sentences rather than empty strings,
-- because a NOT NULL satisfied with '' is a column that is technically full
-- and actually empty.

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
  v_slug text;
  v      jsonb;
begin
  if coalesce(btrim(p_name), '') = '' then
    return jsonb_build_object('error', 'a person needs a name');
  end if;
  if coalesce(btrim(p_title), '') = '' then
    return jsonb_build_object('error', 'say what they are here to do');
  end if;
  if coalesce(btrim(p_justification), '') = '' then
    return jsonb_build_object('error', 'say why they are needed — a hire with no reason is how a team grows without anyone deciding to grow it');
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

  v_slug := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_slug = '' then
    return jsonb_build_object('error', 'that name does not make a usable slug');
  end if;

  -- The name, first. This is the check that missed Claire.
  if exists (select 1 from public.staff where lower(btrim(name)) = lower(btrim(p_name))) then
    return jsonb_build_object('error', format('%s is already on the roster', btrim(p_name)));
  end if;
  -- And the slug, which can collide even when the names differ: "Tom R" and
  -- "Tom-R" both become tom-r.
  if exists (select 1 from public.staff where slug = v_slug) then
    return jsonb_build_object('error', format('that name collapses onto the handle %L, which someone already has — try a fuller name', v_slug));
  end if;

  insert into public.staff (
    slug, name, title, permanent, active, justification, expires_at,
    responsibilities, communication_style
  )
  values (
    v_slug, btrim(p_name), btrim(p_title), false, true, btrim(p_justification), p_expires_at,
    -- NOT NULL, both of them, with no default. An honest sentence rather than
    -- '' — a NOT NULL satisfied with an empty string is a column that is
    -- technically full and actually empty, and these two are read into the
    -- prompt this person works from.
    coalesce(nullif(btrim(coalesce(p_remit, '')), ''), btrim(p_title)),
    'Brought in for a piece of work. Says what they found and what they could not, and stops there.'
  )
  returning jsonb_build_object(
    'slug', slug, 'name', name, 'title', title,
    'expires_at', expires_at, 'permanent', permanent
  ) into v;

  return v;
end;
$$;
