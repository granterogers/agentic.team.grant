# Research: Gemini Notebook (NotebookLM) automation

**Researched:** 2026-09-02
**Spec sections validated:** §3 (Notebook integration), §5 (Project Model), §6 (Source of Truth), §27 Gate 2
**Researcher:** Claude Code (primary session)

---

## Verdict

**VALID, with two material corrections to the specification.**

The spec's core assumption — that consumer Gemini Notebook can be automated well
enough to act as the project-identity and project-knowledge layer, via
`notebooklm-py`, behind a replaceable adapter boundary — holds up. Better than
expected: the library has a purpose-built unattended-server auth mode that
directly satisfies Gate 2's "test auth refresh" requirement.

Two corrections are required:

| # | Spec assumption | Reality | Correction |
|---|---|---|---|
| **C1** | Product is called "Gemini Notebook" / "NotebookLM" interchangeably; consumer tier is adequate | Google **renamed NotebookLM to Gemini Notebook**. Free tier allows only **50 chats/day, 10 Deep Research/month, 3 audio overviews/day** | A **paid Google AI Pro tier is a functional prerequisite**, not a nice-to-have. See [Quota ceiling](#4-quota-ceilings-the-binding-constraint). |
| **C2** | Usage dashboard (§12) can show remaining Notebook quota | Google exposes **static plan limits only — no live usage counters** via any known RPC | Notebook quota in the Usage dashboard **must be locally accounted and labelled "estimated"**. The spec already permits this (§12); it is now mandatory, not a fallback. |

Everything else in §3's Notebook plan survives: 10-minute polling is
appropriate, the adapter boundary is correct and now has a *documented official
migration target*, and every Gate 2 operation is supported.

---

## 1. Official API status

There is **no self-serve public API for consumer Gemini Notebook.** Google has
acknowledged demand but published no beta, waitlist, or timeline.

There **is** an official REST API for **Gemini Notebook Enterprise**, documented
under Google Cloud's Discovery Engine / Gemini Enterprise Agent Platform. It
supports `notebooks.create`, notebook management, and adding data sources of
type PDF, Google Docs, Google Slides and website URL.

- Official Enterprise API: <https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks>
- Notebooks REST reference: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/notebooks/workbench/reference/rest>

**Why this matters for us:** it is the concrete migration target that justifies
the spec's adapter boundary. The boundary is not hypothetical future-proofing —
there is a real, documented, supported API to migrate *to* if consumer
automation breaks or if this system ever needs an enterprise footing. The
adapter interface should therefore be shaped to be satisfiable by *either*
backend.

**Why we are not using it for V1:** it requires Gemini Enterprise licensing,
which is priced far above this project's cost envelope and requires a Google
Cloud organisation. Disproportionate for a single-user system.

---

## 2. Chosen library: `notebooklm-py`

- Repo: <https://github.com/teng-lin/notebooklm-py>
- PyPI: <https://pypi.org/project/notebooklm-py/>

**Currency — actively and heavily maintained:**

| Version | Released |
|---|---|
| 0.8.1 | 2026-08-14 |
| 0.8.0 | 2026-08-03 |
| 0.7.3 | 2026-06-30 |
| 0.7.2 | 2026-06-18 |

Python ≥3.10, MIT licence, ~2,200 commits. Release cadence of roughly two
releases/month is the single most reassuring signal here: when Google changes
an internal RPC ID, the project ships it as a patch release, and its stated
versioning policy makes that explicit — *"RPC method ID fixes (Google changed
something) → PATCH"*.

It also ships an **MCP server** (stdio and self-hosted remote), which is a
useful secondary integration path but **not** the one we should build on — see
[§7](#7-integration-shape).

---

## 3. Authentication and unattended operation

This was the make-or-break question, and it resolves well. The library
documents a seven-rung "recovery ladder"; the relevant rung is **L4, master
token**:

> **(c) Master token** ⭐ — `notebooklm login --master-token` — **Servers / CI /
> unattended / headless** — Survives cookie expiry unattended: **Yes** —
> re-mints automatically, no browser

> **L4 (master-token re-mint) is the standout for headless/unattended use.**
> Unlike L3 it needs no browser at refresh time, and unlike L5/L6 it is fully
> automatic. One durable master token — one human sign-in, then good for months
> — re-mints web cookies on demand and self-heals an expired session in-process.

Concretely:

- **One human sign-in** produces a durable `master_token.json`. Good for months.
- Runtime is then **pure HTTP — no Playwright, no Chromium.** This materially
  simplifies hosting: the Notebook worker does not need a browser-capable
  container. (Contradicts nothing in the spec, but it *relaxes* the hosting
  requirement the spec implied.)
- Session self-heals in-process on expiry, coalesced via a single-flight
  `AuthRefreshCoordinator`.
- Cookie mechanics for the record: `__Secure-1PSIDTS` has a Google-self-reported
  rotation cadence of **~600s**; the master token itself is long-lived.

### Operational hazard worth designing around

The auth docs warn that a *copied cookie snapshot* gets rotated out from under
you if another client rotates the same session. The practical rule:

> **The dedicated Google account must not be used interactively in a browser
> while the worker is running.**

This independently reinforces spec §4's dedicated-account requirement — it is
not only a blast-radius argument, it is a **correctness** argument. Grant
browsing Gemini Notebook while signed in as the automation account can disrupt
the worker's session. If interactive access to the same notebooks is wanted, it
should be via Notebook *sharing* to Grant's own account, not by signing in as
the automation account.

---

## 4. Quota ceilings — the binding constraint

Captured by the library's maintainers from Google's public pages. Google heads
every such table *"Usage Limits (Subject to Change)"*, and consumer tiers were
**restructured in May 2026** (4 tiers → 5, Ultra split 20TB/30TB).

| Feature | **Free** (`1`) | Plus (`4`) | **Pro** (`2`) | Ultra 20TB (`3`) | Ultra 30TB (`6`) |
|---|---|---|---|---|---|
| Notebooks per user | 100 | 200 | 500 | 500 | 500 |
| Sources per notebook | 50 | 100 | 300 | 500 | 600 |
| **Chats/day** | **50** | 200 | **500** | 2,500 | 5,000 |
| Audio Overviews/day | 3 | 6 | 20 | 100 | 200 |
| Video Overviews/day | 3 | 6 | 20 | 100 | 200 |
| Reports/day | 10 | 20 | 100 | 500 | 1,000 |
| Mind Maps/day | 10 | 20 | 100 | 500 | 1,000 |
| **Deep Research** | **10/month** | 3/day | 20/day | 75/day | 200/day |
| Infographics / Slide Decks | *Limited* | *More* | *High* | *Higher* | *Highest* |
| Watermark removal | No | No | No | Yes | Yes |

`tier` is exposed as an opaque integer via
`(await client.settings.get_account_limits()).tier` — tier `1` = Free and tier
`2` = Pro are both live-confirmed against Google's published source limits.
**The system should read this at startup and adapt its own rate budgets to the
detected tier rather than hard-coding any number above.**

### Why Free is not viable

The spec's design has 8 permanent agents, 10-minute polling, and up to 5
autonomous investigations per project per day, each of which may query the
Notebook several times. **50 chats/day is consumed by a single busy afternoon.**
Deep Research at 10/*month* is effectively unusable for a "research director"
role.

> **Prerequisite consequence:** Google AI Pro (tier `2`) on the dedicated
> account should be treated as a required, budgeted subscription. It raises
> chats to 500/day, Deep Research to 20/day, and sources/notebook to 300.
> This is a **real recurring cost the spec does not currently acknowledge** and
> belongs in `docs/prerequisites.md` as a decision for Grant.

### Enforced limits drift from published limits

Documented precedent, worth building for:

> On 2025-11-25 NotebookLM temporarily rolled Infographics/Slide Decks back to
> **0 for Free users** and imposed unspecified extra limits on Pro, due to
> demand; access was later restored. The published tables did not reflect this.

So artifact generation must be treated as **best-effort and failure-tolerant** —
never a hard dependency in a job's critical path. A slide-deck generation
failure must degrade gracefully, not fail the enclosing investigation.

---

## 5. Supported operations vs Gate 2 requirements

Every Gate 2 operation is supported:

| Gate 2 requirement | Supported | Notes |
|---|---|---|
| List notebooks | ✅ | create, copy, list, rename, delete |
| List sources | ✅ | plus source guide and fulltext retrieval |
| Detect new source | ✅ | via list + our own fingerprinting |
| Add external URL | ✅ | URLs, YouTube, files, Google Drive, raw text |
| Create note | ✅ | create, list, rename, delete; save answers |
| Query Notebook | ✅ | chat with history and custom personas |
| Generate infographic | ✅ | *quota-limited, see §4* |
| Generate slide deck | ✅ | *quota-limited* |
| Generate Audio Overview | ✅ | 3/day free, 20/day Pro |
| Unattended sync | ✅ | master-token auth, §3 |
| Auth refresh | ✅ | self-healing, §3 |
| Failure recovery | ✅ | `--retry` exponential backoff; manual `artifact poll <task_id>` |

Beyond the spec: source **labels** (filter by topic), web and Drive **research
agents** (fast/deep, with auto-import), quizzes, flashcards, data tables, and
artifact download as MP3/MP4/PDF/PPTX/PNG/CSV/JSON/Markdown/HTML. Sharing and
permissions are also programmatic — relevant to the §4 sharing design above.

Artifact generation is **asynchronous with a task id**, so our job engine (§22)
should model generation as a durable job with a poll step, not a blocking call.

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Undocumented Google APIs; no stability guarantee, no deprecation notice, no SLA.** The library states plainly: *"Use at Your Own Risk… Google can change the underlying APIs at any time."* | **High** | Adapter boundary (spec §3, already required). Pin the version, track releases, and keep the official Enterprise API as the documented escape hatch. Treat a Notebook outage as a degraded-mode condition, not a system failure — Supabase remains authoritative for all operational state (§6). |
| **Terms-of-service exposure.** Automating a consumer Google product via undocumented endpoints is not a sanctioned use. The library carries no ToS analysis; risk of account restriction is real if usage looks abusive. | **Medium** | Dedicated account (§4) contains blast radius. Respect the 10-minute poll floor; never hammer `batchexecute`; keep per-day operations well inside detected-tier limits. **This is a risk Grant should accept explicitly** — it is flagged in prerequisites. |
| **Pre-1.0 library semantics.** At 0.x, MINOR releases may remove deprecated public APIs (after one MINOR of `DeprecationWarning`). | Medium | Pin exact version; upgrade deliberately with the adapter's contract test suite as the gate. |
| Google rate-limits `batchexecute` strictly | Medium | Library ships `--retry` exponential backoff; our job engine adds idempotency keys so retries are safe. |
| No live usage counters → dashboard can only estimate | Low | Local accounting, labelled "estimated" per §12. Read static tier limits at startup as the denominator. |
| Artifact quotas silently change (§4 precedent) | Low | Artifact generation is best-effort; never in a critical path. |

---

## 7. Integration shape

Recommended, and consistent with §3's adapter requirement:

- Use `notebooklm-py` **as an embedded Python library in pure-HTTP mode**, not
  via its MCP server. The MCP server is designed for interactive agent tooling;
  our Notebook worker is an unattended backend service and should not carry an
  MCP hop, its OAuth surface, or its throttle semantics.
- No Chromium at runtime. Only the one-time bootstrap sign-in needs a browser,
  and that is a human step performed once (see prerequisites).
- Wrap it behind a `NotebookAdapter` interface expressing only what Team HQ
  needs, shaped so it can also be satisfied by the official Enterprise REST API.
- Read `AccountLimits.tier` at worker startup; derive per-day operation budgets
  from the detected tier; expose those to the §12 usage dashboard as
  *estimated*.
- Model artifact generation as a durable job with an async poll step.
- Fingerprint sources locally for change detection (§5) — do not rely on
  Notebook to tell us what is new.

---

## Sources

- [notebooklm-py — GitHub](https://github.com/teng-lin/notebooklm-py)
- [notebooklm-py — PyPI](https://pypi.org/project/notebooklm-py/)
- notebooklm-py v0.8.1 sdist, bundled docs: `docs/quota-limits.md`, `docs/stability.md`, `docs/auth-cookie-lifecycle.md`, `docs/troubleshooting.md`, `docs/configuration.md`
- [Gemini Notebook Enterprise — Create and manage notebooks (API)](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks)
- [Gemini Notebook Enterprise — Overview](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/overview)
- [Gemini Enterprise Agent Platform — Notebooks REST reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/notebooks/workbench/reference/rest)
- [NotebookLM — Wikipedia](https://en.wikipedia.org/wiki/NotebookLM) (rename to Gemini Notebook)
- [How to access NotebookLM via API — Google AI Developers Forum](https://discuss.ai.google.dev/t/how-to-access-notebooklm-via-api/5084)
- [@NotebookLM, 2025-11-25 — temporary artifact limit rollback](https://x.com/NotebookLM/status/1993387297081827346)

### Unverified

- **Consumer-tier per-source word/size cap.** Only Enterprise publishes one
  (500MB / 500,000 words per source). The library notes `limits[3]` ≈ `500000`
  in the settings vector may be the same cap surfaced per-account, but this is
  explicitly unconfirmed.
- **Exact numeric limits for Data Tables / Infographics / Slide Decks** on
  consumer tiers — Google publishes only relative words ("Limited", "More",
  "High"). Enterprise is the only surface publishing a number (15/user/day each).
- **Google's ToS position on consumer automation.** No authoritative statement
  located either permitting or prohibiting it. Treated as accepted risk.
