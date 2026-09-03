# Phase 1 evidence — Slack credentials are references, not values

**Date:** 2026-09-03 · **Reproduce:** `npm run verify:credentials`

§15 requires Slack per-app credentials in Postgres, one row per app, never a
flat environment variable — because with multiple bot identities there is no
correct value for a single `SLACK_BOT_TOKEN`, and because the config token pair
rotates roughly every twelve hours, so a static store cannot hold it at all.
§6 adds: store secret **references** only.

## The claim being proved

Not that we remembered to store a reference. That storing a value is
**impossible**. Every credential column is typed `app.vault_secret_ref`, a
domain over `uuid`, so a Slack token is rejected by the type system:

```
22P02: invalid input syntax for type uuid: "xoxb-a-real-looking-token"
```

That is stronger than a naming convention or a code review, both of which
eventually lose.

## Result

| check | outcome | |
|---|---|---|
| store_secret returns a uuid reference, not a value | ref = 08d4f4c7… | ✅ |
| the vault stores ciphertext, not the plaintext | differs=true stored_len=93 vs plaintext_len=35 | ✅ |
| resolve_secret returns the original plaintext | round_trips=true | ✅ |
| rotation reuses the same reference and updates the value behind it | same_ref=true new_value_visible=true | ✅ |
| storing an empty secret is refused | refused with 22023: 22023: refusing to store an empty secret as probe_empty_mtle06cm | ✅ |
| a Slack token cannot be written into a credential column at all | refused with 22P02: 22P02: invalid input syntax for type uuid: "xoxb-a-real-looking-token" | ✅ |
| a dangling reference is refused rather than stored | refused with 23503: 23503: slack_app_credentials.bot_token_ref references vault secret 00b492d2-9f72-498e-af63-36226d2d5 | ✅ |
| a row with a valid reference is accepted | succeeded, as required | ✅ |
| disabling an integration without a reason is refused (§8) | refused with 23514: 23514: new row for relation "slack_app_credentials" violates check constraint "slack_disabled_has_re | ✅ |
| disabling with a reason works, without taking anything else offline | succeeded, as required | ✅ |
| re-enabling clears the disabled state | succeeded, as required | ✅ |
| a revoked install cannot also be enabled | refused with 23514: 23514: new row for relation "slack_app_credentials" violates check constraint "slack_revoked_is_disa | ✅ |
| the application role has NO direct vault access | schema_usage=false raw=false decrypted=false | ✅ |
| but it can resolve a reference it was given (§15: only the connector layer) | execute on resolve_secret = true | ✅ |
| resolving works as the application role itself, via SECURITY DEFINER | resolved=true | ✅ |
| the application role cannot read the vault directly | refused with 42501: 42501: permission denied for schema vault | ✅ |
| RLS enabled and FORCED on slack_app_credentials | enabled=true forced=true | ✅ |
| no credential-shaped string in any text column of the table | 0 matches | ✅ |

18/18 checks passed

## Three details worth naming

**Rotation reuses the reference.** `store_secret` updates the value behind an
existing id rather than minting a new one, so every row pointing at it picks up
the new credential with no write of its own. That is what makes a twice-daily
rotation survivable rather than a twice-daily fan-out of updates.

**`resolve_secret` takes a reference, never a name.** A caller cannot enumerate
the vault or fish for a secret belonging to something else — it can only resolve
what a row already handed it. §15 says only the connector invocation layer
receives decrypted credentials; this function is that layer's single door, and
`SECURITY DEFINER` is what lets it work while the application role itself has
**no vault access at all** (no schema usage, no select on either table).

**A dangling reference is refused.** It is worse than a missing one: the row
looks configured and fails only when the credential is needed, which is when
something is already going wrong. Postgres cannot express this as a `CHECK`, and
a foreign key into `vault.secrets` would couple this schema to a
Supabase-internal table that may be reshaped without notice — so a trigger
validates every non-null reference resolves.
