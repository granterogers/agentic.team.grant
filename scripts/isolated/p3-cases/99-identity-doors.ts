/**
 * The identity doors: the places where a VERIFIED secret or sender BECOMES an office (multi-user P3, waves 7-10).
 *
 * They are the one kind of function that must not take an office argument, because what they do is produce the office from the
 * identity. So the claim is the reverse of every other cluster's: nothing a caller can choose reaches the office. The office
 * comes from a hashed secret nobody can name (an MCP token, an authorisation code), from the sender a channel adapter has already
 * verified (Telegram, Slack), or from a command the adapter has just written under that sender. Each proof drives the real
 * function with two offices, and every one also shows that no browser role can execute it and that its signature has no office.
 *
 * docs/multi-user/conversion-overrides.json names these titles; the override is honoured only while no browser role can
 * execute the function.
 */
import { createHash } from 'node:crypto'
import { type Ctx, lit } from '../p3-app-lib.ts'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

export async function cases(c: Ctx): Promise<void> {
  const { A, B, SYS } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const one = async (sql: string) => (await q(sql))[0] as Record<string, unknown>
  const bridgeBefore = Number(
    (await one(`select coalesce(sum(n),0)::int as n from public.office_bridge_use`)).n,
  )

  /** No browser role can execute it, and its signature carries no office. */
  const closedAndOfficeless = async (...sigs: string[]): Promise<boolean> => {
    for (const sig of sigs) {
      const r = await one(
        `select has_function_privilege('anon', '${sig}', 'execute') as a,
                has_function_privilege('authenticated', '${sig}', 'execute') as u,
                has_function_privilege('public', '${sig}', 'execute') as p,
                pg_get_function_identity_arguments('${sig}'::regprocedure) like '%office%' as has_office`,
      )
      if (r.a !== false || r.u !== false || r.p !== false || r.has_office !== false) return false
    }
    return true
  }

  // ---- MCP: a token hash and a code hash are the identity -------------------------------------------------------------
  const tokA = `tokA-${run}-${Math.random()}`
  const tokB = `tokB-${run}-${Math.random()}`
  const cliA = `idoor-a-${run}`
  const cliB = `idoor-b-${run}`
  for (const [office, client, tok] of [
    [A, cliA, tokA],
    [B, cliB, tokB],
  ] as const)
    await c.db.execute(
      `insert into public.mcp_clients (office_id, client_id, display_name, token_sha256, scopes)
       values ('${office}', ${lit(client)}, ${lit(client)}, ${lit(sha(tok))}, array['read'])`,
    )
  const forA = await q(`select * from app.mcp_client_for(${lit(sha(tokA))})`)
  const forB = await q(`select * from app.mcp_client_for(${lit(sha(tokB))})`)
  const forNobody = await q(`select * from app.mcp_client_for(${lit(sha('nobody-holds-this'))})`)
  await c.db.execute(
    `update public.mcp_clients set enabled = false, disabled_reason = 'proof' where client_id = ${lit(cliB)}`,
  )
  const forDisabled = await q(`select * from app.mcp_client_for(${lit(sha(tokB))})`)
  await c.db.execute(
    `update public.mcp_clients set enabled = true, disabled_reason = null where client_id = ${lit(cliB)}`,
  )
  c.check(
    forA.length === 1 &&
      forA[0]?.office_id === A &&
      forB.length === 1 &&
      forB[0]?.office_id === B &&
      forNobody.length === 0 &&
      forDisabled.length === 0 &&
      (await closedAndOfficeless('public.mcp_client_for(text)', 'app.mcp_client_for(text)')),
    "identity-door: mcp_client_for turns a token hash into that client's own office, a hash nobody holds into nothing, and cannot be asked for an office",
    c.json({ forA, forB }),
  )

  const codeA = `codeA-${run}-${Math.random()}`
  const codeB = `codeB-${run}-${Math.random()}`
  const redirect = 'https://claude.ai/api/mcp/auth_callback'
  for (const client of [cliA, cliB])
    await c.db.execute(
      `insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris) values (${lit(client)}, ${lit(`proof ${client}`)}, array[${lit(redirect)}]) on conflict do nothing`,
    )
  for (const [office, client, code] of [
    [A, cliA, codeA],
    [B, cliB, codeB],
  ] as const)
    await c.db.execute(
      `insert into public.mcp_auth_codes (code_sha256, client_id, redirect_uri, code_challenge, scope, office_id, expires_at)
       values (${lit(sha(code))}, ${lit(client)}, ${lit(redirect)}, ${lit(`challenge-${client}`)}, 'read', '${office}', now() + interval '10 minutes')`,
    )
  const chA = (await one(`select app.mcp_code_challenge(${lit(sha(codeA))}) as c`)).c
  const chNobody = (
    await one(`select app.mcp_code_challenge(${lit(sha('nobody-holds-this'))}) as c`)
  ).c
  c.check(
    chA === `challenge-${cliA}` &&
      chNobody === null &&
      (await closedAndOfficeless(
        'public.mcp_code_challenge(text)',
        'app.mcp_code_challenge(text)',
      )),
    'identity-door: mcp_code_challenge answers only for the holder of an unredeemed, unexpired code, and cannot be asked for an office',
    c.json([chA, chNobody]),
  )

  // B's code against A's client id is not a grant, and does not move A's token
  const newTokA = sha(`rotated-${run}`)
  const crossed = (
    await one(
      `select app.mcp_redeem_code(${lit(sha(codeB))}, ${lit(cliA)}, ${lit(redirect)}, ${lit(newTokA)}) as r`,
    )
  ).r as { error?: string }
  const aTokenStill = await one(
    `select token_sha256 as t, office_id as o from public.mcp_clients where client_id = ${lit(cliA)}`,
  )
  const own = (
    await one(
      `select app.mcp_redeem_code(${lit(sha(codeA))}, ${lit(cliA)}, ${lit(redirect)}, ${lit(sha(`fresh-${run}`))}) as r`,
    )
  ).r as { ok?: boolean }
  const replay = (
    await one(
      `select app.mcp_redeem_code(${lit(sha(codeA))}, ${lit(cliA)}, ${lit(redirect)}, ${lit(sha(`again-${run}`))}) as r`,
    )
  ).r as { error?: string }
  c.check(
    crossed.error === 'invalid_grant' &&
      aTokenStill.t === sha(tokA) &&
      own.ok === true &&
      replay.error === 'invalid_grant' &&
      (await closedAndOfficeless(
        'public.mcp_redeem_code(text,text,text,text)',
        'app.mcp_redeem_code(text,text,text,text)',
      )),
    "identity-door: mcp_redeem_code binds a client to the office its code was issued in; another office's code does not take that client, and a code works once",
    c.json({ crossed, own, replay }),
  )

  // ---- Telegram and Slack: the verified sender is the identity ---------------------------------------------------------------
  const actorA = `${900000000 + Math.floor(Math.random() * 99999)}`
  const actorB = `${800000000 + Math.floor(Math.random() * 99999)}`
  const stranger = `${700000000 + Math.floor(Math.random() * 99999)}`
  for (const [office, actor, tag] of [
    [A, actorA, 'a'],
    [B, actorB, 'b'],
  ] as const)
    await c.db.execute(
      `insert into public.subject_identities (subject, origin_channel, actor, kind, office_id)
       values (${lit(`idoor-${tag}-${run}`)}, 'telegram', ${lit(actor)}, 'person', '${office}') on conflict do nothing`,
    )
  const admit = async (actor: string) =>
    (await one(`select public.sender_admitted('telegram', ${lit(actor)}, null) as r`)).r as {
      office_id: string | null
    }
  const aAdm = await admit(actorA)
  const bAdm = await admit(actorB)
  const sAdm = await admit(stranger)
  c.check(
    aAdm.office_id === A &&
      bAdm.office_id === B &&
      sAdm.office_id === null &&
      (await closedAndOfficeless('public.sender_admitted(text,text,text)')),
    'identity-door: sender_admitted gives a verified sender their own office, a stranger none, and cannot be asked for an office',
    c.json([aAdm, bAdm, sAdm]),
  )

  const bot = `idoor-bot-${run}`
  const rec = async (chat: string, type: string, sender: string) =>
    String(
      (
        await one(
          `select public.record_telegram_chat(${lit(chat)}, ${lit(type)}, ${lit(bot)}, null, 'x', 'x', ${lit(sender)}) as r`,
        )
      ).r,
    )
  const recA = await rec(actorA, 'private', actorA)
  const recStranger = await rec(stranger, 'private', stranger)
  const recGroup = await rec(`-100${run.length}${actorA}`, 'supergroup', actorB)
  const rows = await q(
    `select chat_id, office_id::text as o from public.telegram_chats where bot_id = ${lit(bot)} order by chat_id`,
  )
  c.check(
    recStranger === 'ignored' &&
      recGroup === 'ignored' &&
      rows.length === 1 &&
      rows[0]?.o === A &&
      recA !== 'ignored' &&
      (await closedAndOfficeless(
        'public.record_telegram_chat(text,text,text,text,text,text,text)',
      )),
    "identity-door: record_telegram_chat files a private chat under its own sender's office, ignores a stranger and a non-operator's group, and cannot be asked for an office",
    c.json({ recA, recStranger, recGroup, rows }),
  )

  // ---- enqueue_inbound: the command the adapter has just written is the identity --------------------------------------------
  const cmd = async (office: string, tag: string) => {
    const key = `verify:idoor_inbound:${tag}-${run}`
    await c.db.execute(
      `insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, synthetic, office_id)
       values ('teamhq', ${lit(`idoor-${tag}-${run}:1`)}, ${lit(`verify-idoor-${tag}`)}, 'summarise idoor ${run} ${tag}', ${lit(key)}, now(), true, '${office}')`,
    )
    return String(
      (await one(`select command_id from public.inbound_commands where dedupe_key = ${lit(key)}`))
        .command_id,
    )
  }
  const cA = await cmd(A, 'a')
  const cB = await cmd(B, 'b')
  const qa = (await one(`select app.enqueue_inbound('${cA}'::uuid) as r`)).r as { job_id?: string }
  const qb = (await one(`select app.enqueue_inbound('${cB}'::uuid) as r`)).r as { job_id?: string }
  const jobs = await q(
    `select job_id::text as j, office_id::text as o from public.jobs where job_id in ('${String(qa.job_id)}', '${String(qb.job_id)}')`,
  )
  const officeOfJob = (id: string | undefined) => jobs.find((j) => j.j === id)?.o
  c.check(
    typeof qa.job_id === 'string' &&
      typeof qb.job_id === 'string' &&
      officeOfJob(qa.job_id) === A &&
      officeOfJob(qb.job_id) === B &&
      (await closedAndOfficeless('public.enqueue_inbound(uuid)', 'app.enqueue_inbound(uuid)')),
    "identity-door: enqueue_inbound makes the job in the office of the command the adapter wrote, each command's own, and cannot be asked for an office",
    c.json({ qa, qb, jobs }),
  )

  c.check(
    SYS !== A && SYS !== B,
    'the system office is neither person (a control on the fixtures above)',
    '',
  )
  c.check(
    Number((await one(`select coalesce(sum(n),0)::int as n from public.office_bridge_use`)).n) ===
      bridgeBefore,
    'identity doors: none of this relied on the compatibility bridge',
    '',
  )
}
