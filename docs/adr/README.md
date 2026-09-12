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

**Note the collision:** two ADRs were written as 0012 on the same day, by two
sessions that each read the highest number and then wrote. They are left as
they are rather than renumbered, because a renumber breaks every link already
written to them and the filenames are unambiguous. Cite them by filename.
