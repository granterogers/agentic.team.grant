begin;

-- ---------------------------------------------------------------------------
-- 0359 - the two Slack values, in either order, however they were copied (#210)
--
-- 0356 refused Grant's bot token. The token was correct - it began `xoxb-`, as
-- the check requires - so the refusal was the check's fault, not his, and
-- three attempts produced the same message with nothing to distinguish them.
--
-- Rather than guess which of the plausible causes it was (pasted into the
-- wrong box, a password manager filling a masked field he did not type, an
-- invisible character carried out of a browser copy), this removes the whole
-- class:
--
--   * the two values are sorted BY SHAPE, not by which box they came from
--   * every space, tab, newline and zero-width character is stripped first
--   * `xoxb-` is matched case-insensitively
--
-- A form that cannot be filled in wrongly is better than a form with a good
-- error message, and the ordering carried no information anyway - the function
-- can tell a token from a hex secret without being told.
--
-- ## What the refusal may say
--
-- When neither value is a bot token it names the CLASS it recognised - "an
-- app-level token", "a configuration token" - and never any characters from
-- the value. A prefix is public knowledge; the thing after it is not, and
-- `connection_health.detail` is rendered on a page.
-- ---------------------------------------------------------------------------

create or replace function app.hq_set_slack_credentials(
  p_bot_token      text,
  p_signing_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_a    text;
  v_b    text;
  v_bot  text;
  v_sig  text;
  v_ref_bot uuid;
  v_ref_sig uuid;
  v_app  text;
  v_seen text;
begin
  /*
    Everything that is not part of the credential, removed.

    A value copied out of a browser can carry a trailing newline, a
    non-breaking space, or a zero-width character from the surrounding markup.
    None of them are visible in a password field and all of them break a
    prefix match.
  */
  v_a := regexp_replace(coalesce(p_bot_token, ''), '[\s ​-‏﻿]', '', 'g');
  v_b := regexp_replace(coalesce(p_signing_secret, ''), '[\s ​-‏﻿]', '', 'g');

  if v_a = '' or v_b = '' then
    return jsonb_build_object('error',
      'both the bot token and the signing secret are needed - reinstalling gives you both');
  end if;

  -- Sorted by shape. Whichever box they arrived in.
  if v_a ~* '^xoxb-' then
    v_bot := v_a; v_sig := v_b;
  elsif v_b ~* '^xoxb-' then
    v_bot := v_b; v_sig := v_a;
  else
    /*
      Neither is a bot token. Name the CLASS, never the characters.

      Slack's prefixes are public; what follows them is the credential. This
      says which known kind of thing it recognised so the mistake is
      actionable, and nothing more.
    */
    v_seen := case
      when v_a ~* '^xapp-' or v_b ~* '^xapp-' then 'an app-level token (xapp-)'
      when v_a ~* '^xoxe' or v_b ~* '^xoxe' then 'a configuration token (xoxe-)'
      when v_a ~* '^xoxp-' or v_b ~* '^xoxp-' then 'a user token (xoxp-)'
      when v_a ~ '^[0-9a-f]{32}$' and v_b ~ '^[0-9a-f]{32}$' then 'two signing secrets'
      else 'neither of them' end;
    return jsonb_build_object('error',
      'no bot token among those - ' || v_seen || '. The one you want starts xoxb- and is on '
      || 'the Install App page, under Bot User OAuth Token.');
  end if;

  if v_sig !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('error',
      'the other value is not a signing secret - it is 32 characters of 0-9 and a-f, on '
      || 'Basic Information under App Credentials.');
  end if;

  select slack_app_id into v_app from public.slack_app_credentials limit 1;
  if v_app is null then
    return jsonb_build_object('error', 'there is no Slack app row to attach these to');
  end if;

  perform app.store_secret('slack.bot_token', v_bot,
    'Bot user OAuth token for the AI Team HQ app, entered on the web front end.');
  perform app.store_secret('slack.signing_secret', v_sig,
    'Slack request signing secret, entered on the web front end.');

  select id into v_ref_bot from vault.secrets where name = 'slack.bot_token';
  select id into v_ref_sig from vault.secrets where name = 'slack.signing_secret';

  update public.slack_app_credentials
     set bot_token_ref = v_ref_bot,
         signing_secret_ref = v_ref_sig,
         enabled = true,
         disabled_reason = null,
         revoked_at = null,
         installed_at = app.now_utc(),
         updated_at = app.now_utc()
   where slack_app_id = v_app;

  update public.connection_health
     set state = 'ok',
         detail = 'reconnected from the web front end',
         action = 'Setting up -> Slack on the web front end',
         checked_at = app.now_utc()
   where service = 'Slack';

  return jsonb_build_object('stored', true, 'app', v_app);
end;
$$;

comment on function app.hq_set_slack_credentials(text, text) is
  'Put Slack back from the page (#210). Takes the two values in EITHER order '
  'and sorts them by shape, because the ordering carried no information and '
  'getting it wrong cost three attempts. Refusals name the class of thing '
  'recognised, never any characters from the value.';

commit;
