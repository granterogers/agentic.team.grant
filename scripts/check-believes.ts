/**
 * A capability the office HAS and believes it has NOT.
 *
 * `app.capability_index_core` builds the reach list that goes into every
 * agent's prompt on every turn, and #363 is what happens when it is wrong in
 * the denying direction: Slack read `reachable = false` from 18 September
 * because its twelve-hour CONFIG token was dead, while its BOT token carried
 * 268 messages. All eight agents were told they could not post, on every turn,
 * for six days.
 *
 * Nothing could catch it. `capabilityLies` asks whether an answer contradicts
 * the index, so given the index the denial was TRUE. `check:capabilities` asks
 * whether a handler kind has a registry row, which it has. The index was the
 * thing that was wrong, and every checker downstream of it agreed with it.
 *
 * So this check does not read the index against other beliefs. It reads it
 * against the one source that cannot be argued with: WHAT THE OFFICE ACTUALLY
 * DELIVERED. A service the office is posting through is reachable, whatever
 * any credential row says, and a belief contradicted by `public.deliveries` is
 * a false denial in the prompt of every agent.
 *
 * ## WHY IT ONLY EVER FIRES IN ONE DIRECTION
 *
 * 0304's asymmetry, which this repository has now applied six times. Delivery
 * evidence can PROVE a capability exists and can never prove one absent -- a
 * quiet day is not a dead credential. So the check fails on
 * `reachable = false` beside a successful send, and says nothing at all about
 * `reachable = true` with no traffic. That is the direction with a fact behind
 * it, and it is also the expensive direction: a false NO produces nothing at
 * all, while a false YES produces an attempt that fails and says so.
 *
 * ## WHAT IT DELIBERATELY CANNOT SEE
 *
 * Only the two services that map to a delivery channel. `deliveries.channel`
 * is the evidence, so Notion, Drive and GitHub have no witness here and this
 * check makes no claim about them. A narrow check with a fact behind it beats
 * a broad one built on a proxy -- #172's quoted-chain regex is what the second
 * kind costs.
 *
 * Harness deliveries are excluded through `app.harness_job`, because a suite
 * proving a send is not the office doing its work.
 */
import { ManagementApiExecutor } from '../src/db/executor.ts'

/** A service in the reach list, beside what it has actually carried. */
export type Belief = {
  readonly service: string
  readonly reachable: boolean
  /** Successful, non-harness deliveries on this service's channel in the window. */
  readonly delivered: number
}

/**
 * THE PREDICATE THAT DECIDES THE LIVE CHECK, named so the controls can run an
 * injected reading through the same code. A control that asserts what a QUERY
 * saw is one step short of a guard (`verify:drains`).
 */
export const contradictedByEvidence = (b: Belief): boolean => !b.reachable && b.delivered > 0

/** Services whose work leaves evidence in `deliveries.channel`. */
const CHANNEL_OF: Readonly<Record<string, string>> = {
  Slack: 'slack',
  Telegram: 'telegram',
}

const WINDOW_HOURS = 24

const main = async (): Promise<void> => {
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    process.env.SUPABASE_ACCESS_TOKEN ?? '',
  )

  const rows = await db
    .execute(
      `with reach as (
         select r ->> 'service' as service, (r ->> 'reachable')::boolean as reachable
           from jsonb_array_elements(app.capability_index_core(app.operator_office(), null) -> 'reach') r
       ),
       sent as (
         select d.channel, count(*) as n
           from public.deliveries d
           left join public.jobs j on j.job_id = d.job_id
          where d.state = 'sent'
            and d.sent_at > now() - interval '${String(WINDOW_HOURS)} hours'
            and (d.job_id is null or not app.harness_job(d.job_id))
          group by d.channel
       )
       select reach.service, reach.reachable,
              coalesce(sent.n, 0)::int as delivered
         from reach
         left join sent on sent.channel = case reach.service
                             when 'Slack' then 'slack'
                             when 'Telegram' then 'telegram' end
        where reach.service in ('Slack', 'Telegram')
        order by reach.service`,
    )
    .then((r) => r.rows as { service: string; reachable: boolean; delivered: number }[])

  /* A found-nothing check needs a control that must come back positive. If the
     reach list stops naming the surfaces, this check would pass on an empty
     set and say the question was asked. */
  const watched = Object.keys(CHANNEL_OF)
  const missing = watched.filter((s) => !rows.some((r) => r.service === s))
  if (missing.length > 0) {
    console.error(
      `check:believes CANNOT RUN — the reach list no longer names ${missing.join(', ')}, ` +
        `so this check would report clean without asking anything.`,
    )
    process.exit(1)
  }

  /* Prove the predicate can fail, on an injected reading, every run. A check
     that has only ever reported zero is indistinguishable from one that cannot
     report anything. */
  if (!contradictedByEvidence({ service: 'control', reachable: false, delivered: 1 })) {
    console.error('check:believes CANNOT RUN — the predicate does not fire on a known lie.')
    process.exit(1)
  }
  if (contradictedByEvidence({ service: 'control', reachable: false, delivered: 0 })) {
    console.error('check:believes CANNOT RUN — the predicate fires on a quiet day.')
    process.exit(1)
  }

  const beliefs: Belief[] = rows.map((r) => ({
    service: r.service,
    reachable: r.reachable,
    delivered: Number(r.delivered),
  }))

  for (const b of beliefs) {
    console.log(
      `  ${b.service}: reachable=${String(b.reachable)}, ` +
        `delivered ${String(b.delivered)} in ${String(WINDOW_HOURS)}h`,
    )
  }

  const wrong = beliefs.filter(contradictedByEvidence)
  if (wrong.length === 0) {
    console.log(
      `check:believes clean — ${String(beliefs.length)} service(s) with delivery evidence; ` +
        `no service the office is using is described to its agents as unreachable`,
    )
    process.exit(0)
  }

  for (const b of wrong) {
    console.error(
      `FALSE DENIAL: every agent is told ${b.service} is unreachable, and the office ` +
        `delivered ${String(b.delivered)} message(s) through it in the last ` +
        `${String(WINDOW_HOURS)} hours. Check which credential is speaking for the ` +
        `service in app.capability_index_core, for the sole person's office (#363).`,
    )
  }
  process.exit(1)
}

await main()
