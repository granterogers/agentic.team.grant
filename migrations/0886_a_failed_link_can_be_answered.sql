-- 0885's app.link_redeem returned the chief bot's token only when the link worked, so a person whose link had expired
-- tapped Start and heard nothing, which reads as the product being broken. The webhook now answers every well-formed
-- "/start link_<token>" with one sentence, and a failure must therefore carry the token too.
--
-- The answer to a failure is deliberately the SAME sentence for every reason (unknown, used, expired, revoked, taken):
-- it says what to do next and tells a guesser nothing. The reasons stay in the return value for the check that drives it.
--
-- create or replace on a function whose argument list is unchanged replaces it; 0885 is two minutes old and
-- is otherwise untouched.
create or replace function app.link_redeem(p_channel text, p_token text, p_actor text, p_conversation text, p_bot_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_row public.channel_link_challenges;
  v_hash text;
  v_existing uuid;
  v_subject text;
  v_bot text;
  v_refusal text;
begin
  -- The chief bot's token, for the one message back to the person who just wrote to it (as voice_refusal does).
  v_bot := (select app.resolve_secret(t.token_ref) from public.telegram_bots t
             where t.bot_id = p_bot_id and t.enabled and t.is_pager and t.token_ref is not null);

  -- Telegram: a private chat has the same id as the user. A group, or a mismatch, is not the person asking.
  if p_channel is distinct from 'telegram'
     or p_actor is null or p_actor !~ '^[0-9]{1,20}$'
     or p_conversation is distinct from p_actor
     or p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'token', case when p_conversation = p_actor then v_bot end);
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex');

  select * into v_row from public.channel_link_challenges c where c.token_sha256 = v_hash for update;
  if not found or v_row.used_at is not null or v_row.revoked_at is not null or v_row.expires_at <= app.now_utc()
     or v_row.channel <> p_channel
     or v_row.office_id = app.operator_office()
     or not exists (select 1 from public.offices o where o.office_id = v_row.office_id and o.state = 'active') then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'token', v_bot);
  end if;

  select i.office_id into v_existing from public.subject_identities i
   where i.origin_channel = p_channel and i.actor = p_actor;
  if v_existing is not null and v_existing <> v_row.office_id then
    -- A Telegram user is one person in one office. Nothing is changed and the token stays unspent.
    v_refusal := 'taken';
  elsif v_existing is null and exists (select 1 from public.subject_identities i
                                        where i.office_id = v_row.office_id and i.origin_channel = p_channel and i.kind = 'person') then
    v_refusal := 'office_already_linked';
  end if;
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal, 'token', v_bot);
  end if;

  if v_existing is null then
    v_subject := app.office_actor(v_row.office_id);
    insert into public.subject_identities (office_id, subject, origin_channel, actor, note, kind)
    values (v_row.office_id, v_subject, p_channel, p_actor, 'connected by the person from Team HQ', 'person');
  end if;
  update public.channel_link_challenges c
     set used_at = app.now_utc(), used_by_actor = p_actor
   where c.challenge_id = v_row.challenge_id;

  return jsonb_build_object('ok', true, 'token', v_bot);
end
$f$;
