-- 0131 — A bot can change hands
--
-- Grant's goal was never "call bots.createBot". It was: *"I'd like to be able
-- to dynamically add and remove staff."* Creating a bot per hire is one way to
-- get there and it is not the only one, and it turns out to be the slower one.
--
-- `bots.createBot` needs a manager bot carrying `bot_can_manage_bots`, which
-- Telegram exposes only through BotFather's Mini App — not the Bot Settings
-- menu, which is why it was not in the menu Grant screenshotted. That path
-- still works and 0124 keeps it. But it needs a BotFather visit before the
-- first bot, and so does the alternative, so the honest comparison is:
--
--   create-on-demand : one Mini App toggle, then bots appear as needed
--   assign-a-spare   : make N bots in BotFather once, then assignment is free
--
-- Eight bots already exist. Reassigning one is instant, reversible, costs no
-- Telegram write and cannot fail — which makes it the better primitive
-- regardless of which way the bots were made. This migration is that primitive.
--
-- ## Why unassign rather than delete
--
-- A bot cannot be deleted through any API, and a username is claimed for good
-- once used. So "remove a staff member" must not consume a bot: it hands the
-- bot back to the pool, where the next hire picks it up. That is also why
-- `staff_slug` is nullable and why null-with-no-pager-flag already means spare.

begin;

/**
 * Give a bot to someone, or take it back.
 *
 * Null `p_staff_slug` returns it to the pool. Refuses to touch the pager,
 * which is the one bot the whole notification path assumes exists and is
 * unowned — 0124 made it the manager for the same reason.
 */
create or replace function app.hq_bot_assign(p_username text, p_staff_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_pager boolean;
  v_current  text;
  v jsonb;
begin
  select is_pager, staff_slug into v_is_pager, v_current
    from public.telegram_bots where username = p_username and enabled;
  if not found then
    return jsonb_build_object('error', format('no bot called %L', p_username));
  end if;
  if v_is_pager then
    return jsonb_build_object(
      'error', 'the pager is not assignable — every notification path assumes it exists and belongs to nobody'
    );
  end if;

  if p_staff_slug is not null then
    if not exists (select 1 from public.staff where slug = p_staff_slug and active) then
      return jsonb_build_object('error', format('no active staff member called %L', p_staff_slug));
    end if;
    -- One bot each. Two people on one bot would make "who is this message
    -- from" unanswerable, and 0097 already paid for a version of that
    -- confusion.
    if exists (
      select 1 from public.telegram_bots
       where staff_slug = p_staff_slug and enabled and username <> p_username
    ) then
      return jsonb_build_object(
        'error', format('%s already has a bot — free it first', p_staff_slug)
      );
    end if;
  end if;

  update public.telegram_bots
     set staff_slug = p_staff_slug, updated_at = app.now_utc()
   where username = p_username
  returning jsonb_build_object(
    'username', username,
    'staff_slug', staff_slug,
    'was', v_current
  ) into v;
  return v;
end;
$$;

revoke all on function app.hq_bot_assign(text, text) from public;
grant execute on function app.hq_bot_assign(text, text) to service_role;

create or replace function public.hq_bot_assign(p_username text, p_staff_slug text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_bot_assign(p_username, p_staff_slug) $$;

revoke all on function public.hq_bot_assign(text, text) from public;
grant execute on function public.hq_bot_assign(text, text) to service_role;

/**
 * The bots, as the team page needs them.
 *
 * Never `token_ref`: 0124 says that column must not appear in an hq_*
 * projection, and the way to keep that true is to list columns explicitly
 * rather than select the row (0045's lesson).
 */
create or replace function app.hq_bots()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'owned', (select count(*)::int from public.telegram_bots where enabled),
    'limit', coalesce((select (value #>> '{}')::int from public.system_config
                        where key = 'telegram.bot_limit'), 20),
    'bots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'username', b.username,
        'staff_slug', b.staff_slug,
        'staff_name', s.name,
        'is_pager', b.is_pager,
        'origin', b.origin,
        'spare', b.staff_slug is null and not b.is_pager
      ) order by b.is_pager desc, s.name nulls last, b.username)
      from public.telegram_bots b
      left join public.staff s on s.slug = b.staff_slug
      where b.enabled), '[]'::jsonb)
  )
$$;

grant execute on function app.hq_bots() to ai_team_app, service_role;

create or replace function public.hq_bots()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_bots() $$;

revoke all on function public.hq_bots() from public;
grant execute on function public.hq_bots() to service_role;

commit;
