/**
 * The containment witnesses that do NOT ask `app.harness_job` (ledger R37).
 *
 * The guard (`app.claim_delivery`) and every other leak check decide "harness"
 * with one predicate, so a harness it cannot see is invisible to all of them
 * at once - which is how `verify:scenario-a` delivered to Grant for sixteen
 * days while `check:leaks` said "0 new". These ask other questions:
 *
 *   OFF_SHAPE     a turn delivered to a real destination whose dedupe key no
 *                 production adapter writes (Telegram numeric chat/message,
 *                 Slack channel/ts, the dashboard page's own voice session);
 *   HARNESS_DOC   a delivery from work a DOCUMENT started, where the document
 *                 was added by a harness writer - the scenario-a child that the
 *                 first witness could not see, because it has no inbound turn.
 *
 * One definition, two callers: `npm run check:leaks` on production and the
 * isolated containment proof, so the proof exercises the witness that ships.
 */
export const ADAPTER_SHAPE = String.raw`^telegram:(message:([A-Za-z0-9_-]+:)?-?[0-9]+:[0-9]+|callback:[A-Za-z0-9_-]+:[0-9]+)$|^slack:(message|reaction|action):[A-Z0-9]+:[0-9.]+$|^voice:turn:s[a-z0-9]{1,10}\.[a-z0-9]+$`

export const offShapeSql = `
  select distinct c.dedupe_key as key, d.delivery_id::text as delivery_id
    from public.inbound_commands c
    join public.jobs j on (j.pinned_config ->> 'command_id')::uuid = c.command_id
    join public.deliveries d on d.job_id = j.job_id
   where d.sent_at is not null
     and d.created_at > app.harness_guard_since()
     and split_part(c.dedupe_key, ':', 1) in ('telegram', 'slack', 'voice')
     and not exists (select 1 from public.known_escapes k where k.delivery_id = d.delivery_id)
     and c.dedupe_key !~ '${ADAPTER_SHAPE}'`

export const harnessDocSql = `
  select d.delivery_id::text as delivery_id, doc.added_by as key
    from public.deliveries d
    join public.jobs j on j.job_id = d.job_id
    join public.documents doc on doc.document_id::text = j.pinned_config ->> 'document_id'
   where d.sent_at is not null
     and d.created_at > app.harness_guard_since()
     and not exists (select 1 from public.known_escapes k where k.delivery_id = d.delivery_id)
     and coalesce(doc.added_by, '') ~ '^(verify|fixture|probe|gate)[-:_.]'`
