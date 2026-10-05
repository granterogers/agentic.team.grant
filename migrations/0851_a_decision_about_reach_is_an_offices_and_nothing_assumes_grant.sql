-- 0851 - a withdrawn request is an office's; the ambient-Grant readers go (multi-user P3, k-worker-internal).
--
--   app.withdraw_tool_request(p_office, p_request_id, p_by)   a request is an office's. A request of another office is "nothing open to
--                                                             withdraw" - the sentence a missing one gets - and nothing of it moves.
--   app.hq_appearance(p_office)                                the appearance an office stored, read by office (it read `owner='grant'`)
--
-- The three DECISION functions (approve, decline, revoke) are the governance cluster's and live in 0741, with the staff_tools key
-- rebuilt to lead with the office. They were also written here before the two clusters were merged; the duplicates were removed.
--
-- DROPPED, with no caller in the database, the repository or the gateway:
--   app.contact_labels(text)                 its office-explicit sibling app.contact_labels(uuid) is what every reader calls
--   app.hq_appearance(text)                  replaced above
--   public.task_pulled(text, text, jsonb)    a wrapper over app.task_pulled(text, text, jsonb), which no longer exists: it could only fail

create function app.withdraw_tool_request(p_office uuid, p_request_id uuid, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  update public.tool_requests
     set state = 'withdrawn', settled_at = app.now_utc(), decided_by = p_by
   where request_id = p_request_id and office_id = p_office and state = 'open';
  if not found then
    return jsonb_build_object('error', 'nothing open to withdraw');
  end if;
  return jsonb_build_object('withdrawn', p_request_id);
end;
$function$;
revoke all on function app.withdraw_tool_request(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- hq_appearance: read by office, not by the literal owner 'grant'
-- ---------------------------------------------------------------------------------------------------------------------
create function app.hq_appearance(p_office uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce((select a.settings from public.appearance_settings a
                    where a.office_id = app.require_office(p_office)
                    order by a.updated_at desc limit 1),
                  '{}'::jsonb)
$function$;
revoke all on function app.hq_appearance(uuid) from public, anon, authenticated, service_role;

drop function app.hq_appearance(text);
drop function app.contact_labels(text);
drop function public.task_pulled(text, text, jsonb);
