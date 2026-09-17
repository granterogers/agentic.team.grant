/*
  0407 - an icon key has a shape, and nothing checked it (#221).

  `app.hq_project_look` takes `p_icon text` and stores whatever it is given.
  That was harmless while the page offered thirty keys it had drawn itself;
  with 451 from lucide it is the registry-row defect one table over - a value
  that CLAIMS to name an icon, with nothing behind it, rendering as a blank
  square on Grant's project list and nowhere saying why.

  Checked as a SHAPE, never as a list. An enumeration of 451 keys in SQL would
  go stale the first time scripts/build-icons.ts is run with a different
  DOMAINS table, and this repository has undone that mistake four times: an
  index asserted by name, a whitelist of source schemes, a token-shape list
  and a dimension CHECK that 0366 replaced with a table. A key is lowercase
  letters, digits and single hyphens, two to forty characters. Every key the
  library can produce satisfies it and no accident does.

  The refusal names the class and quotes what it got, because a silent
  rejection of a valid-looking key is the UX defect 0359 records: a value
  refused for an invisible reason, with nothing on screen to see.
*/

create or replace function app.icon_key_ok(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_key is null or p_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(p_key) between 2 and 40 $$;

comment on function app.icon_key_ok(text) is
  'The SHAPE of an icon key, never a list of them. #221';

do $$
declare v_def text;
begin
  /*
    Patched from the LIVE definition rather than transcribed.

    hq_project_look is long, holds the image size guard, the undo offer and
    two branches of clearing, and retyping it to add four lines is how a
    function loses something nobody notices. pg_get_functiondef emits no
    trailing semicolon - twice recorded in CLAUDE.md, 0353 and 0355 - so one
    is added.

    The anchor is asserted first: a replace that matched nothing would leave
    the function correct and the guard absent, which reads exactly like the
    guard working.
  */
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_project_look';

  if v_def is null then
    raise exception 'app.hq_project_look does not exist';
  end if;
  if position('v_project := ' in v_def) = 0 and position('begin' in v_def) = 0 then
    raise exception 'hq_project_look has no body to patch';
  end if;

  execute replace(
    v_def,
    '  update public.projects',
    $patch$  if not app.icon_key_ok(p_icon) then
    return jsonb_build_object('error',
      format('%L is not the shape of an icon key -- lowercase letters, digits '
             || 'and single hyphens, two to forty characters', p_icon));
  end if;

  update public.projects$patch$
  ) || ';';
end $$;
