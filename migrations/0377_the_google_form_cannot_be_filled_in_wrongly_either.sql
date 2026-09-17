begin;

-- ---------------------------------------------------------------------------
-- 0377 - the Google credential form gets 0359's treatment, and no setting may
-- hold a credential (§35)
--
-- Found by the §35 pass: test every credential form with leading and trailing
-- whitespace, a newline, zero-width characters, the wrong case, a malformed
-- shape, a valid-looking shape, the WRONG FIELD and the OPPOSITE CREDENTIAL
-- TYPE.
--
-- ## What the wrong field costs here
--
-- The Google form has two adjacent boxes, Client ID and Client secret. The
-- secret goes to the vault through `hq_set_google_secret`; the client ID is
-- ordinary configuration and goes to `system_config` through `hq_set_setting`,
-- where the page reads it back and renders it:
--
--   <input data-g-id value="{{ the stored client id }}">
--
-- So pasting the client SECRET into the Client ID box stores a live credential
-- in a plaintext configuration table and then prints it on the Settings page -
-- in the DOM, in every screenshot the QA harness takes, and in anything Grant
-- shares. CLAUDE.md is absolute about this: never expose secret values in
-- logs, commits, reports, test output or chat.
--
-- 0359 already removed this whole class for Slack, and said why: "a form that
-- cannot be filled in wrongly is better than a form with a good error message,
-- and the ordering carried no information anyway". The same is true here - a
-- client ID ends `.apps.googleusercontent.com` and a secret starts `GOCSPX-`,
-- so the function can tell them apart without being told which box they came
-- from.
--
-- ## Three changes
--
--   1. `app.hq_set_google_credentials` takes both values in EITHER order,
--      sorts them by shape, and strips every space, tab, newline and
--      zero-width character first. One call, so the two halves cannot
--      disagree about which value is which.
--   2. `app.hq_set_google_secret` gains the same normalisation and matches
--      `GOCSPX-` case-insensitively. It stays, because it is the narrow door
--      and something may still call it.
--   3. `app.hq_set_setting` refuses ANY value shaped like a known credential,
--      for every key on its allow-list. That is the class rather than the
--      instance: `google.client_id` is the field that would have carried a
--      secret today, and the next plaintext setting somebody adds beside a
--      password box is the one nobody will remember to check.
--
-- Every refusal names the CLASS it recognised and never any characters from
-- the value, exactly as 0359 does. A prefix is public knowledge; what follows
-- it is the credential.
-- ---------------------------------------------------------------------------

/*
  Everything that is not part of the credential.

  A value copied out of a browser can carry a trailing newline, a non-breaking
  space, or a zero-width character from the surrounding markup. None of them
  are visible in a password field, all of them break a prefix match, and a
  valid credential refused for an invisible reason is the §35 defect named in
  so many words.

  The character class is 0359's, kept identical on purpose so the two forms
  cannot drift: whitespace, the non-breaking space, and the zero-width run.
*/
create or replace function app.credential_clean(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$ select regexp_replace(coalesce(p_value, ''), '[\s ​-‏﻿]', '', 'g') $$;

comment on function app.credential_clean(text) is
  'Strip every space, tab, newline, non-breaking space and zero-width '
  'character from a pasted credential (0359, 0377). One definition, so the '
  'Slack form and the Google form cannot disagree about what is invisible.';

/*
  Which known credential a value looks like, or null if it looks like none.

  Names a CLASS. Never characters. Used both to refuse a credential in a
  configuration field and to say something actionable about the refusal.
*/
create or replace function app.credential_shape(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when app.credential_clean(p_value) ~* '^GOCSPX-'      then 'a Google client secret (GOCSPX-)'
    when app.credential_clean(p_value) ~* '^ya29\.'       then 'a Google access token (ya29.)'
    when app.credential_clean(p_value) ~  '^1//'          then 'a Google refresh token'
    when app.credential_clean(p_value) ~* '^xoxb-'        then 'a Slack bot token (xoxb-)'
    when app.credential_clean(p_value) ~* '^xoxp-'        then 'a Slack user token (xoxp-)'
    when app.credential_clean(p_value) ~* '^xapp-'        then 'a Slack app-level token (xapp-)'
    when app.credential_clean(p_value) ~* '^xoxe'         then 'a Slack configuration token (xoxe-)'
    when app.credential_clean(p_value) ~  '^gh[pousr]_'   then 'a GitHub token'
    when app.credential_clean(p_value) ~  '^github_pat_'  then 'a GitHub personal access token'
    when app.credential_clean(p_value) ~  '^(secret_|ntn_)' then 'a Notion integration token'
    when app.credential_clean(p_value) ~  '^sk-'          then 'an API secret key (sk-)'
    when app.credential_clean(p_value) ~  '^AIza'         then 'a Google API key (AIza)'
    when app.credential_clean(p_value) ~  '^eyJ[A-Za-z0-9_-]{10,}\.' then 'a signed token (a JWT)'
    else null
  end
$$;

comment on function app.credential_shape(text) is
  'The CLASS of credential a pasted value looks like, or null. Returns a '
  'description a person can act on and never any characters from the value '
  '(0359, 0377). A prefix is public; what follows it is the credential.';

-- 1. Both Google values, in either order, however they were copied.
create or replace function app.hq_set_google_credentials(
  p_client_id text,
  p_secret    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_a   text := app.credential_clean(p_client_id);
  v_b   text := app.credential_clean(p_secret);
  v_id  text;
  v_sec text;
  v_seen text;
begin
  if v_a = '' and v_b = '' then
    return jsonb_build_object('error', 'there is nothing to save');
  end if;

  /*
    Sorted by shape, whichever box they arrived in.

    Only ONE of the two is ever required: the client ID may be saved on its own
    (it is not a secret and the page shows it), and the secret may be saved on
    its own (the ID is already stored from last time).
  */
  if v_a ~* '^GOCSPX-' then
    v_sec := v_a; v_id := v_b;
  elsif v_b ~* '^GOCSPX-' then
    v_sec := v_b; v_id := v_a;
  elsif v_b = '' then
    v_id := v_a;
  elsif v_a = '' then
    /*
      Something in the secret box that is not a secret. Refusing is right -
      storing it would put an unknown value in the vault under a name that
      says client secret - and the message has to say what it recognised.
    */
    v_seen := app.credential_shape(v_b);
    return jsonb_build_object('error',
      case when v_seen is null
        then 'that does not look like a Google client secret - they start GOCSPX-, on the '
             || 'Credentials page of the Google Cloud console'
        else 'that looks like ' || v_seen || ', not a Google client secret - they start GOCSPX-' end);
  else
    v_id := v_a; v_sec := v_b;
    if v_sec !~* '^GOCSPX-' then
      v_seen := app.credential_shape(v_sec);
      return jsonb_build_object('error',
        case when v_seen is null
          then 'neither of those is a Google client secret - the one you want starts GOCSPX-'
          else 'that looks like ' || v_seen || ', not a Google client secret - they start GOCSPX-' end);
    end if;
  end if;

  /*
    And the client ID may not be a credential of any kind.

    The box is plain text and the page renders what is stored in it, so this is
    the one refusal here that protects a secret rather than a configuration.
  */
  if v_id is not null and v_id <> '' then
    v_seen := app.credential_shape(v_id);
    if v_seen is not null then
      return jsonb_build_object('error',
        'the client ID box has ' || v_seen || ' in it. Nothing was saved. A client ID is not '
        || 'a secret and this page shows it, so a credential must not go there.');
    end if;
    perform app.hq_set_setting('google.client_id', v_id);
  end if;

  if v_sec is not null and v_sec <> '' then
    perform app.store_secret('google.client_secret', v_sec,
      'Google Cloud OAuth client secret, entered on the web front end.');
  end if;

  return jsonb_build_object(
    'stored', true,
    'client_id', (v_id is not null and v_id <> ''),
    'secret', (v_sec is not null and v_sec <> ''));
end;
$$;

comment on function app.hq_set_google_credentials(text, text) is
  'Save the Google client ID and client secret together, in EITHER order, '
  'sorted by shape (§35, after 0359). Strips invisible characters first, so a '
  'valid credential is never refused for a reason nobody can see, and refuses '
  'a credential in the client ID box, which the page renders in plain text.';

-- 2. The narrow door keeps working, and stops refusing valid credentials.
create or replace function app.hq_set_google_secret(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_secret text := app.credential_clean(p_secret);
  v_seen   text;
begin
  if v_secret = '' then
    return jsonb_build_object('error', 'the secret is empty');
  end if;
  -- Case-insensitively, and after the invisible characters are gone. Both
  -- were ways a correct credential got refused (0359 cost three attempts on
  -- the Slack form for exactly this).
  if v_secret !~* '^GOCSPX-' then
    v_seen := app.credential_shape(v_secret);
    return jsonb_build_object('error',
      case when v_seen is null
        then 'that does not look like a Google client secret - they start GOCSPX-'
        else 'that looks like ' || v_seen || ', not a Google client secret - they start GOCSPX-' end);
  end if;
  perform app.store_secret('google.client_secret', v_secret,
    'Google Cloud OAuth client secret, entered on the web front end.');
  return jsonb_build_object('stored', true);
end;
$$;

-- 3. No setting may hold a credential, whatever the key.
do $$
declare
  v_def text;
  v_guard text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_set_setting(text,text)'::regprocedure;

  if position('is not a setting this page may change' in v_def) = 0 then
    raise exception 'the guard did not look as expected - read it before replacing';
  end if;
  if position('credential_shape' in v_def) > 0 then
    raise exception 'the credential guard is already there - read it before replacing';
  end if;

  /*
    Inserted straight after the allow-list refusal, so an unknown key is still
    the first thing rejected and the shape check only ever sees a key the page
    is allowed to write.

    `system_config` is plaintext and several of its keys are rendered on the
    Settings page. There is no key on that list a credential belongs in, so
    this needs no exceptions - which is what makes it safe to apply to all of
    them rather than to the one that would have carried a secret today.

    Anchored on the refusal's own sentence rather than on the line that follows
    it: the body has grown four times since 0094 and the statement after that
    guard is not what it was.
  */
  v_guard :=
    '  end if;' || E'\n' || E'\n' ||
    '  if app.credential_shape(p_value) is not null then' || E'\n' ||
    '    return jsonb_build_object(''error'',' || E'\n' ||
    '      ''that value looks like '' || app.credential_shape(p_value) ||' || E'\n' ||
    '      ''. Nothing was saved. Settings are stored in plain text and shown on the page, ''' || E'\n' ||
    '      ''so a credential cannot be kept in one - it goes to the vault through its own box.'');' || E'\n' ||
    '  end if;';

  v_def := replace(v_def,
    'is not a setting this page may change'', p_key));' || E'\n' || '  end if;',
    'is not a setting this page may change'', p_key));' || E'\n' || v_guard);

  if position('credential_shape' in v_def) = 0 then
    raise exception 'the allow-list refusal this guard follows was not found';
  end if;
  execute v_def;
end
$$;

create or replace function public.hq_set_google_credentials(p_client_id text, p_secret text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_set_google_credentials(p_client_id, p_secret) $$;

revoke all on function public.hq_set_google_credentials(text, text) from public;
grant execute on function public.hq_set_google_credentials(text, text) to service_role;

commit;
