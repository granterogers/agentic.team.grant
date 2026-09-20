# Architecture Decision Records

One record per material decision, especially where this project departs from the
original specification. Each states the decision, why, what was rejected, and
what would reverse it.

Required by the Feasibility Audit Addendum §56.4. A decision reversed later gets
a **new** ADR superseding the old one — records are never edited away.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-no-always-on-vm.md) | No always-on VM | Accepted |
| [0002](0002-vercel-hobby-permissible.md) | Vercel Hobby is permissible; schedule externally | Accepted |
| [0003](0003-notebook-is-knowledge-not-inference.md) | Notebook is the knowledge layer, not the inference engine | Accepted |
| [0004](0004-one-shared-slack-app.md) | One shared Slack app for V1 | Accepted |
| [0005](0005-inference-cost-posture.md) | Inference cost posture: configurable, Grant chooses | Proposed |
| [0006](0006-foreground-only-voice.md) | Foreground-only voice; no native iOS app | Accepted |
| [0007](0007-ddl-over-management-api.md) | Migrations over the Supabase Management API; backups in GitHub Actions | Accepted |
| [0008](0008-fourteen-job-states.md) | The job state machine has fourteen states, not nine | Accepted |
| [0009](0009-free-allowlist-from-probes.md) | The free-model allow-list is built from probes, not pricing | Accepted |
| [0010](0010-webhooks-on-supabase-edge-functions.md) | Webhooks run on Supabase Edge Functions, not Vercel | Accepted |
| [0011](0011-supabase-cannot-serve-html.md) | Supabase cannot serve a web page; pages go to Vercel | Accepted |
| [0012](0012-github-actions-for-the-sync-schedule.md) | GitHub Actions cron for the ten-minute sync | accepted |
| [0012](0012-notebook-account-disabled.md) | Google disabled the NotebookLM account; what replaces it | Superseded by 0013 |
| [0013](0013-the-project-is-the-source-of-truth.md) | The project is the source of truth; knowledge tools are connectors | Accepted |

| [0014](0014-the-team-attaches-to-projects.md) | The team attaches to projects; it does not own them | Proposed |
| [0015](0015-a-lesson-may-change-behaviour-never-reach.md) | A lesson may change how an agent works; never what it can reach | Accepted |
| [0016](0016-routing-reads-the-roster.md) | Routing reads the roster, and the roster is data Grant edits | Accepted |
| [0017](0017-a-skill-names-tools-never-addresses.md) | A skill may name a tool; it may never name an address | Accepted |
| [0018](0018-an-approval-is-a-record-with-limits.md) | An approval is a record with limits; a decline is durable and specific | Accepted |
| [0019](0019-the-studio-becomes-the-product.md) | The studio becomes the product; `web/hq/index.html` is retired | Accepted |
| [0020](0020-tasks-reach-the-diary-one-way.md) | Tasks reach the diary one way, and only ever touch events we made | Accepted |
| [0021](0021-an-arrangement-belongs-to-the-person.md) | An arrangement belongs to the person, not to the browser | Accepted |
| [0022](0022-a-project-is-archived-not-deleted.md) | A project is archived, not deleted; deletion is for debris | Accepted |
| [0023](0023-absence-on-a-project-means-everyone.md) | Absence on a project means everyone; an automation is a standing instruction | Accepted |
| [0024](0024-how-the-office-converses.md) | Three answers about how the office converses | Accepted |
| [0025](0025-the-project-is-the-conversation.md) | The project is the conversation, and there is no conversations table | Accepted |
| [0026](0026-the-conversation-is-kept.md) | The conversation is kept, and the window is what is bounded | Accepted |
| [0027](0027-an-agent-may-not-say-it-looked-when-it-did-not.md) | An agent may not say it looked when it did not | Accepted |
| [0028](0028-a-list-arrives-as-a-list.md) | A message that is a list arrives as a list | Accepted |
| [0029](0029-the-office-runs-on-a-paid-model-inside-a-budget.md) | the office runs on a paid model, inside a budget the registry holds | Accepted |
| [0030](0030-a-correction-becomes-a-rule-only-on-a-press.md) | A correction becomes a standing rule only on a press | Accepted |
| [0031](0031-a-model-is-chosen-on-what-it-has-done.md) | A model is chosen on what it has actually done, and quality may only demote | Accepted |
| [0032](0032-a-pdf-cover-is-rendered-where-it-is-looked-at.md) | A PDF cover is rendered where it is looked at, and never stored | Accepted |
| [0033](0033-checks-run-in-the-authoring-session-and-that-is-the-decision.md) | Checks run in the authoring session, and that is the decision | Accepted |
| [0034](0034-the-build-diary-bucket-stays-public-and-its-pictures-expire.md) | The build diary's bucket stays public, and its pictures expire | Accepted |
| [0035](0035-the-approval-policy-is-a-matrix-a-floor-and-rows.md) | The approval policy is a matrix, a floor, and rows | Accepted |
| [0036](0036-the-decision-log-crosses-every-project.md) | The decision log crosses every project | Accepted |
| [0037](0037-mail-belongs-to-a-project-by-derivation-not-by-a-link-table.md) | Mail belongs to a project by derivation, not by a link table | Accepted |
| [0038](0038-the-office-may-hold-what-a-message-said.md) | The office may hold what a message said | Accepted |
| [0038](0038-the-office-writes-pdfs-itself-because-jobs-run-in-deno.md) | The office writes PDFs itself, because jobs run in Deno | Accepted |
| [0039](0039-a-session-that-stays-valid-not-a-browser-that-stays-open.md) | A session that stays valid, not a browser that stays open | Accepted |
| [0040](0040-an-upstream-deletion-archives-and-hides-it-never-destroys-it.md) | An upstream deletion archives and hides; it never destroys | Accepted |
| [0041](0041-a-personal-task-is-a-tasks-row-not-a-second-table.md) | A personal task is a `tasks` row, not a second table | Accepted |
| [0042](0042-the-nightly-backup-is-a-folder-not-a-file.md) | The nightly backup is a folder, not a file | Accepted |
| [0043](0043-supabase-is-the-task-list-and-a-provider-is-a-projection.md) | Supabase is the task list; a provider is a projection | Accepted |
| [0044](0044-the-model-understands-the-human-deterministic-code-controls-reality.md) | The model understands the human; deterministic code controls reality | Accepted |
| [0045](0045-a-plan-is-a-proposal-and-permission-is-asked-twice.md) | A plan is a proposal, and permission is asked twice | Accepted |

**Note the collision:** two ADRs were written as 0012 on the same day, by two
sessions that each read the highest number and then wrote. They are left as
they are rather than renumbered, because a renumber breaks every link already
written to them and the filenames are unambiguous. Cite them by filename.
