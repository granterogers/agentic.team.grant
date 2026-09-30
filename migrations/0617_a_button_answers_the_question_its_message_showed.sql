/*
  0617 - a button answers the question its message showed, not the newest one on the job

  Found by the run-3 effect-door review of the approval press. A Telegram or Slack Approve/Decline
  button is resolved from the DELIVERY the press was on, to the JOB that message was about
  (`deliveries.job_id`, never the button's own payload - that part was right). It then answered
  `app.open_approval_for_job(job)`: the newest question on that job that is open AT PRESS TIME.

  A job can ask more than one question over its life (a plan step asks, is answered, the next step
  asks). So a button on the FIRST message, pressed after the second question was raised, approved the
  second - something the message never showed, and which Run 2's fingerprints bind to a different
  action. Approval applies to exactly what was approved: the press must answer what the message
  asked.

  The message asked whatever was the latest question on the job when it was SENT. That is derivable
  without a new column: the latest question on the delivery's job created at or before the delivery
  was sent. If that one has since been answered, the press is told so (`hq_answer_blocker`'s
  ordinary "already answered"), and no later question is touched. A question raised AFTER the
  message went out cannot be answered by it.

  The old function stays (a typed yes to "the one open question" is a different, conversational
  binding, and other readers use it). A worker that predates this keeps its old behaviour.
*/
create or replace function app.approval_for_delivery(p_delivery uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $$
  select b.blocker_id
    from public.deliveries d
    join public.blockers b on b.job_id = d.job_id
   where d.delivery_id = p_delivery
     and b.created_at <= coalesce(d.sent_at, d.created_at)
   order by b.created_at desc, b.blocker_id
   limit 1
$$;
comment on function app.approval_for_delivery(uuid) is
  'The question a message with buttons was asking: the latest one on its job at the time it was sent. A question raised later is not the one the buttons show.';
revoke all on function app.approval_for_delivery(uuid) from public;
grant execute on function app.approval_for_delivery(uuid) to ai_team_app, service_role;
