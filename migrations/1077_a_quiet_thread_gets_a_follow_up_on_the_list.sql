begin;

-- The daily duty that puts a follow-up on Grant's list for an email thread that has gone quiet (REG-029, COS-127).
--
-- Owned by the Chief of Staff, because a follow-up is work the office lays out for him, not a credential or a backup
-- it can only report. It is registered for the operator's office only: other offices (including the public Sample)
-- do not get a daily duty that creates tasks until someone decides they should.
--
-- The duty creates a TASK and never sends anything. `gmail.send` stays disabled in tool_permissions.

insert into public.responsibilities
  (office_id, slug, description, staff_id, job_kind, period_minutes, enabled, created_by)
select app.operator_office(),
       'followup-unanswered',
       'Put a follow-up on Grant''s list for an email thread that has gone quiet for a week, once per thread, with no date '
       || 'invented and nothing sent.',
       s.staff_id,
       'office.followups',
       1440,
       true,
       'grant'
  from public.staff s
 where s.slug = 'chief-of-staff'
on conflict (office_id, slug) do update
   set job_kind = excluded.job_kind,
       period_minutes = excluded.period_minutes,
       enabled = true;

commit;
