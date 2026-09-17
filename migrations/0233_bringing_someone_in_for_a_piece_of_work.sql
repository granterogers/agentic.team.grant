-- Bringing someone in, which is the half of the roster that was never built.
--
-- Grant: *"one tab for the bot management where you add and remove bots
-- dynamically, that's automatically done."*
--
-- Remove existed. Add did not. `hq_staff_retire` has been there since 0079,
-- and the studio's Settings > Team carried a "+ Bring someone in" button with
-- `data-hire` on it and NOTHING anywhere that looked that attribute up. It was
-- the last dead control in the product -- found by cross-referencing every
-- data-* attribute in the rendered DOM against every attribute any source file
-- queries, rather than by pressing things.
--
-- The columns for this have existed since the roster was designed:
-- `staff.permanent`, `staff.expires_at`, `staff.justification` and
-- `staff.requested_for_job` are there precisely so someone can be brought in
-- for a piece of work and go when it is done. A comment in app.js has said
-- "the database already supports this" for weeks. It supported the SHAPE; it
-- had no way in.
--
-- ## Temporary by default, and that is the point
--
-- A hire with no expiry is how an office quietly grows: eight becomes eleven,
-- nobody remembers why three of them are there, and every prompt is a little
-- more expensive forever. So `p_expires_at` and `p_justification` are both
-- REQUIRED. If you cannot say why someone is here and when they go, you are
-- not hiring, you are accumulating.
--
-- `permanent` is deliberately not settable from here. Making someone permanent
-- is a different decision from bringing them in, and it should not be
-- available by accident on the same press.
--
-- ## The slug is derived, and it is checked
--
-- Same trap as projects, where the slug comes from the NAME and not from the
-- connector reference, and a teardown keyed on the wrong one left six real
-- projects in Grant's list. Here the caller passes a name and the slug is
-- derived from it, so there is one source of truth and no second thing to get
-- wrong. A collision is refused rather than silently updating whoever already
-- holds it, because `insert ... on conflict do update` here would be a hire
-- that quietly overwrites a colleague.

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
  -- Not a formality. An office that cannot say why someone was hired cannot
  -- later decide whether to keep them.
  if coalesce(btrim(p_justification), '') = '' then
    return jsonb_build_object('error', 'say why they are needed — a hire with no reason is how a team grows without anyone deciding to grow it');
  end if;
  if p_expires_at is null then
    return jsonb_build_object('error', 'say when they go — someone brought in for a piece of work needs an end');
  end if;
  if p_expires_at <= now() then
    return jsonb_build_object('error', 'that expiry is in the past');
  end if;
  -- A year is not "for a piece of work". The cap is a guard against a typo in
  -- a date field becoming a permanent colleague.
  if p_expires_at > now() + interval '180 days' then
    return jsonb_build_object('error', 'six months is the longest a temporary agent can be booked for — make them permanent deliberately instead');
  end if;

  v_slug := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then
    return jsonb_build_object('error', 'that name does not make a usable slug');
  end if;

  if exists (select 1 from public.staff where slug = v_slug) then
    return jsonb_build_object('error', format('%s is already on the roster', p_name));
  end if;

  insert into public.staff (slug, name, title, permanent, active, justification,
                            expires_at, responsibilities)
  values (v_slug, btrim(p_name), btrim(p_title), false, true, btrim(p_justification),
          p_expires_at, nullif(btrim(coalesce(p_remit, '')), ''))
  returning jsonb_build_object(
    'slug', slug, 'name', name, 'title', title,
    'expires_at', expires_at, 'permanent', permanent
  ) into v;

  return v;
end;
$$;

-- PostgREST only exposes `public`, so every app.* RPC needs a wrapper. The
-- default on p_remit is repeated here on purpose: the wrapper is the half that
-- silently drops a new parameter, and this repository has been caught by that.
create or replace function public.hq_staff_hire(
  p_name          text,
  p_title         text,
  p_justification text,
  p_expires_at    timestamptz,
  p_remit         text default null
)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_staff_hire(p_name, p_title, p_justification, p_expires_at, p_remit) $$;
