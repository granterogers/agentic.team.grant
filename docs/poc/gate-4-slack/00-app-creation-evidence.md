# Gate 4 evidence — app creation (partial)

> **Superseded.** Gate 4 now **PASSES** — see
> [`01-evidence.md`](01-evidence.md), 19/19 checks on 2026-09-03. This file is
> kept as the record of the app-creation step it describes.

**Gate 4 was not passed at the time this was written.** This records only the automated app-creation step,
completed ahead of the gate because the config token was near expiry. The gate
itself runs in Phase 3 and requires everything in
`AI_TEAM_HQ_MASTER_SPEC.md` §13.

---

## Environment

| | |
|---|---|
| Date | 2026-09-02, 22:03–22:32 UTC |
| Environment | Claude Code cloud session, `claude/new-session-o2oklu` |
| Credential | `SLACK_APP_CONFIG_TOKEN` (user+workspace scoped, 12h lifetime) |
| APIs | `apps.manifest.validate`, `apps.manifest.create`, `apps.manifest.export` |

## Steps and results

### 1. Validate before create

`POST apps.manifest.validate` → **`{"ok": true, "errors": []}`**

Validation was run first deliberately: a rejected manifest partway through a
multi-app rollout is a partial-state problem worth never creating.

### 2. Create

`POST apps.manifest.create` → **`ok: true`**, app ID **`A0BUFRVSSLD`**.
Returned `client_id`, `client_secret`, `signing_secret`, `verification_token`.

**Secrets were not committed.** They remain retrievable from the Slack app page,
so withholding them costs nothing.

### 3. Independent verification

`POST apps.manifest.export` on the created app — **read-back confirms
configuration matches intent**, rather than trusting the create response:

| Property | Expected | Actual |
|---|---|---|
| name | AI Team HQ | ✅ AI Team HQ |
| `socket_mode_enabled` | `false` | ✅ `False` |
| `org_deploy_enabled` | `false` | ✅ `False` |
| event subscriptions | none yet | ✅ none |
| bot scopes | 17 | ✅ 17 |
| `chat:write.customize` | present | ✅ present |
| `connections:write` | **absent** | ✅ absent |

`chat:write.customize` is the load-bearing scope: it carries per-staff identity
presentation from a single shared app (ADR-0004). `connections:write` correctly
absent — Socket Mode is not used, so no `xapp-` token exists.

## Known limitations at this point

1. **Not installed.** Requires Grant's OAuth authorization; no bot token yet.
2. **No event subscriptions.** Deliberate — a request URL must be publicly
   reachable and answer Slack's verification challenge, and nothing is deployed.
   Added later via `apps.manifest.update`; the app does not need recreating.
3. **Config-token rotation not implemented.** Blocked on durable storage — see
   `docs/slack-app-status.md`.
4. **Identity presentation untested.** Cosmetic-only limits (not mentionable,
   not DM-able) are documented but not yet observed.

## Verdict

**Not a PASS.** App creation and configuration are automated and verified. The
gate's substance — install, auth, channel mapping, DM, threads, reactions, event
receipt, command normalization, rate limits, token revocation, reinstall,
Postgres remaining canonical, and Slack history loss not breaking the app —
remains untested.
