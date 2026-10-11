# Hermes integration: security and permissions

Scope: the design in `ARCHITECTURE-DECISIONS.md` and `INTERFACE-CONTRACTS.md`. Every control names the test that must fail when it is removed
(`IMPLEMENTATION-BLUEPRINT.md` §8, T-numbers).

## 1. Assets and trust boundaries

| Asset | Owner | Boundary |
|---|---|---|
| Office data (projects, documents, tasks, conversation) | the office's Postgres | reachable by Hermes ONLY through the office MCP server, read tools, one project per run |
| The ability to act outside the office (send, write to Notion/Google/Slack, create work) | the office's policy (`app.authorize_effect`, autonomy, blockers) | Hermes has none in v1; in M10 only through the same policy |
| Delivery to a person | `claim_delivery` | Hermes never sends; its answer is delivered by the office like any other |
| Credentials | Supabase Vault (office); the Hermes host's `.env` (three Hermes-side secrets) | no office secret is ever given to the Hermes host |
| Learning (lessons, skills) | append-only tables | changed only by a person's press |
| The person's model budget | the paid certified chain | Hermes cannot reach the office's OpenRouter key or budget |

Trust levels: the office code and database are trusted. The bridge is semi-trusted (it holds a narrow credential and runs on a host the
office does not control). Hermes, its model output, its tool arguments, its skills and everything it read are **untrusted**.

## 2. Credentials

| Credential | Held by | Can | Cannot | Storage | Revocation |
|---|---|---|---|---|---|
| **Bridge token** | bridge (`ENGINE_BRIDGE_TOKEN`) | call the engine gateway for its own office: claim, heartbeat, finish, propose | read any office data; name another office; choose a run that is not `open`; finish a run it does not hold (fence) | office: `engine_bridges.token_sha256` only; host: `.env` | `app.engine_retire_bridge`, Settings › Connections |
| **Engine MCP token** | Hermes (`OFFICE_ENGINE_MCP_TOKEN`) | call the office MCP read tools while its bridge has a running run, bound to that run's project | write (refused in SQL); call without a running run; choose a project; see write tools in `tools/list` | office: `mcp_clients.token_sha256`; host: `.env` | retired with the bridge (same statement) |
| **Hermes API key** | Hermes + bridge (`API_SERVER_KEY`) | drive the local Hermes API | anything in the office | host only; Hermes refuses a weak key **[SRC api_server.py:4422-4475]** | rotate on the host |
| **Hermes OpenRouter key** | Hermes (`OPENROUTER_API_KEY`) | call `:free` models | spend money (credit limit zero, [ASSUMPTION V6]); reach the office's budget | host only; a SEPARATE key from the office's | revoke in OpenRouter |

Never on the Hermes host: `hq.api_token` (the office key), any Supabase service or anon key, `SUPABASE_DB_URL`, any connector token,
`ALLOW_PRODUCTION_*`. The minting script prints each new token once to the operator's terminal and stores only the hash; the host runbook
puts them in `.env` with mode 600. Tokens are generated with 32 random bytes and the repository's `randomToken` prefix convention so
`check:secrets` and the `mcp_clients_carries_no_token` check recognise them.

## 3. Approvals and policy (the existing system is the only one)

- **No second approval system.** Hermes's own approval machinery (dangerous-command approvals, MCP trust-gate elicitation) is either never
  triggered (its toolsets are off; the office MCP server is `trust: full`) or answered `deny` by the bridge (T17). A Hermes approval is never
  shown to a person and never relayed as consent.
- **v1 has no consequential act.** Read tools only; `app.mcp_write_client` refuses the `engine` kind (T10); `tools/list` hides writes; the
  consequence gate refuses an answer that claims an act (`acted: 0`, T15).
- **M10 writes**, when built: each write tool call → `app.engine_tool_gate` → `app.authorize_effect(p_office, p_project = run's project,
  p_tool = mapped office tool, p_job = the run's job)`. `proceed` → perform with an idempotency key `engine:<run_id>:<args_sha256>`;
  `ask` → raise a blocker on the job with `on_answer` naming the exact call (the existing #366 mechanism, checked by `check:answerable`),
  return "needs approval, not done" to Hermes; `refuse` → refuse with the reason. Level 3 can never resolve to `proceed` (the existing CHECK).
- **Origin trust.** A Hermes turn inherits its job's origin class. A job whose origin is not a person's own door (e.g. an assistant's
  `ask_team`, `origin_class = unknown`) cannot open a Hermes run at all in v1 (`engine_run_open` refuses), because only a person can choose
  an engine.

## 4. Threat model

| # | Threat | Vector | Control | Test |
|---|---|---|---|---|
| S1 | Hermes acts outside the office | a built-in tool (terminal, web, browser, messaging, cron) | toolsets disabled in config; bridge preflight against `/v1/toolsets`; bridge stops a run on any non-office `tool.started` | T16, T18 |
| S2 | Hermes writes office data | MCP write tool | not listed; edge gate; SQL refusal for the kind | T8, T10 |
| S3 | Hermes reads another project or office | tool arguments naming them | binding from the running run; the edge overrides `project`; office from the credential | T3, T8, T9 |
| S4 | Prompt injection in a document Hermes reads | document text instructing the model | read-only tools mean the worst outcome is a wrong answer, which the coherence gates exist to catch; the brief states the tool limits; untrusted material fencing applies in the office's own reading of what returns | T14, T15 |
| S5 | Fabricated tool results presented as evidence | Hermes's transcript | grounding comes only from `engine_run_calls`, which the office wrote while serving the call | T14 |
| S6 | Hermes impersonates the team | "Emma here, I checked…" | brief forbids it; the answer is labelled Hermes by the job's run, not by text; the attribution gate (`namedWithoutEvidence`-class checks) applies | T14 |
| S7 | Silent engine switch | fallback code, an old worker, a default | no fallback path exists; `engineOf` defaults to team only when the person did not choose Hermes; deploy order guard; rollback order | T12, T13 |
| S8 | Stolen bridge token | host compromise | can only claim this office's open runs and report; cannot read data; rate-limited; retire revokes bridge and MCP client together | T4, T22 |
| S9 | Stolen engine MCP token | host compromise | read tools only, and only while a run is running (seconds to minutes a day); retire | T8 |
| S10 | A forged answer reported by a compromised bridge | `finish` with arbitrary text | the answer still passes every coherence gate against office-held grounding; it is labelled Hermes; it cannot act. A compromised host is an availability and honesty problem, not an integrity breach of office data | T14 |
| S11 | Duplicate effects on retry | re-claim, re-POST | v1 has no effects; Idempotency-Key + identical body; M10 keys writes by (run, args) | T19 |
| S12 | Spending money | paid model, auxiliary lane, image or TTS tools | `:free` model, `auxiliary.free_only`, zero-credit key, tools off; `inference_usage.cost_usd` stays 0 | V5, V6, V8 |
| S13 | Exhausting the shared free quota | many runs | daily ceiling per office (`engine.hermes.daily_runs`); one run at a time | T2 |
| S14 | Unreviewed learning adopted | Hermes skills reused across runs | memory off, skills off (M0–M7); M8 harvests into an isolated directory wiped after harvest; only approved skills are exported back | `LEARNING-AND-SKILL-TRANSFER.md` §7 |
| S15 | Malicious skill proposal | address, exfiltration step, script | ADR-0017 insert refusal; tools by foreign key; scripts never transfer; a person's press | §5 of that file |
| S16 | Data egress to a model provider | project content in prompts to free OpenRouter models | Grant's decision G2; the brief and reads are bounded; only the turn's project | G2 |
| S17 | Secrets in logs, rows or events | errors, previews | redaction in SQL on every excerpt and failure; Hermes redacts its own previews **[SRC api_server_runs.py:101-109]**; the bridge never logs request or answer bodies | T22 |
| S18 | Denial of service on the office | a bridge polling hard | 429 on claims < 5 s apart; 64 KB bodies; adaptive polling | gateway unit tests |
| S19 | Hermes supply chain | upstream update | pin a commit or release on the host, record it in the runbook, upgrade deliberately and re-run M0's V-checks | runbook |
| S20 | Local transcript retention on the host | Hermes SQLite | runbook prunes Hermes sessions older than 7 days ([ASSUMPTION V13]); the host must be one Grant controls (G1) | runbook |

## 5. Data that leaves the office

Per run, at most: the instruction, the brief (≤ 12,000 characters), up to 20 prior turns (≤ 24,000), and whatever the read tools return
for one project. It goes to the Hermes host and from there to the chosen OpenRouter free model. Nothing else: no other project, no
credentials, no mail or calendar unless those read tools are on the list and the turn asks. Free-model providers on OpenRouter may log
prompts under their own terms; that is decision **G2** and is presented to Grant, not assumed.

## 6. Multi-user (offices)

Every new table carries `office_id` with same-office composite foreign keys; every function is office-first and checks every id against
the office; the office comes from the credential; a bridge serves exactly one office. The Sample office is the first place Hermes is
switched on (D6), as every person-facing feature is tested there first (`docs/multi-user/SAMPLE-PERSON.md`).

## 7. What is NOT protected, stated plainly

- A compromised Hermes host can return a wrong answer that passes the gates. The answer is labelled Hermes and can do nothing; the person
  can see which engine answered. This is the same position as any model returning a wrong answer.
- Redaction is pattern based. The stronger control is that excerpts are bounded and only office-served reads are stored.
- The free model's provider sees the content of the turn (G2).
- Hermes's own SQLite on the host holds transcripts until pruned.
