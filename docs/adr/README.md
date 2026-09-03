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
| [0007](0007-ddl-over-management-api.md) | Migrations over the Supabase Management API; backups in GitHub Actions | Proposed |
