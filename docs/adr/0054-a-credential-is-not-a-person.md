# ADR-0054 — A credential is not a person; a test principal decides only test traffic; a sender is admitted; an approval applies to exactly what it approved

**Status:** accepted (Architecture Run 3). Migrations 0613–0617.

## Context
Run 2 established what an action is allowed to do (`app.authorize_effect`). It said in its own
Consequences that the answer is only as good as *who is asking*, and named four debts: the bearer token
is attributed as `grant` (#385), the other ~250 `public` functions are open to the public key (#384),
the effect doors are not all behind the boundary (#386), and Slack has no sender authorization (#388).
Reconnaissance for Run 3 (the trust graph, ingress to effect) found the four were one problem in four
places: the office let a *credential* stand where a *person* should.

Concretely, read from code and confirmed against production before anything changed:
- `hq-api` returned principal `grant` for anyone presenting `hq.api_token`. That key decided, approved,
  granted, revoked, reopened a No and set autonomy as Grant.
- `signin` `link_for_operator` minted a real session for **any member's address** with that same key, and the
  only member was Grant. The key could *become him*.
- `voice` wrote actor `grant` for the key, so a turn from a script read as an instruction from the person
  (which is what turns "ask first" into "he asked for it").
- 249 of 276 security-definer functions in `public` were executable with the anon key, which is public by
  design. They included `vault_secret` (a named credential), `callback_ack` (a Telegram bot token),
  `register_mcp_provider` (make the office send a vault-held bearer to a caller-named endpoint) and
  `hq_revoke_tool` (revoke as `grant`). Nothing used the anon key against PostgREST at all.
- Slack admitted every correctly signed event, from any workspace member or Connect guest, as a trusted
  instruction from `slack:<their id>`.
- The two doors that start work by answering a question (`notebook.generate`, `office.execute_plan`) were
  gated by the *presence* of `approved_by` in a job's config, or not at all.
- A Telegram/Slack button resolved "the newest open question on that job **at press time**", so a stale
  button approved a question its message never showed.

## Decision
1. **The office key is a machine, and names nobody.** The gateway's principal has a *kind*: `person` (a signed-in
   member), `harness` (a signed-in *test* member) or `service` (the key). The key has no principal to write, so every
   function that needs an answering person refuses it by name (0608's mechanism, now the only way it is treated).
   What it may still do is an **allow-list** (`SERVICE_MAY`): data a person owns and the shape of their screen. The
   default is no, so an action added tomorrow needs a person until somebody decides otherwise. 403 `person_required`,
   not 401: the credential is genuine, and the page must not sign anyone out over it.
2. **A test principal decides only test traffic** (`app.authority_refusal(p_by, p_job, p_project)`). The verification
   suites need a real signed-in way to drive the gateway, so the office lists a test member (`verify-operator`,
   `kind = 'harness'`), and `signin` mints a session for a test member *only*. The database lets that session decide
   only what is provably test traffic: a job `app.harness_job` owns, or a fixture project. A name carrying a harness prefix
   is a harness principal whatever row lists it (0304's asymmetry: the restrictive reading wins). Grant cannot be signed
   in as by a script; he signs in by mail.
3. **Every function through which a person decides takes the answering principal and refuses through the same
   function**: answering a question, taking a No back, approving or declining reach, granting or revoking a standing
   authorization, setting autonomy, granting or revoking a specialist's tool, approving or discarding a document, and
   *saying something* (`say_in_project`, `send_to_agent`, whose actor is now the verified principal, not `grant`).
4. **A voice turn is the credential's fact.** A person speaks as themself, a test member as itself, and the key only in a
   session already named as test, as `verify-service`.
5. **A sender is admitted.** Slack asks `public.sender_admitted` before it stores anything (the same list Telegram has used
   since 0607); `app.enqueue_inbound` refuses a Slack command with no resolved subject unless it is synthetic; a stranger's
   button press is stored nowhere, and undo and feedback need a known presser. A failure to *ask* is 503, never a
   refusal (Slack retries; a retry after the lookup recovers is admitted).
6. **The public key reaches no function.** Every function in `public` is closed to `PUBLIC`, `anon` and `authenticated`
   and open to `service_role`; the office's own role keeps what it had. An event trigger closes a new `public` function at
   birth (a schema-scoped `ALTER DEFAULT PRIVILEGES` cannot remove the built-in PUBLIC default), and `npm run check:anon-exposure`
   is the witness, in the gate.
7. **An approval applies to exactly what it approved, and the handler checks.** A question raised to start
   `notebook.generate` or `office.execute_plan` carries the fingerprint of the *material* of the request (kind and
   instructions; the steps) — a whitelist, because a job's config also collects retry notes. The handler asks
   `app.approval_verdict(job)` — is the question real, answered yes by a person, on the job that asked, not taken back, and
   still about this — and then `mayAct`, because a yes does not outrank a dial that says observe. A client cannot bring an
   approval with it (`mcp_enqueue` strips the keys).
8. **A button answers the question its message showed** (`app.approval_for_delivery`): the latest question on the delivery's
   job created at or before the delivery was sent. A question raised later cannot be answered by an earlier message.
9. **An effect that cannot be undone is claimed before it is made.** `claimExternal`/`beginStep` (the checkpoint engine Run 2
   already relied on): an attempt Google *refused* is finished as failed and the next attempt claims the next name; an
   attempt that may have reached Google is left open, and the retry parks for a person. Applied to generation, adding a
   source, pushing a document, each step of a plan that creates a notebook, and the vault export.

## What this does not decide
- It does not make the *system duties* ask. `tasks.sync`, `office.provision_channels`, `office.notion_import` and
  `office.slack_rotate` perform level-2 external writes unprompted today; under `suggest` the matrix would ask. Moving
  them behind `authorize_effect` would start asking Grant questions he has not been asked, or require standing
  authorizations recorded in his name, which is not this run's to invent. They stay containment-gated, and #389 records
  exactly what each does and what he must decide.
- It does not put the DB-level `p_by` requirement on every gateway-only function; the gateway gate is the primary guard for
  the setters not yet listed (#390).

## Consequences
- A browser that still holds only the old key can read, and gets a plain message on anything that decides. He signs in.
  If mail is not working, the recovery is the Supabase dashboard, not the office key.
- The verification suites sign in as the test member and reach real projects only for what a test member may decide.
  What cannot be proved live is Grant's own session approving; that is proved through the real handler in the isolated suites.
- New `public` functions are closed at creation. A migration that wants another role to have one grants it afterwards.

## What would reverse this
A `principal` of `'grant'` (or any person) written for the key; an action added to `SERVICE_MAY` that decides, speaks, reaches
or connects; `link_for_operator` minting for a person; a harness principal allowed with no context; a Slack event stored before
`sender_admitted`; a handler that acts on a job's *claim* of approval instead of the question; a button resolved by "newest open".
`tests/architecture/office-key-is-a-machine.test.ts` and the isolated suites fail on each.
