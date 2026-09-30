/**
 * The question reached him (0622, #394).
 *
 * A typed yes answers a question he was SHOWN, on a channel that delivers to a conversation. A fixture that
 * raises a question and never delivers it models a question nobody saw - which is exactly what the rule refuses.
 * So a suite that models the ordinary case says so: a `sent` delivery of the job that raised the question, to the
 * chat the reply comes from.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'

export async function markShown(
  db: PgExecutor,
  channel: string,
  chat: string,
  jobId: string,
): Promise<void> {
  if (channel !== 'telegram' && channel !== 'slack') return
  await db.execute(`insert into public.deliveries
    (channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref)
    values ('${channel}', 'shown-${crypto.randomUUID()}', 'isolated', '${chat.replace(/'/g, "''")}', 'blocker',
            '${jobId}'::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), '4242')`)
  // 0623: a message names the question it asked. The fixture's message asked this job's newest question.
  await db.execute(`update public.deliveries d set blocker_id = b.blocker_id
      from (select blocker_id from public.blockers where job_id = '${jobId}'::uuid order by created_at desc limit 1) b
     where d.job_id = '${jobId}'::uuid and d.blocker_id is null and d.dedupe_key like 'shown-%'`)
}

/**
 * A chat id in the shape the channel really has (deliveries_target_shaped): a Telegram chat is a number and a
 * Slack channel is C + capitals. A fixture that names its chat `ack-...` cannot be delivered to, so it could never
 * have been shown anything.
 */
export function chatFor(run: string, channel: string, n: number): string {
  if (channel === 'telegram')
    return String((Number.parseInt(run.slice(0, 5), 36) % 900000) * 1000 + 100000000 + n)
  if (channel === 'slack') {
    const base = run
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '0')
      .padEnd(6, '0')
      .slice(0, 6)
    return `C${base}${String(n).padStart(4, '0')}`
  }
  return `ack-${run}-${channel}-${String(n)}`
}
