# Account creation: a stranger opens their own office

Written 3 October 2026 (multi-user P6). One person, one private office. No organisations, memberships, invitations or
tenant switching. Sign-in is unchanged: passwordless, by an emailed link.

## The flow

1. A stranger enters an email on the page. `signin` action `link` asks Supabase to email a link (`create_user: true`).
2. They click it and return with a **verified** session (Supabase has confirmed the address).
3. Every `hq-api` request with that session answers **HTTP 403 `{"error":"no_office","can_create":true}`**. It is 403, not
   401, so the page keeps the session and offers "create your office". An unconfirmed address is still 401. A member whose
   office was retired is `{"error":"no_office"}` with no `can_create` (a retirement is a decision, not a missing step).
4. The page posts `{"action":"create_office","name":"<display name>"}` with the session as the bearer.
5. The gateway verifies the session with Supabase (`/auth/v1/user`, address must be confirmed), then calls
   `public.self_provision_office(p_auth, p_email, p_name)` with the **verified** id and address. The body supplies only a
   name: an auth id, email, owner key, office id or `args.p_office` in the body is never read.
6. The same session now resolves to the new office. The page reloads its sections; no second sign-in.

## Response shapes the page must handle

| Case | HTTP | Body |
|---|---|---|
| Read or write before an office, address verified | 403 | `{"error":"no_office","can_create":true}` |
| Same, office retired | 403 | `{"error":"no_office"}` |
| Session refused by Supabase / unconfirmed address on a read | 401 | `{"error":"unauthorized"}` |
| Could not check (Supabase throttled or down) | 503 | `{"error":"The office could not check who you are just now. Try again in a moment."}` (keep the session) |
| `create_office` created one | 200 | `{"ok":true,"created":true,"office_id":"..."}` |
| `create_office` repeated (idempotent) | 200 | `{"ok":true,"created":false,"office_id":"..."}` |
| `create_office`, refused (name 1 to 80 chars, closed signup, ceiling reached, retired login, address already a member) | 400 | `{"ok":false,"error":"<plain English sentence>"}` |
| `create_office`, address not confirmed | 403 | `{"ok":false,"error":"Please confirm your email address first, then try again."}` |
| `create_office`, not a session (no bearer, machine key, bad token) | 401 | `{"error":"unauthorized"}` |
| `create_office`, database unreachable | 503 | `{"ok":false,"error":"We could not set up your office just now. Please try again in a moment."}` |

Error strings are written for display; they never carry SQL detail.

## What the database guarantees (migration 0866)

* `app.self_provision_office` takes an advisory lock per auth uuid, so a double press or five concurrent calls create
  **exactly one** office; the rest return it with `created:false`.
* The owner key is `'u-' + the auth uuid without dashes`: derived from the login, never the email.
* It requires the `auth.users` row, a matching address and `email_confirmed_at`. A login whose office was retired is not
  given a new one. An address already in `office_members` is refused.
* It delegates to `app.provision_person_office` (0863): the three-row write, the narrower default grants (internal,
  reversible tools only) and the office's catch-all `unnamed` project. Nothing outward is granted by default.
* The wrapper `public.self_provision_office` is granted to `service_role` only.

## The two config switches (`public.system_config`)

| Key | Default | Meaning |
|---|---|---|
| `accounts.open_signup` | `true` | `false` closes self-service creation. Existing offices are unaffected. |
| `accounts.max_person_offices` | `25` | Ceiling on **active person offices** (free-tier guard). Raising it is the operator's decision. |

Both are changed through `set_setting` (operator only) or SQL. A missing row fails closed (signup refused).

## What is proved

* `tests/gateway/account-creation.test.ts` (12 tests, the real handler under a fake Supabase): unverified refused;
  verified non-member gets `can_create`; not cached as a yes; `create_office` derives everything from the session;
  idempotent; closed-signup refusal passed through; machine key refused; no database detail leaks.
* `npm run verify:account-lifecycle` (75 checks, class `sample`, real deployed gateway): three disposable people,
  `.invalid` addresses, per-run token. A and B read 403 `can_create`, create exactly one office each (also five concurrent
  calls), own owner key derives from the uuid, see only their own projects and tasks, cannot read or write each other's or
  Grant's or the Sample's by id, slug or spoofed office, cannot change a deployment setting. Closing signup and the
  ceiling each refuse and are restored; the same person is admitted once restored. Grant's and the Sample's offices are
  fingerprinted before and after and unchanged.

## What is NOT tested

Email delivery. The harness replaces the mailbox only: it asks the admin API for the link the mail would have carried and
exchanges it for a session. The mail itself, its template, Supabase's send rate limit and the `signin` `link` action are
not exercised (that would email someone). The page (`web/studio`) is covered by its own work.

## Teardown, and what it leaves

Projects the people made are deleted (`app.project_delete`). Offices are **retired** (`app.retire_person_office`), never
deleted. Because `offices.auth_user_id` is `ON DELETE RESTRICT`, an auth user with an office cannot be deleted, so the
harness **bans** each throwaway login (876000h) instead. Each run therefore leaves three disabled offices, three
`office_members` rows (`u-...`) and three banned `auth.users` rows on the `@lifecycle.agentic.invalid` domain. None is
active and none can sign in. The harness asserts that no office or project it made is still active, that active person
offices are back to the starting count, and that both switches are back.
