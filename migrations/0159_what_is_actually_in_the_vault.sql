-- What is actually in the vault.
--
-- Grant: *"I already gave you a token ages ago.. you need to bake this in so
-- you don't forget again."*
--
-- He is right, and the failure is worth naming precisely. `src/github/api.ts`
-- looked for a secret called `github.token`, did not find one, and reported
-- "no token — it is Grant's to create". A GitHub token had been in the vault
-- for days under the name `github.dispatch_token`. Nothing lied; the code asked
-- one question and I read the answer as a different, larger one.
--
-- `scripts/audit/credentials.ts` opens by saying this has now happened three
-- times, each time costing a round trip with him. This is the fourth, and the
-- reason it recurred is visible in that file: **it audits environment
-- variables.** Nothing has ever enumerated the vault. So "is there a credential
-- for X?" has never been a lookup — it has been somebody remembering, and the
-- somebody was me.
--
-- ## What this adds
--
-- Names, descriptions, sizes and ages. Never a value, and deliberately not even
-- a prefix: a four-character prefix of a token is a real narrowing of a search
-- space, and this output is meant to be safe to paste anywhere.
--
-- Grouped by the part of the name before the first dot, because that is already
-- the convention every secret here follows and it makes "what do we hold for
-- GitHub?" one row rather than a scan.
--
-- ## Why in the database rather than a script
--
-- So every surface can ask. The audit script prints it, the dashboard can show
-- it, and a future session that wonders whether a credential exists has
-- somewhere to look that is not this migration's comment.

begin;

create or replace function app.vault_inventory()
returns table (
  service     text,
  name        text,
  description text,
  bytes       integer,
  created_at  timestamptz,
  age_days    integer
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    split_part(s.name, '.', 1) as service,
    s.name,
    s.description,
    length(s.decrypted_secret)::integer as bytes,
    s.created_at,
    floor(extract(epoch from (app.now_utc() - s.created_at)) / 86400)::integer as age_days
  from vault.decrypted_secrets s
  order by split_part(s.name, '.', 1), s.name
$$;

comment on function app.vault_inventory() is
  'Every secret the vault holds: name, what it is for, how big and how old. '
  'Never the value, and never a prefix of one. Exists so "do we have a '
  'credential for X?" is a lookup instead of somebody remembering (0159).';

create or replace function public.vault_inventory()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select coalesce(jsonb_agg(to_jsonb(v) order by v.service, v.name), '[]'::jsonb)
    from app.vault_inventory() v
$$;

-- ---------------------------------------------------------------------------
-- The naming convention, written down where the names are
-- ---------------------------------------------------------------------------
--
-- Recorded as configuration rather than in a document, because a document is
-- somewhere else and this is the question being answered at the moment it is
-- asked. A reader who runs the inventory above sees this beside it.

insert into public.system_config (key, value, description)
values (
  'vault.naming',
  to_jsonb('<service>.<purpose>_token — and a credential is never assumed absent'::text),
  'Every vault secret is named <service>.<purpose>, so `app.vault_inventory()` '
  'can group them. The rule that matters: before saying a credential does not '
  'exist, ENUMERATE — do not test one guessed name. github.dispatch_token sat '
  'in the vault while the GitHub client asked for github.token and reported '
  'nothing there (0159).'
)
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

-- ---------------------------------------------------------------------------
-- What we hold for GitHub, and what it is not
-- ---------------------------------------------------------------------------
--
-- `github.dispatch_token` is a fine-grained PAT scoped to THIS repository with
-- contents:write, made for `repository_dispatch` (0126). It authenticates — a
-- live call returns `granterogers` — so the read client should use it rather
-- than claim there is nothing.
--
-- It is still not the credential §8 describes. §8 wants "Look at my Rest Timer
-- GitHub repo" to work, and a token scoped to one repository cannot see Rest
-- Timer whatever it is allowed to do there. Recorded here so the difference is
-- a row rather than a thing I have to remember twice.

update public.connection_health
   set detail = 'github.dispatch_token authenticates as granterogers; scoped to '
                'this repository only, so reads of other repos need a wider '
                'read-only token (§8)',
       checked_at = app.now_utc()
 where service = 'GitHub';

commit;
