# Credential verification — 2026-09-03

**Environment:** Claude Code cloud session container (Linux 6.18, psql 16.13,
node 22.22.2, python 3.11). Container created **after** Grant added
`SUPABASE_DB_URL`, `SLACK_BOT_TOKEN` and the OpenRouter credit, so unlike the
previous session it can see them.

**No secret value appears in this file.** Only pass/fail and non-secret metadata.

---

## Result summary

| Credential | Result | Method |
|---|---|---|
| `SUPABASE_DB_URL` | ❌ **UNUSABLE from this environment** | two independent causes, below |
| `SLACK_BOT_TOKEN` | ✅ **works** | `auth.test` → `ok: true` |
| `SLACK_SIGNING_SECRET` | ❌ **empty string** | variable exists, value length 0 |
| `SLACK_CLIENT_SECRET` | ❌ **not set** | absent from environment |
| `OPENROUTER_API_KEY` | ✅ **works, credited, capped** | `/api/v1/key` |

---

## ❌ `SUPABASE_DB_URL` — cannot connect, for two separate reasons

Non-secret metadata parsed from the URL:

```
scheme   postgresql
user     postgres
host     db.baujwlzcziasnfhhkchg.supabase.co
port     5432
dbname   postgres
```

`user=postgres` and host `db.<ref>.supabase.co` identify this as the
**Direct connection** string — *not* the Session pooler. A pooler URI would read
`postgres.<ref>@aws-N-<region>.pooler.supabase.com`.

### Cause 1 — the Direct connection is IPv6-only, and this container has no IPv6

```
getent hosts db.baujwlzcziasnfhhkchg.supabase.co
  → 2a05:d014:415:500:b339:fd05:2e68:edd2      (AAAA only, no A record)

socket.socket(AF_INET6, SOCK_STREAM)
  → OSError: [Errno 97] Address family not supported by protocol
```

IPv6 is not merely unrouted here — the address family is **absent from the
kernel's protocol support**. Supabase Free provides no IPv4 for Direct
connections (IPv4 is a paid add-on). So this string can never resolve to
something this container can dial.

`psql` reports this as a bare `psql: error:` with an empty message — which is
why the failure is not self-explaining.

### Cause 2 — this environment blocks all non-443 TCP egress anyway

Tested against the IPv4 Session-pooler host, which *does* have A records:

```
aws-0-us-east-1.pooler.supabase.com:5432  → TimeoutError (44.208.221.186)
aws-0-us-east-1.pooler.supabase.com:6543  → TimeoutError (44.216.29.125)
aws-0-us-east-1.pooler.supabase.com:443   → TCP OK        (52.45.94.125)
openrouter.ai:443                          → TCP OK
```

Same host, same route: **443 connects, 5432 and 6543 time out.** All outbound
traffic is forced through the session's policy-enforcing egress proxy, whose own
documentation (`/root/.ccr/README.md`) lists under *"Not supported through the
proxy (report, do not work around)"*:

> gRPC / HTTP/2-only APIs, WebSocket upgrades, client-mTLS, certificate-pinned
> clients, **non-443 HTTPS ports, raw-TCP databases**.

**This is the load-bearing finding.** Cause 1 is a wrong connection string and
Grant could fix it in two minutes. Cause 2 is environmental: **no Postgres
connection string of any kind — Direct, Session pooler, or Transaction pooler —
can work from a Claude Code cloud session.** Replacing the string does not help.

### It is specifically the *build* container that is constrained

The deployed runtime is unaffected. Vercel functions have ordinary egress and
will speak the Postgres wire protocol normally. The constraint applies only to
Claude Code build sessions — which is where migrations were assumed to run.
Recorded as [ADR-0007](../adr/0007-ddl-over-management-api.md).

### The HTTPS path that does work

Supabase's Management API executes arbitrary SQL over HTTPS:

```
POST https://api.supabase.com/v1/projects/baujwlzcziasnfhhkchg/database/query
  → 401 {"message":"Unauthorized"}
```

**Reachable through the proxy; only the token is missing.** A `401` rather than
a timeout is the whole point — the transport is fine, the credential is absent.
No `sbp_`-prefixed variable and no `SUPABASE_ACCESS_TOKEN` exists in the
environment.

### Escape hatches re-confirmed closed

- PostgREST executes no DDL by design.
- `POST /rest/v1/rpc/exec_sql` → `404 PGRST202`, function does not exist.
- Service-role key is valid: `GET /rest/v1/` → `200`.

---

## ✅ `SLACK_BOT_TOKEN` — works

`POST https://slack.com/api/auth.test`:

```
ok:                    true
team:                  Agentic Team Grant
team_id:               T0BUCJ2L5FD
url:                   https://agenticteamgrant.slack.com/
bot user:              ai_team_hq
user_id:               U0BUG0RPZ8B
bot_id:                B0BUN78DELS
is_enterprise_install: false
```

Granted scopes, from the `x-oauth-scopes` response header — **17, exactly the 17
requested in the install link**, none missing, none extra:

```
chat:write · chat:write.customize · channels:manage · channels:read
channels:history · groups:read · groups:history · im:read · im:write
im:history · mpim:read · mpim:history · reactions:read · reactions:write
users:read · team:read · files:write
```

`is_enterprise_install: false` and the app's absence from the marketplace
together confirm it is still an **internal custom app** — which preserves the
rate-limit exemption ADR-0004 depends on.

The app is installed. **Gate 4's install prerequisite is satisfied.**

---

## ❌ `SLACK_SIGNING_SECRET` — present but empty

The variable exists with a **zero-length value**. It is not the placeholder the
previous session saw; it is now blank. Shape test therefore fails: a real Slack
signing secret is 32 lowercase hex characters.

Cannot be functionally tested without an inbound signed request — but a
zero-length secret needs no test to be wrong. Without it, Slack request-signature
verification cannot be implemented, so no Slack event may be trusted.

`SLACK_CLIENT_SECRET` is absent entirely, and `SLACK_APP_TOKEN` is likewise an
empty string (only needed for Socket Mode, which §4 rejects — so that one is
correctly empty).

---

## ✅ `OPENROUTER_API_KEY` — works, matches the expected post-credit state

`GET https://openrouter.ai/api/v1/key`:

```
is_free_tier:        false     ← $10 credit landed; 1,000 req/day, not 50
is_provisioning_key: false
limit:               5
limit_remaining:     5
usage:               0
limit_reset:         None
```

Both expectations confirmed: `is_free_tier: false` and `limit: 5`. D2 Option B
is in force and enforcement layer 2 of ADR-0005 (a hard per-key spend cap) is
now actually present.

⚠️ `limit_reset: None` still means the $5 cap is **lifetime, not monthly**. At
Config B's ~$3/month the key stops around mid-October and will present as an
outage rather than a billing event. Unchanged from the previous session's note;
repeated because it has a date attached to it.
