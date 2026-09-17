/*
  0408 - a new project gets a mark that fits it, where one fits (#221).

  Grant asked for a real icon library and, in the same breath, that
  "new projects get a distinct icon automatically where practical".

  WHERE PRACTICAL IS THE WHOLE INSTRUCTION

  A random mark per project would satisfy "distinct" and would be worse than
  the coloured square it replaces: a briefcase on a coaching course is a
  stronger wrong signal than no icon at all, because a person reads it as
  meaning something. So this matches the project's NAME against terms, and a
  project whose name matches nothing keeps the generated art - which is what
  happens today and is a perfectly good cover.

  A TABLE, NOT A CASE STATEMENT

  0366 put the breadth dimensions in a table rather than a CHECK constraint for
  the reason that applies here exactly: a list in SQL is one Grant cannot add
  to. He will look at a new project called "Pipeline review", see no mark, and
  the fix should be one row rather than a migration.

  The terms are matched as WHOLE WORDS against the name, longest first, so
  "coaching course" beats "course" and "art" does not match "smart". The icon
  must be a real key, which app.icon_key_ok checks (0407) - a default naming a
  mark the page cannot draw would be the registry-row defect with a friendlier
  face.
*/

create table if not exists public.icon_defaults (
  term  text primary key check (term = lower(btrim(term)) and length(term) between 2 and 40),
  icon  text not null check (app.icon_key_ok(icon)),
  added_by text not null default 'migration',
  created_at timestamptz not null default app.now_utc()
);

comment on table public.icon_defaults is
  'Name term to icon key, for choosing a new project a mark that fits. Grant edits this. #221';

insert into public.icon_defaults (term, icon) values
  ('course', 'graduation-cap'), ('coaching', 'graduation-cap'), ('training', 'graduation-cap'),
  ('learning', 'book-open'), ('school', 'school'), ('curriculum', 'book-open'),
  ('research', 'microscope'), ('study', 'microscope'), ('analysis', 'chart-line'),
  ('report', 'file-text'), ('docs', 'files'), ('documentation', 'files'),
  ('finance', 'coins'), ('budget', 'calculator'), ('pricing', 'banknote'),
  ('invoice', 'receipt'), ('accounts', 'landmark'), ('revenue', 'trending-up'),
  ('marketing', 'megaphone'), ('growth', 'trending-up'), ('campaign', 'megaphone'),
  ('brand', 'palette'), ('design', 'palette'), ('content', 'pen-tool'),
  ('website', 'globe'), ('web', 'globe'), ('app', 'smartphone'),
  ('api', 'server'), ('data', 'database'), ('platform', 'server'),
  ('ai', 'bot'), ('agent', 'bot'), ('automation', 'workflow'),
  ('product', 'package'), ('launch', 'rocket'), ('roadmap', 'map'),
  ('hiring', 'users'), ('team', 'users'), ('people', 'users'),
  ('health', 'heart-pulse'), ('wellness', 'heart-pulse'), ('fitness', 'dumbbell'),
  ('property', 'home'), ('house', 'home'), ('build', 'hammer'),
  ('travel', 'plane'), ('trip', 'plane'), ('event', 'calendar'),
  ('legal', 'scale'), ('compliance', 'shield-check'), ('risk', 'shield-alert'),
  ('support', 'life-buoy'), ('sales', 'handshake'), ('client', 'handshake'),
  ('operations', 'settings'), ('process', 'workflow'), ('archive', 'archive'),
  ('podcast', 'mic'), ('video', 'film'), ('photo', 'camera'), ('music', 'music')
on conflict (term) do nothing;

/*
  The match.

  Longest term first so a two-word name is not decided by its shorter half,
  and a whole-word boundary so "art" does not match "smart" and "api" does not
  match "rapid". Returns null when nothing fits, which is the common case and
  the one that must stay cheap.
*/
create or replace function app.icon_for_name(p_name text)
returns text
language sql
stable security definer
set search_path = ''
as $$
  select d.icon
    from public.icon_defaults d
   where lower(coalesce(p_name, '')) ~ ('\y' || d.term || '\y')
   order by length(d.term) desc, d.term
   limit 1
$$;

comment on function app.icon_for_name(text) is
  'A mark that fits the name, or null. Never a random one. #221';

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_create_project';

  -- The anchor, asserted before the replace. A patch that matched nothing
  -- would leave the function correct and the feature absent, which reads
  -- exactly like the feature working on a project whose name fits nothing.
  if v_def is null or position('values (v_slug, trim(p_name), v_prefix, ''active'')' in v_def) = 0 then
    raise exception 'hq_create_project does not have the insert this patch expects';
  end if;

  -- Both halves in one replace. Patching the column list without the VALUES
  -- would be a syntax error at apply time, which is the lucky direction; the
  -- reverse would insert a name into the icon column, which is not.
  execute replace(
    v_def,
    'insert into public.projects (slug, name, channel_prefix, status)
  values (v_slug, trim(p_name), v_prefix, ''active'')',
    'insert into public.projects (slug, name, channel_prefix, status, icon)
  values (v_slug, trim(p_name), v_prefix, ''active'', app.icon_for_name(p_name))'
  ) || ';';
end $$;
