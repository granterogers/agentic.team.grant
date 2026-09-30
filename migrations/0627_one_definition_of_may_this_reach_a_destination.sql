/*
  0627 - one definition of "may this reach a destination" (Final audit reconciliation, #395).

  `app.claim_delivery` asks `app.delivery_refusal`; `app.deliverable_to` answers the same question for the witnesses and
  the suites. They were two hand-written copies: check:callers reported deliverable_to as a capability nothing in the
  product calls, which is exactly how a guard and its witness drift apart (0304, 0574). delivery_refusal now asks
  deliverable_to for the yes/no and keeps only the REASON text. Behaviour is unchanged: deliverable_to is
  (registered test destination) or (may_act_outside(job)), and may_act_outside is origin in (trusted, internal); the
  other two origins, harness and unknown, are the two refusals. No data is written.

  ROLLBACK: docs/final-audit/rollback-0627.sql (the previous delivery_refusal).
*/
CREATE OR REPLACE FUNCTION app.delivery_refusal(p_job_id uuid, p_dedupe_key text, p_channel text, p_target_ref text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref
                    and t.retired_at is null) then null
    when p_job_id is null then
      case when exists (select 1 from public.operator_senders s
                         where s.namespace = split_part(coalesce(p_dedupe_key, ''), ':', 1))
           then null
           else 'no provenance: a delivery must name its job or a registered operator sender'
      end
    when not exists (select 1 from public.jobs j where j.job_id = p_job_id) then
      'no provenance: the job this delivery names does not exist'
    else
      -- ONE definition of "may this reach a destination": deliverable_to (a registered test destination, or work whose
      -- origin may act outside). This function only adds the REASON when the answer is no (#395: the predicate had
      -- drifted into a second copy that nothing in the product called).
      case when app.deliverable_to(p_job_id, p_channel, p_target_ref) then null
      else
        case app.job_origin(p_job_id)
          when 'harness' then 'harness traffic may not reach a production destination'
          else 'unknown origin: no production door or office process made this work'
        end
      end
  end
$function$;
