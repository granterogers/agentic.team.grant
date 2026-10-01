/**
 * The integration functions (migration 0760): the signed-in browser tier and the MCP admin surface.
 * A pasted session jar is a CREDENTIAL belonging to one office; an MCP provider's tools are offered only inside the
 * provider's own office. Person A and Person B each have a project with the SAME slug, a session on the SAME site and a
 * provider with the SAME name. Every credential-shaped value below is an obviously fake canary and is never printed.
 */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const S = 'service_role'
  const q = (office: string) => lit(office)
  const low = (s: string) => s.toLowerCase().replaceAll('-', '_')
  const tag = { A: low(c.canary.A), B: low(c.canary.B) }
  const SITE = 'supplier.example.com'

  const bridgeBefore = (
    await c.db.execute(
      `select coalesce(sum(n),0)::int as n from public.office_bridge_use
        where table_name in ('browser_sessions','browser_actions','mcp_providers','mcp_discovered_tools','jobs','mcp_clients')`,
    )
  ).rows[0] as { n: number }

  // ---- fixtures: one project each, with the same slug -------------------------------------------------------------------
  const proj: Record<string, string> = {}
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    const r = await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values ('portal', 'Portal ${who}', 'paused', '${office}') returning project_id`,
    )
    proj[who] = (r.rows[0] as { project_id: string }).project_id
  }
  const jar = (who: 'A' | 'B') =>
    JSON.stringify([
      {
        name: 's',
        value: `FAKE-NOT-A-REAL-COOKIE-${who}-${c.canary[who]}`,
        domain: SITE,
      },
    ])

  // ---- the writers file the session under the caller's own project ------------------------------------------------------
  const est = {} as Record<string, { ok?: boolean; session_id?: string; error?: string }>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    est[who] = (await c.exec(
      S,
      `select public.browser_session_establish(${q(office)}, '${proj[who]}', ${lit(SITE)}, ${lit(`${c.canary[who]} read the trade prices`)}, ${lit(jar(who))})`,
    )) as { ok?: boolean; session_id?: string; error?: string }
  }
  c.check(
    est.A?.ok === true && est.B?.ok === true,
    'A and B each sign in to the same site from a project both call "portal"',
    c.json([est.A?.ok, est.B?.ok]),
  )
  const sessionRow = async (who: string) =>
    (
      await c.db.execute(
        `select s.credential_ref::text as ref, s.project_id, s.established_by, s.revoked_at is not null as revoked,
                md5(v.decrypted_secret) as jarhash, p.office_id
           from public.browser_sessions s join public.projects p using (project_id)
           left join vault.decrypted_secrets v on v.id = s.credential_ref::uuid
          where s.session_id = '${est[who]?.session_id ?? c.nobody()}'`,
      )
    ).rows[0] as
      | {
          ref: string | null
          project_id: string
          established_by: string
          revoked: boolean
          jarhash: string | null
          office_id: string
        }
      | undefined
  const sa = await sessionRow('A')
  const sb = await sessionRow('B')
  c.check(
    sa?.office_id === A &&
      sb?.office_id === B &&
      sa?.project_id === proj.A &&
      sb?.project_id === proj.B,
    "each session hangs under its own office's project",
    '',
  )
  c.check(
    sa?.ref !== null && sb?.ref !== null && sa?.ref !== sb?.ref && sa?.jarhash !== sb?.jarhash,
    'each session holds its own, different credential in the Vault',
    '',
  )
  c.check(
    sa?.established_by !== 'grant' || A === c.G,
    'a session is not stamped with the literal actor "grant" for a person who is not Grant',
    String(sa?.established_by),
  )

  // ---- a browsing ledger and a live job in each office --------------------------------------------------------------------
  for (const [office, who, ms] of [
    [A, 'A', 60000],
    [B, 'B', 120000],
  ] as const) {
    await c.db.execute(
      `insert into public.browser_actions (office_id, session_id, project_id, verb, url, ok, ms)
       values ('${office}', '${est[who]?.session_id}', '${proj[who]}', 'read', 'https://${SITE}/${low(c.canary[who])}', true, ${String(ms)})`,
    )
    await c.db.execute(
      `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, project_id, office_id, pinned_config)
       values (gen_random_uuid(), 'atk-browse-${who}-${low(c.canary[who])}', 'browser.gather', 'telegram:${who === 'A' ? '1001' : '1002'}',
               '${proj[who]}', '${office}', jsonb_build_object('url', 'https://${SITE}/${low(c.canary[who])}'))`,
    )
  }

  // ---- readers: A sees A's, never B's; and a foreign project is a missing project ----------------------------------------
  const same = (what: string, foreign: string, missing: string) =>
    c.check(
      foreign === missing,
      `${what}: B's id and a nonexistent id are indistinguishable to A`,
      foreign === missing
        ? foreign.slice(0, 80)
        : `${foreign.slice(0, 60)} vs ${missing.slice(0, 60)}`,
    )
  const sessA = c.json(await c.exec(S, `select public.browser_sessions_for(${q(A)}, '${proj.A}')`))
  c.check(
    sessA.includes(c.canary.A) && !sessA.includes(c.canary.B),
    "browser_sessions_for: A's session is listed (with A's purpose) and B's is not",
    '',
  )
  same(
    'browser_sessions_for',
    c.json(await c.exec(S, `select public.browser_sessions_for(${q(A)}, '${proj.B}')`)),
    c.json(await c.exec(S, `select public.browser_sessions_for(${q(A)}, '${c.nobody()}')`)),
  )
  const lateA = c.json(await c.exec(S, `select public.browser_lately(${q(A)}, null)`))
  c.check(
    lateA.includes(low(c.canary.A)) && !lateA.includes(low(c.canary.B)),
    "browser_lately: A's whole ledger holds A's page and never B's",
    '',
  )
  same(
    'browser_lately',
    c.json(await c.exec(S, `select public.browser_lately(${q(A)}, '${proj.B}', 10)`)),
    c.json(await c.exec(S, `select public.browser_lately(${q(A)}, '${c.nobody()}', 10)`)),
  )
  const nowA = c.json(await c.exec(S, `select public.browser_now(${q(A)}, '${proj.A}')`))
  c.check(
    nowA.includes(low(c.canary.A)) && !nowA.includes(low(c.canary.B)),
    "browser_now: A sees A's running job and not B's",
    '',
  )
  same(
    'browser_now',
    c.json(await c.exec(S, `select public.browser_now(${q(A)}, '${proj.B}')`)),
    c.json(await c.exec(S, `select public.browser_now(${q(A)}, '${c.nobody()}')`)),
  )
  const budA = (await c.exec(S, `select public.browser_budget(${q(A)})`)) as {
    actions_today: number
    used_minutes: number
  }
  const budB = (await c.exec(S, `select public.browser_budget(${q(B)})`)) as {
    actions_today: number
    used_minutes: number
  }
  c.check(
    budA.actions_today === 1 &&
      budB.actions_today === 1 &&
      budA.used_minutes === 1 &&
      budB.used_minutes === 2,
    'browser_budget: each office is charged for its own browsing only (1 and 2 minutes, not 3)',
    `${c.json(budA).slice(0, 60)} ${c.json(budB).slice(0, 60)}`,
  )

  // ---- writers across the line: establish over B's project, forget B's session -----------------------------------------------
  const snapB = async () =>
    `${await c.snapshot(B, ['browser_actions', 'mcp_providers', 'jobs'])}|${c.json((await sessionRow('B')) ?? null)}|${String(
      (
        await c.db.execute(
          `select md5(coalesce(string_agg(name || decrypted_secret, '|' order by name), '-')) as h from vault.decrypted_secrets where name like 'browser.session.${proj.B}.%'`,
        )
      ).rows[0]?.h,
    )}`
  const before = await snapB()
  const foreignEst = c.json(
    await c.exec(
      S,
      `select public.browser_session_establish(${q(A)}, '${proj.B}', ${lit(SITE)}, ${lit('attacker wants to replace it')}, ${lit(jar('A'))})`,
    ),
  )
  const missingEst = c.json(
    await c.exec(
      S,
      `select public.browser_session_establish(${q(A)}, '${c.nobody()}', ${lit(SITE)}, ${lit('attacker wants to replace it')}, ${lit(jar('A'))})`,
    ),
  )
  same('browser_session_establish', foreignEst, missingEst)
  const foreignForget = c.json(
    await c.exec(S, `select public.browser_session_forget(${q(A)}, '${est.B?.session_id}')`),
  )
  const missingForget = c.json(
    await c.exec(S, `select public.browser_session_forget(${q(A)}, '${c.nobody()}')`),
  )
  same('browser_session_forget', foreignForget, missingForget)
  c.check(
    before === (await snapB()),
    "B's session, its ledger, and the Vault secret behind it are byte-identical after A attacked",
    '',
  )

  // ---- own-office forget works, and removes only A's secret --------------------------------------------------------------------
  const forgot = (await c.exec(
    S,
    `select public.browser_session_forget(${q(A)}, '${est.A?.session_id}')`,
  )) as {
    ok?: boolean
  }
  const afterA = await sessionRow('A')
  c.check(
    forgot.ok === true && afterA?.revoked === true && afterA?.ref === null,
    "A forgets A's own session: revoked, reference cleared",
    '',
  )
  c.check(before === (await snapB()), "and B's session is untouched by it", '')

  // ---- MCP: the same provider name in both offices ------------------------------------------------------------------------
  const reg = {} as Record<string, { ok?: boolean; provider?: string; error?: string }>
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    reg[who] = (await c.exec(
      S,
      `select public.register_mcp_provider(${q(office)}, 'acme', 'https://acme.example.test/mcp', 'Acme ${who}')`,
    )) as { ok?: boolean; provider?: string; error?: string }
  }
  c.check(
    reg.A?.ok === true && reg.B?.ok === true && reg.A?.provider !== reg.B?.provider,
    'A and B each register a provider called "acme"',
    c.json([reg.A?.ok, reg.B?.ok]),
  )
  const twice = c.json(
    await c.exec(
      S,
      `select public.register_mcp_provider(${q(A)}, 'acme', 'https://acme.example.test/mcp')`,
    ),
  )
  c.check(
    twice.includes('already registered'),
    'and a second "acme" in the SAME office is refused',
    twice.slice(0, 80),
  )
  const jobs = (
    await c.db.execute(
      `select j.office_id, j.pinned_config ->> 'provider_id' as pid from public.jobs j
        where j.kind = 'mcp.discover' and j.pinned_config ->> 'provider_id' in ('${reg.A?.provider}', '${reg.B?.provider}')`,
    )
  ).rows as { office_id: string; pid: string }[]
  c.check(
    jobs.length === 2 && jobs.every((j) => j.office_id === (j.pid === reg.A?.provider ? A : B)),
    'each discovery job is filed under the office that registered the provider',
    `${String(jobs.length)} job(s)`,
  )
  const insp = async (provider: string, names: string[]) =>
    c.db.execute(
      `select app.record_mcp_tools('${provider}', ${lit(
        JSON.stringify(
          names.map((n) => ({
            name: n,
            description: n.startsWith('delete') ? 'Permanently remove a record' : `Do ${n}`,
          })),
        ),
      )}::jsonb)`,
    )
  await insp(reg.A?.provider ?? '', [
    `search_${tag.A}`,
    'shared_tool',
    'delete_contact',
    'frobnicate',
  ])
  await insp(reg.B?.provider ?? '', [`search_${tag.B}`, 'shared_tool'])
  const dtool = async (provider: string, name: string) =>
    String(
      (
        await c.db.execute(
          `select discovered_id from public.mcp_discovered_tools where provider_id = '${provider}' and external_name = ${lit(name)}`,
        )
      ).rows[0]?.discovered_id,
    )
  const tpHash = async () =>
    String(
      (
        await c.db.execute(
          `select md5(coalesce(string_agg(x::text, '|' order by x::text), '-')) as h from public.tool_permissions x`,
        )
      ).rows[0]?.h,
    )

  // A cannot offer, or learn of, B's discovered tool
  const bSearch = await dtool(reg.B?.provider ?? '', `search_${tag.B}`)
  const tpBefore = await tpHash()
  const foreignOffer = c.json(
    await c.exec(S, `select public.offer_mcp_tool(${q(A)}, '${bSearch}')`),
  )
  const missingOffer = c.json(
    await c.exec(S, `select public.offer_mcp_tool(${q(A)}, '${c.nobody()}')`),
  )
  same('offer_mcp_tool', foreignOffer, missingOffer)
  const bAfter = (
    await c.db.execute(
      `select offered_as from public.mcp_discovered_tools where discovered_id = '${bSearch}'`,
    )
  ).rows[0] as { offered_as: string | null }
  c.check(
    bAfter.offered_as === null && tpBefore === (await tpHash()),
    "A's attempt filed nothing for B and added no row to the capability catalogue",
    '',
  )

  // destructive stays level 3, disabled, and can never be covered by a standing authorization
  const del = (await c.exec(
    S,
    `select public.offer_mcp_tool(${q(A)}, '${await dtool(reg.A?.provider ?? '', 'delete_contact')}')`,
  )) as { ok?: boolean; tool?: string; level?: number; enabled?: boolean }
  c.check(
    del.ok === true && del.level === 3 && del.enabled === false,
    'a destructive tool is offered at level 3 and disabled',
    c.json(del).slice(0, 90),
  )
  const standing = await c.try_(
    S,
    `insert into public.standing_authorizations (office_id, tool, reason, granted_by) values (${q(A)}, ${lit(del.tool ?? '')}, 'attack', 'a')`,
  )
  c.check(
    !standing.ok && standing.error.includes('level-3'),
    'and it cannot be covered by a standing authorization',
    standing.ok ? 'ACCEPTED' : standing.error.slice(0, 90),
  )
  const unk = (await c.exec(
    S,
    `select public.offer_mcp_tool(${q(A)}, '${await dtool(reg.A?.provider ?? '', 'frobnicate')}')`,
  )) as { level?: number }
  c.check(
    unk.level === 2,
    'an unclassifiable tool is still treated as a write (level 2)',
    c.json(unk).slice(0, 60),
  )

  // the same discovered name in both offices does not collide in the one catalogue
  const aShared = (await c.exec(
    S,
    `select public.offer_mcp_tool(${q(A)}, '${await dtool(reg.A?.provider ?? '', 'shared_tool')}')`,
  )) as { ok?: boolean; tool?: string }
  const bShared = (await c.exec(
    S,
    `select public.offer_mcp_tool(${q(B)}, '${await dtool(reg.B?.provider ?? '', 'shared_tool')}')`,
  )) as { ok?: boolean; tool?: string }
  c.check(
    aShared.ok === true && bShared.ok === true && aShared.tool !== bShared.tool,
    "B's tool of the same name gets its own catalogue name, not A's",
    `${String(aShared.tool)} / ${String(bShared.tool)}`,
  )
  const owners = (
    await c.db.execute(
      `select d.offered_as, p.office_id from public.mcp_discovered_tools d join public.mcp_providers p using (provider_id)
        where d.offered_as in ('${aShared.tool}', '${bShared.tool}')`,
    )
  ).rows as { offered_as: string; office_id: string }[]
  c.check(
    owners.find((o) => o.offered_as === aShared.tool)?.office_id === A &&
      owners.find((o) => o.offered_as === bShared.tool)?.office_id === B,
    'each offered tool is filed under its own provider',
    '',
  )
  const taken = c.json(
    await c.exec(
      S,
      `select public.offer_mcp_tool(${q(B)}, '${await dtool(reg.B?.provider ?? '', `search_${tag.B}`)}', ${lit(aShared.tool ?? '')})`,
    ),
  )
  c.check(
    taken.includes('already taken'),
    "B cannot name its tool after A's capability, or after a built-in, by asking for the name",
    taken.slice(0, 80),
  )
  const builtin = (
    await c.db.execute(
      `select tool from public.tool_permissions where delivered_by is null or delivered_by not like 'mcp:%' limit 1`,
    )
  ).rows[0] as { tool: string }
  const takenBuiltin = c.json(
    await c.exec(
      S,
      `select public.offer_mcp_tool(${q(B)}, '${await dtool(reg.B?.provider ?? '', `search_${tag.B}`)}', ${lit(builtin.tool)})`,
    ),
  )
  c.check(
    takenBuiltin.includes('already taken'),
    'nor after a built-in capability',
    takenBuiltin.slice(0, 80),
  )

  // enabling A's tool must not make B's inventory say its own is usable, and revoking in B must not switch A's off
  await c.db.execute(
    `update public.tool_permissions set enabled = true, disabled_reason = null where tool = '${aShared.tool}'`,
  )
  const invA = c.json(await c.exec(S, `select public.mcp_inventory(${q(A)})`))
  const invB = c.json(await c.exec(S, `select public.mcp_inventory(${q(B)})`))
  c.check(
    invA.includes(tag.A) && !invA.includes(tag.B) && invB.includes(tag.B) && !invB.includes(tag.A),
    "mcp_inventory: each office lists its own provider's tools and never the other's",
    '',
  )
  const usableOf = (inv: string): number => {
    const arr = JSON.parse(inv) as { usable: number }[]
    return arr[0]?.usable ?? -1
  }
  c.check(
    usableOf(invA) === 1 && usableOf(invB) === 0,
    "A's approval of its tool does not make B's provider look usable",
    `A ${String(usableOf(invA))}, B ${String(usableOf(invB))}`,
  )

  const foreignRevoke = c.json(
    await c.exec(S, `select public.revoke_mcp_provider(${q(A)}, '${reg.B?.provider}', 'attack')`),
  )
  const missingRevoke = c.json(
    await c.exec(S, `select public.revoke_mcp_provider(${q(A)}, '${c.nobody()}', 'attack')`),
  )
  same('revoke_mcp_provider', foreignRevoke, missingRevoke)
  const bProv = (
    await c.db.execute(
      `select enabled, revoked_at from public.mcp_providers where provider_id = '${reg.B?.provider}'`,
    )
  ).rows[0] as { enabled: boolean; revoked_at: string | null }
  c.check(
    bProv.enabled === true && bProv.revoked_at === null,
    "B's provider is still connected after A tried to revoke it",
    '',
  )
  const bRevoke = (await c.exec(
    S,
    `select public.revoke_mcp_provider(${q(B)}, '${reg.B?.provider}', 'done')`,
  )) as {
    ok?: boolean
  }
  const stillOn = (
    await c.db.execute(`select enabled from public.tool_permissions where tool = '${aShared.tool}'`)
  ).rows[0] as { enabled: boolean }
  c.check(
    bRevoke.ok === true && stillOn.enabled === true,
    'B revokes its own "acme"; A\'s "acme" capability stays on (revoke follows the provider, not its name)',
    '',
  )
  const aRevoke = (await c.exec(
    S,
    `select public.revoke_mcp_provider(${q(A)}, '${reg.A?.provider}', 'done')`,
  )) as {
    ok?: boolean
    tools_disabled?: number
  }
  c.check(
    aRevoke.ok === true && (aRevoke.tools_disabled ?? 0) >= 1,
    'A revokes its own provider and its enabled tool is switched off',
    c.json(aRevoke).slice(0, 80),
  )
  const offDisc = c.json(
    await c.exec(
      S,
      `select public.offer_mcp_tool(${q(B)}, '${await dtool(reg.B?.provider ?? '', `search_${tag.B}`)}')`,
    ),
  )
  c.check(
    offDisc.includes('disconnected'),
    'offering from a disconnected provider is refused',
    offDisc.slice(0, 70),
  )

  // ---- a credential reference may only be one the office already holds ------------------------------------------------------------
  const secret = (
    await c.db.execute(
      `select app.store_secret('mcp.provider.attack.${c.canary.B}', 'FAKE-BEARER-NOT-REAL', 'attack fixture')::text as ref`,
    )
  ).rows[0] as { ref: string }
  await c.db.execute(
    `insert into public.mcp_providers (office_id, name, endpoint, auth_kind, credential_ref) values ('${B}', 'withkey', 'https://key.example.test/mcp', 'bearer', '${secret.ref}')`,
  )
  const stolen = c.json(
    await c.exec(
      S,
      `select public.register_mcp_provider(${q(A)}, 'stolen', 'https://evil.example.test/mcp', '', 'bearer', '${secret.ref}')`,
    ),
  )
  const invented = c.json(
    await c.exec(
      S,
      `select public.register_mcp_provider(${q(A)}, 'invented', 'https://evil.example.test/mcp', '', 'bearer', '${c.nobody()}')`,
    ),
  )
  same('register_mcp_provider with a credential of B', stolen, invented)
  const ownKey = (await c.exec(
    S,
    `select public.register_mcp_provider(${q(B)}, 'second', 'https://key.example.test/mcp', '', 'bearer', '${secret.ref}')`,
  )) as { ok?: boolean }
  c.check(
    ownKey.ok === true,
    'B can reuse a credential its own provider already holds (positive control)',
    '',
  )
  const noneRegistered = (
    await c.db.execute(
      `select count(*)::int as n from public.mcp_providers where office_id = '${A}' and name in ('stolen','invented')`,
    )
  ).rows[0] as { n: number }
  c.check(noneRegistered.n === 0, 'and nothing was registered for A by the attempts', '')

  // ---- hq_mcp: A's clients and calls only ------------------------------------------------------------------------------------------
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    const cid = `client-${low(c.canary[who])}`
    await c.db.execute(
      `insert into public.mcp_clients (client_id, display_name, token_sha256, office_id) values ('${cid}', 'Desk ${low(c.canary[who])}', '${'ab'
        .repeat(32)
        .slice(0, 62)}${who === 'A' ? '01' : '02'}', '${office}')`,
    )
    await c.db.execute(
      `insert into public.mcp_calls (client_id, tool, outcome) values ('${cid}', 'tool_${low(c.canary[who])}', 'ok')`,
    )
  }
  const hqA = c.json(await c.exec(S, `select public.hq_mcp(${q(A)})`))
  c.check(
    hqA.includes(tag.A) && !hqA.includes(tag.B),
    "hq_mcp: A's clients and calls are listed, B's are not",
    '',
  )
  c.check(
    !hqA.includes(String(bShared.tool)) && hqA.includes(String(aShared.tool)),
    "hq_mcp: the catalogue lists A's provider tools and not B's, and still lists the built-ins",
    '',
  )
  c.check(
    hqA.includes(builtin.tool),
    'hq_mcp keeps the built-in capabilities in its list (positive control)',
    '',
  )

  // ---- no office, no work; the doors are shut to the browser's own roles -----------------------------------------------------------
  const calls: [string, string][] = [
    ['browser_budget', `(%O)`],
    ['browser_lately', `(%O, null)`],
    ['browser_now', `(%O, '${proj.A}')`],
    ['browser_sessions_for', `(%O, '${proj.A}')`],
    [
      'browser_session_establish',
      `(%O, '${proj.A}', ${lit(SITE)}, 'a purpose that is long enough', '[1,2]')`,
    ],
    ['browser_session_forget', `(%O, '${c.nobody()}')`],
    ['hq_mcp', `(%O)`],
    ['mcp_inventory', `(%O)`],
    ['offer_mcp_tool', `(%O, '${c.nobody()}')`],
    ['register_mcp_provider', `(%O, 'nobody', 'https://x.example.test/mcp')`],
    ['revoke_mcp_provider', `(%O, '${c.nobody()}')`],
  ]
  for (const [fn, args] of calls) {
    for (const [what, office] of [
      ['a null office', 'null::uuid'],
      ['an office that does not exist', `${lit(c.nobody())}::uuid`],
    ] as const) {
      const msg = await c.refusal(S, `select public.${fn}${args.replace('%O', office)}`)
      c.check(msg.includes('no_office'), `${fn}: ${what} is refused`, msg.slice(0, 70))
    }
    for (const role of callerRoles) {
      const msg = await c.refusal(role, `select public.${fn}${args.replace('%O', q(A))}`)
      c.check(msg.includes('permission denied'), `${fn}: ${role} cannot call it`, msg.slice(0, 70))
    }
  }

  // ---- and the bridge was not needed -------------------------------------------------------------------------------------------------
  const bridgeAfter = (
    await c.db.execute(
      `select coalesce(sum(n),0)::int as n from public.office_bridge_use
        where table_name in ('browser_sessions','browser_actions','mcp_providers','mcp_discovered_tools','jobs','mcp_clients')`,
    )
  ).rows[0] as { n: number }
  c.check(
    bridgeAfter.n === bridgeBefore.n,
    'the converted integration writers never relied on the compatibility bridge',
    `bridge uses before ${String(bridgeBefore.n)}, after ${String(bridgeAfter.n)}`,
  )
}
