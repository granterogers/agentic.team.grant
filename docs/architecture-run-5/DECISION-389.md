# #389 - the decision Grant has to make, reduced to its smallest form

Not decided by anyone. Nothing here was chosen on his behalf; the text records the options and which is technically
safest.

## What happens today
Four kinds of work write outside the office **without anyone having asked for it that time**. A duty or the office
itself starts them; today they are held only by *containment* (`runJob` refuses harness or unknown-origin work), which
is a test of where the work came from, not a permission.

| Duty | What it writes | Reversible? | Retry hazard on record |
|---|---|---|---|
| `tasks.sync` | Vikunja tasks: create, update, **delete**, plus the inbound pull | delete is not | a crash between the remote upsert and `task_pushed` duplicates the remote task |
| `office.provision_channels` / `office.rename_channels` | Slack channel create, invite, rename | **no** (Slack cannot delete a channel) | none recorded |
| `office.notion_import` | Notion pages and relations in an attached database | manual only | none recorded |
| `office.slack_rotate` | rotates the Slack config token at Slack | no | failure after rotate and before the vault store loses the pair (a pre-rotation copy is stored first) |

## Why it is a decision and not a fix
Putting each behind `app.authorize_effect` is mechanical (`mayWrite` / `governOutward` at the top of the handler with
the fingerprint, plus a `claimExternal`). But a duty is not "asked for", so under the default `suggest` dial the
answer is **ask** - Grant would start being asked questions he has never been asked, e.g. *Create #x in Slack?* for
every new project, fifteen minutes after it is created. Turning it into "proceed" is a standing authorization, and
that must be **his** press: attributing one to him that he did not give would forge the very approval identity Run 3
exists to protect.

## The options (per duty; three, no more)
| Option | What it does | What it changes for him | Risk |
|---|---|---|---|
| **A. Keep unprompted; record why** | nothing runs differently; the reason is written on the Governance page | no new questions | the duty can still do an irreversible thing on a wrong premise; only containment stands between a bad input and the write |
| **B. Ask each time** | handler asks through `authorize_effect`; a No is remembered for `approval.refusal_days` | one question per occurrence (a new project, a sync with deletes, a rotation) | the duty stalls until he answers; a dead approval means silent non-provisioning |
| **C. Standing authorization (his press)** | same gate; his one press on the Governance page lets the duty proceed without asking, revocable | one press, then silence | authority is granted at the level of the tool (not the fingerprint); a later, broader use of the same tool is covered |

## Which is technically safest
- `office.provision_channels` / `rename_channels` and `office.slack_rotate` (irreversible, externally visible): **B**.
  A standing authorization on an irreversible create is the case where a wrong premise costs most.
- `tasks.sync` with deletes: **B for deletes, C for create/update** would be the finer split, but the gate is per
  tool, not per verb, so today the choice is **B** for the whole duty or **C** with the delete risk accepted.
- `office.notion_import` (writes only to an attached database Grant attached): **C** is defensible because the
  attachment was already his act - but that attachment is itself ungated (#393), so **decide #393 first**.

This is a recommendation about risk, not a decision. The migration for whichever combination he chooses is
mechanical and is not started.
