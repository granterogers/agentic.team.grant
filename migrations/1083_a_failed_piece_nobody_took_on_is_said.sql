begin;

-- A piece of a turn's work that FAILED, and that nobody took on, is said to the next turn (COS-053, COS-083, REG-039).
--
-- `app.conversation_before` told a later turn what was still going and what waited on Grant, and was silent about a
-- failed piece. A failed specialist hand-off is reassigned to the Chief of Staff (migration 1080): the replacement
-- carries the same instruction, the same parent and `reassigned_from`. So a failed piece is "taken on" when such a
-- replacement exists, and is untaken otherwise.
--
-- The new definition is spliced from the LIVE one (pg_get_functiondef), and every replacement is checked to have
-- happened exactly once, so a changed live definition fails here rather than producing a function that does not
-- carry the count.

do $$
declare
  v text := pg_get_functiondef('app.conversation_before(uuid,uuid)'::regprocedure);
  pairs text[][] := array[
    array[
      E'            where k3.parent_job_id = c.job_id and b.state = ''open'') as waiting_on_you\n      from public.inbound_commands c, self',
      E'            where k3.parent_job_id = c.job_id and b.state = ''open'') as waiting_on_you,\n'
      || E'           (select count(*) from public.jobs k4\n'
      || E'             where k4.parent_job_id = c.job_id\n'
      || E'               and k4.state = ''failed''\n'
      || E'               and not exists (\n'
      || E'                 select 1 from public.jobs r\n'
      || E'                  where r.parent_job_id = c.job_id\n'
      || E'                    and r.pinned_config ->> ''reassigned_from'' is not null\n'
      || E'                    and r.pinned_config ->> ''instruction'' = k4.pinned_config ->> ''instruction'')) as failed_untaken\n'
      || E'      from public.inbound_commands c, self'
    ],
    array[
      '''waitingOnYou'', waiting_on_you)',
      '''waitingOnYou'', waiting_on_you, ''failedUntaken'', failed_untaken)'
    ]
  ];
  i int;
  n int;
begin
  -- Idempotent: a database that already carries the count is left as it is.
  if position('failed_untaken' in v) > 0 then
    return;
  end if;
  for i in 1 .. array_length(pairs, 1) loop
    n := (length(v) - length(replace(v, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> 1 then
      raise exception '1083: expected one occurrence of % in the live conversation_before, found %', pairs[i][1], n;
    end if;
    v := replace(v, pairs[i][1], pairs[i][2]);
  end loop;
  execute v || ';';
end
$$;

commit;
