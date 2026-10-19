begin;

-- The Services card said NotebookLM was connected, "checked 18 Sep, valid" (issue #502).
--
-- Two defects, both in the status the card reads:
--   1. The NotebookLM connector pointed at the Google sign-in's health row (health_service 'Google'). A NotebookLM session
--      is not the Google sign-in, so its status was the Google row's, from 18 September.
--   2. Nothing ages a health row. A row checked weeks ago was shown as the state of the service today.
--
-- This fixes both. NotebookLM has no health row of its own yet, so it is unchecked until one exists (the honest answer).
-- Any health row older than 24 hours is shown as unchecked, with its detail blanked, so a stale "valid" cannot read as
-- a current fact. The date of the last check is still shown.
--
-- The function is spliced from its LIVE definition, and each replacement must match exactly once.

update public.knowledge_connectors
   set health_service = null, updated_at = now()
 where connector = 'notebooklm' and health_service = 'Google';

do $$
declare
  v text := pg_get_functiondef('app.hq_studio_settings(uuid)'::regprocedure);
  pairs text[][] := array[
    array[
      E'               else coalesce(h.state, ''unchecked'') end,\n',
      E'               when h.checked_at < now() - interval ''24 hours'' then ''unchecked''\n'
      || E'               else coalesce(h.state, ''unchecked'') end,\n'
    ],
    array[
      E'               case when not k.enabled then k.disabled_reason else h.detail end, ''''),',
      E'               case when not k.enabled then k.disabled_reason\n'
      || E'                    when h.checked_at < now() - interval ''24 hours'' then null\n'
      || E'                    else h.detail end, ''''),'
    ]
  ];
  i int;
  n int;
begin
  -- Idempotent: a database that already carries the freshness rule is left as it is.
  if position('24 hours' in v) > 0 then
    return;
  end if;
  for i in 1 .. array_length(pairs, 1) loop
    n := (length(v) - length(replace(v, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> 1 then
      raise exception '1086: expected one occurrence of % in the live hq_studio_settings, found %', pairs[i][1], n;
    end if;
    v := replace(v, pairs[i][1], pairs[i][2]);
  end loop;
  execute v || ';';
end
$$;

commit;
