begin;

-- The Settings sheet waits for the whole of hq_studio_settings before it draws, and that function builds the usage overview
-- (about 2.8 seconds) and the free-tier headroom before it returns, so every tab waited for them (issue #502 follow-up: "still
-- takes too long to load").
--
-- Those two reads leave the settings payload. The usage overview is already its own gateway section (`usage_overview`), and
-- the headroom gets one (`free_tier_headroom`, migration 0180's public function). The Usage tab and the spend card both read
-- the usage overview, and they now draw when it lands instead of holding the rest of Settings back.
--
-- `self_improvement` is dropped too: nothing on the page reads it.
--
-- The function is changed by removing three lines from its LIVE definition, not by retyping it, so the rest cannot drift. If a
-- line is not found exactly once the migration stops rather than guessing. A database that has already had it is left alone.

do $$
declare
  v text := pg_get_functiondef('app.hq_studio_settings(uuid)'::regprocedure);
  l_usage text := E'    ''usage'', app.usage_overview(p_office),\n';
  l_headroom text := E'    ''headroom'', app.free_tier_headroom(),\n';
  l_self text := E'    ''self_improvement'', app.self_improvement_headroom(),\n';
begin
  -- Idempotent: a definition with none of the three lines is already the new one.
  if position(l_usage in v) = 0 and position(l_headroom in v) = 0 and position(l_self in v) = 0 then
    return;
  end if;
  if (length(v) - length(replace(v, l_usage, ''))) / length(l_usage) <> 1
    or (length(v) - length(replace(v, l_headroom, ''))) / length(l_headroom) <> 1
    or (length(v) - length(replace(v, l_self, ''))) / length(l_self) <> 1 then
    raise exception '1088: the usage, headroom and self_improvement lines were not each found once in the live hq_studio_settings';
  end if;
  v := replace(v, l_usage, '');
  v := replace(v, l_headroom, '');
  v := replace(v, l_self, '');
  execute v;
end
$$;

commit;
