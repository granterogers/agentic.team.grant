-- 0038 — the character ledger for text-to-speech
--
-- §11: *"Track local usage for every provider even where provider-side metrics
-- exist."* Chirp 3: HD is free to a million characters a month and priced after
-- that, so the free tier is a **budget**, and a budget nobody counts against is
-- a bill arriving in the post.
--
-- There is no live counter to read. Google's quota page is not an API, and the
-- synthesis response does not carry a running total — so the only figure this
-- system can have is the one it keeps itself. That makes this table the
-- authority, and makes its honesty the whole point: a character synthesised and
-- not recorded is a character spent invisibly.
--
-- Written BEFORE synthesis, not after. A request that succeeds and then fails
-- to record has spent characters we do not know about; a request recorded and
-- then abandoned has only under-spent. The direction of the error is chosen
-- deliberately, and it is the same choice the Slack delivery claim makes for
-- the same reason.

begin;

create table public.tts_usage (
  usage_id      uuid        primary key default gen_random_uuid(),

  -- 'google.chirp3-hd' today. Named rather than assumed, so a second voice
  -- provider does not silently share one budget.
  provider      text        not null,
  voice         text,

  characters    integer     not null,
  -- The month this counts against, as a date at the first of the month. Kept
  -- as a column rather than derived at read time so the index is usable and
  -- so a caller cannot disagree with the aggregator about where a boundary is.
  billing_month date        not null default date_trunc('month', app.now_utc())::date,

  -- What it was for, so an unexpected month is diagnosable rather than merely
  -- alarming.
  correlation_id uuid,
  purpose       text        not null default 'voice_note',

  -- Set when synthesis is attempted and fails. The characters still count if
  -- the provider processed them, and we cannot always tell — so they are
  -- recorded and flagged rather than quietly dropped.
  failed        boolean     not null default false,
  error_code    text,

  created_at    timestamptz not null default app.now_utc(),

  constraint tts_usage_characters_positive check (characters > 0),
  constraint tts_usage_purpose_known
    check (purpose in ('voice_note', 'briefing', 'probe', 'other'))
);

create index tts_usage_by_month on public.tts_usage (provider, billing_month);

comment on table public.tts_usage is
  'Characters sent to a TTS provider, counted by us because no live counter '
  'exists to read. Written before synthesis: an unrecorded success spends '
  'invisibly, an unused record only under-spends.';

/**
 * Characters used this month, for a provider.
 *
 * Returns a number, never null: "no rows" means zero used, and a null here
 * would make every caller write the same coalesce.
 */
create or replace function app.tts_characters_this_month(p_provider text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(characters), 0)::int
  from public.tts_usage
  where provider = p_provider
    and billing_month = date_trunc('month', app.now_utc())::date;
$$;

/**
 * Reserve characters before synthesising, or refuse.
 *
 * Returns the usage id when the reservation fits, and null when it does not.
 * Null is a normal answer and the caller's correct response is to send text —
 * §12's acceptance for this feature is *"TTS degrades to text rather than
 * incurring cost"*, and a function that raised would make the degradation an
 * error path rather than the ordinary one.
 *
 * The ceiling is a parameter rather than a constant so the caller states its
 * own budget, and so a briefing and a voice note can be given different room
 * without two functions.
 */
create or replace function app.reserve_tts_characters(
  p_provider text,
  p_characters integer,
  p_ceiling integer,
  p_correlation_id uuid default null,
  p_purpose text default 'voice_note',
  p_voice text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
  v_id uuid;
begin
  if p_characters <= 0 then
    return null;
  end if;

  -- Serialise reservations for this provider and month, so two concurrent
  -- callers cannot both see room for the last thousand characters. An advisory
  -- lock rather than a row lock because the thing being protected is a SUM,
  -- and there is no row to lock until after the decision.
  perform pg_advisory_xact_lock(hashtext('tts:' || p_provider));

  v_used := app.tts_characters_this_month(p_provider);
  if v_used + p_characters > p_ceiling then
    return null;
  end if;

  insert into public.tts_usage
    (provider, voice, characters, correlation_id, purpose)
  values
    (p_provider, p_voice, p_characters, p_correlation_id, p_purpose)
  returning usage_id into v_id;

  return v_id;
end;
$$;

/** Mark a reservation as having failed, keeping the characters counted. */
create or replace function app.record_tts_failure(
  p_usage_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tts_usage
     set failed = true, error_code = p_error_code
   where usage_id = p_usage_id;
  return found;
end;
$$;

alter table public.tts_usage enable row level security;
alter table public.tts_usage force  row level security;

-- Read only, like every other ledger here: the count is evidence about money,
-- and an application that can UPDATE it can make a bill disappear.
grant select on public.tts_usage to ai_team_app;
grant execute on function app.tts_characters_this_month(text) to ai_team_app;
grant execute on function app.reserve_tts_characters(text, integer, integer, uuid, text, text) to ai_team_app;
grant execute on function app.record_tts_failure(uuid, text) to ai_team_app;

create policy tts_usage_app_read on public.tts_usage
  for select to ai_team_app using (true);

commit;
