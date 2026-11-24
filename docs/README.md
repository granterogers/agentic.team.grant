# Documentation

Everything written down about Team HQ, in the order you are most likely to need it.

## Start here

| If you want to | Read |
|---|---|
| Understand what the product is for | [The README](../README.md) |
| Understand how it is built | [`architecture.md`](architecture.md) and [`../AI_TEAM_HQ_MASTER_SPEC.md`](../AI_TEAM_HQ_MASTER_SPEC.md) |
| Know what is wrong right now | [`known-problems.md`](known-problems.md) |
| Start a working session | [`HANDOFF.md`](HANDOFF.md) |
| Set up a fresh environment | [`new-environment.md`](new-environment.md) |

## Decisions and history

| Folder or file | What it holds |
|---|---|
| [`adr/`](adr/) | Decision records (84). Each one says what was decided and why. Read one before reversing a decision. |
| [`defects-fixed.md`](defects-fixed.md) | Defects that were found and closed, and the shape of mistake that kept recurring |
| [`degradation-coverage.md`](degradation-coverage.md) | Which failure cases the checks cover, and which they do not |
| [`test-evidence/`](test-evidence/) | What the checks found by failing |
| [`testing/`](testing/) | How testing is organised, including the critical gate |

## Operations and safety

| Folder or file | What it holds |
|---|---|
| [`ops/`](ops/) | Deployment records. `ops/deployment-state.json` is the one place that says what is deployed |
| [`production-access-guard.md`](production-access-guard.md) | Why production commands refuse to run without explicit flags |
| [`account-continuity.md`](account-continuity.md) | How the project survives a vendor account being suspended |
| [`cost-and-hosting-decisions.md`](cost-and-hosting-decisions.md) | Where things are hosted, and why |

## Product

| Folder or file | What it holds |
|---|---|
| [`spec/`](spec/) | Specifications for the product and its interface |
| [`design/`](design/) | Design direction |
| [`basecamp/`](basecamp/) | The Team HQ interface: how the project page and its modules are meant to behave |
| [`multi-user/`](multi-user/) | Working with more than one office |

Many older working notes sit in the folders above. When a note and an ADR disagree, the ADR is the decision.
