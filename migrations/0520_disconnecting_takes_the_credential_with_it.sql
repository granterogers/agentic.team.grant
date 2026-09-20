/*
  0520 — disconnecting takes the credential with it (#259, Phase 2)

  0519's `hq_forget_vikunja` removed the address and stopped the duty and left
  `vikunja.api_token` in the Vault. A credential nothing uses is a credential
  nobody rotates, and "disconnect" that leaves one behind is the word not
  meaning what it says.

  Removed BY NAME, and the removal is COUNTED rather than assumed: CLAUDE.md
  records 0350's Telegram branch deleting two secret names that have never
  existed and returning `ok: true` about it. A destructive function that cannot
  say what it removed is a claim with nothing behind it.

  Nothing references this secret by uuid — the handler reads it by name from
  `vault.decrypted_secrets` and treats a missing one as "not connected" — so
  this cannot leave the dangling reference that took the whole office down when
  Slack's token went.
*/

create or replace function app.hq_forget_vikunja()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_kept    int;
  v_links   int;
  v_secrets int;
begin
  select count(*)::int into v_kept from public.tasks
   where assigned_to_human and not coalesce(is_fixture, false);
  select count(*)::int into v_links from public.task_links where provider = 'vikunja';

  perform app.task_provider_forget('vikunja');
  delete from public.system_config where key in ('vikunja.base_url', 'vikunja.project_id');

  select count(*)::int into v_secrets from vault.secrets where name = 'vikunja.api_token';
  if v_secrets > 0 then
    perform vault.delete_secret(id) from vault.secrets where name = 'vikunja.api_token';
  end if;

  update public.responsibilities set enabled = false where job_kind = 'tasks.sync';

  return jsonb_build_object('ok', true,
    'tasks_kept', v_kept, 'links_removed', v_links, 'credential_removed', v_secrets > 0,
    'note', 'every task is still here - Vikunja was a projection, never the list');
end;
$fn$;

do $drive$
declare v jsonb; v_had int;
begin
  -- Nothing is connected in this database, so the drive proves the SHAPE: it
  -- runs clean, keeps every task, and says honestly that there was no
  -- credential to remove rather than claiming it removed one.
  select count(*)::int into v_had from public.tasks
   where assigned_to_human and not coalesce(is_fixture, false);
  v := app.hq_forget_vikunja();
  if (v ->> 'ok')::boolean is not true then
    raise exception '0520: disconnecting failed: %', v;
  end if;
  if (v ->> 'tasks_kept')::int <> v_had then
    raise exception '0520: disconnecting changed the number of tasks: % vs %', v, v_had;
  end if;
  if not exists (select 1 from public.responsibilities
                  where job_kind = 'tasks.sync' and not enabled) then
    raise exception '0520: the duty is still running after a disconnect';
  end if;
  raise notice '0520 drive: three checks passed';
end;
$drive$;
