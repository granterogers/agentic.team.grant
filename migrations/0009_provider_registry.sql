-- 0009 — Provider registry and the measured model allow-list
--
-- Master spec §8 requires a machine-readable capability registry carrying, per
-- capability: availability, official/unofficial status, auth state, health,
-- last successful verification, last error, policy state, cost classification
-- and enabled/disabled. §11 requires the free allow-list to be one of the four
-- enforcement layers.
--
-- ADR-0009 changed how that allow-list is built. Pricing is a pre-filter, not
-- the criterion: of 21 zero-priced OpenRouter models, only 5 were callable
-- under our privacy policy. So `usable` here is a MEASURED fact with a
-- timestamp, never a configured one — which is also what §11's "'free' means
-- measured, not assumed" demands.

-- ---------------------------------------------------------------------------
-- Providers
-- ---------------------------------------------------------------------------
create table public.providers (
  provider          text        primary key,
  display_name      text        not null,

  -- §8: official vs unofficial matters. Notebook automation rests on
  -- undocumented private RPCs; OpenRouter is a documented public API. Conflating
  -- them hides the risk that ADR-0003 exists to keep visible.
  api_status        text        not null default 'official',

  -- Lower is tried first. §11's router selects by capability then priority.
  priority          smallint    not null default 100,

  -- §8 kill-switch: every integration independently disableable without
  -- taking the application offline.
  enabled           boolean     not null default true,
  disabled_reason   text,

  -- §11: "Never silently use a paid model." When true, the router refuses any
  -- model this registry has not measured as free.
  free_only         boolean     not null default true,

  base_url          text        not null,
  secret_ref        app.vault_secret_ref,

  notes             text,
  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint providers_name_format   check (provider ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint providers_api_status    check (api_status in ('official', 'unofficial')),
  constraint providers_priority      check (priority between 0 and 1000),
  constraint providers_https_only    check (base_url ~ '^https://'),
  constraint providers_disabled_has_reason check (enabled or disabled_reason is not null)
);

comment on table public.providers is
  'Provider registry (§8). api_status distinguishes documented public APIs from '
  'undocumented private ones, because conflating them hides exactly the risk '
  'ADR-0003 keeps visible.';

comment on column public.providers.free_only is
  '§11: never silently use a paid model. When true the router refuses any model '
  'this registry has not MEASURED as free.';

-- ---------------------------------------------------------------------------
-- Models — availability as a measured, expiring fact
-- ---------------------------------------------------------------------------
create type public.model_status as enum (
  'usable',            -- probed and executed at zero cost
  'unprobed',          -- discovered from pricing, never called
  'data_policy',       -- free only if training on our data is permitted (§11: declined)
  'harness_gated',     -- provider restricts WHO may call it
  'rate_limited',      -- persistent 429
  'provider_error',    -- persistent 5xx
  'paid',              -- priced above zero; never callable under free_only
  'withdrawn'          -- no longer present in provider discovery
);

comment on type public.model_status is
  'Why a model is or is not usable. The non-usable values are the failure '
  'classes ADR-0009 found, each invisible to pricing.';

create table public.provider_models (
  provider              text                not null references public.providers (provider),
  model_id              text                not null,

  status                public.model_status not null default 'unprobed',

  -- Verbatim from provider discovery. Strings, not numbers: OpenRouter reports
  -- "0" for free and "-1" for a dynamically-priced router, and -1 must never be
  -- arithmetic-compared against a budget as though it were cheap.
  pricing_prompt        text,
  pricing_completion    text,

  -- §11's usage provenance. AUTHORITATIVE means the provider told us directly.
  -- A probe result is authoritative about that model at that moment.
  last_probed_at        timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  consecutive_failures  integer             not null default 0,

  -- ADR-0009: one failure does not evict a model. openrouter/free returned 429
  -- then succeeded, so a single probe is authoritative in neither direction.
  first_seen_at         timestamptz         not null default app.now_utc(),
  updated_at            timestamptz         not null default app.now_utc(),

  primary key (provider, model_id),

  constraint provider_models_failures_non_negative
    check (consecutive_failures >= 0),
  constraint provider_models_error_is_brief
    check (last_error is null or length(last_error) <= 500),
  -- A model claimed usable must have been probed. Without this, `usable` could
  -- be set by configuration, which is the exact failure ADR-0009 prevents.
  constraint provider_models_usable_was_probed
    check (status <> 'usable' or last_success_at is not null)
);

comment on table public.provider_models is
  'The measured model allow-list (ADR-0009). `usable` requires a recorded '
  'successful probe — the constraint makes a configured allow-list impossible.';

comment on column public.provider_models.pricing_prompt is
  'Verbatim provider string. Kept as text because "-1" means dynamically priced, '
  'and comparing it numerically against a budget would read as cheaper than free.';

create index provider_models_usable_idx
  on public.provider_models (provider, model_id)
  where status = 'usable';

create index provider_models_stale_idx
  on public.provider_models (last_probed_at nulls first);

create trigger providers_touch_updated_at
  before update on public.providers
  for each row execute function app.touch_updated_at();

create trigger provider_models_touch_updated_at
  before update on public.provider_models
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The allow-list, as the router sees it
--
-- A view rather than a query the router builds, so "which models may we call"
-- has exactly one definition. It joins provider enablement, so disabling a
-- provider empties its models without touching a single model row.
-- ---------------------------------------------------------------------------
create or replace view public.usable_models as
  select m.provider, m.model_id, m.pricing_prompt, m.pricing_completion,
         m.last_success_at, p.priority, p.base_url, p.secret_ref
  from public.provider_models m
  join public.providers p on p.provider = m.provider
  where m.status = 'usable'
    and p.enabled
    -- Under free_only, zero-priced is required IN ADDITION to a successful
    -- probe. Belt and braces: a probe proves callable, pricing proves free, and
    -- §11 wants both before money is even theoretically at risk.
    and (not p.free_only or (m.pricing_prompt = '0' and m.pricing_completion = '0'))
  order by p.priority, m.model_id;

comment on view public.usable_models is
  'The single definition of "which models may we call". Disabling a provider '
  'empties its models without touching a model row (§8 kill-switch).';

-- ---------------------------------------------------------------------------
-- Seed the providers themselves. Models are discovered, never seeded.
-- ---------------------------------------------------------------------------
insert into public.providers
  (provider, display_name, api_status, priority, free_only, base_url, notes)
values
  ('openrouter', 'OpenRouter', 'official', 10, true, 'https://openrouter.ai/api/v1',
   'Primary router. Only openrouter/free is genuinely zero-priced; openrouter/auto '
   'and auto:free report -1 (§11).'),
  ('openai', 'OpenAI', 'official', 50, false, 'https://api.openai.com/v1',
   'Realtime voice only (Gate 1). free_only false because Realtime has no free '
   'tier — which is why voice is an explicitly funded decision (D3), not a default.'),
  ('gemini', 'Google Gemini', 'official', 60, true, 'https://generativelanguage.googleapis.com/v1beta',
   'Free-tier rate limits are undocumented — Google removed the published tables, '
   'so capacity here is ESTIMATED and never AUTHORITATIVE (§11).')
on conflict (provider) do nothing;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
alter table public.providers        enable row level security;
alter table public.providers        force  row level security;
alter table public.provider_models  enable row level security;
alter table public.provider_models  force  row level security;

create policy providers_app_read on public.providers
  for select to ai_team_app using (true);
create policy provider_models_app_read on public.provider_models
  for select to ai_team_app using (true);

-- Probe results are written by the discovery job, which runs as the owner.
-- The application role reads the allow-list and must not be able to widen it:
-- a bug that could mark a model usable is a bug that could reach a paid model.
grant select on public.providers       to ai_team_app;
grant select on public.provider_models to ai_team_app;
grant select on public.usable_models   to ai_team_app;
