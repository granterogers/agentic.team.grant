# Hermes Agent (Nous Research): fit assessment for the INNERGY agentic office

**11 October 2026 · an assessment and a recommendation. Nothing here was installed, deployed, connected to production or given a credential.**

Sources read (vendor, current): [home](https://hermes-agent.nousresearch.com/), [docs index](https://hermes-agent.nousresearch.com/docs), [security model](https://hermes-agent.nousresearch.com/docs/user-guide/security), [MCP integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp), [repository](https://github.com/NousResearch/hermes-agent). Claims below are marked **[vendor]** (stated by the vendor's pages), **[repo]** (read in this repository) or **[inferred]** (my reading, to be proved by a trial). The vendor pages I could reach describe features at feature-list depth; internals (memory schema, skill format, API surface) were not available from them and are marked unknown rather than guessed.

## 1. What Hermes is, as the vendor describes it

- MIT-licensed, self-hostable agent from Nous Research that "grows with you" **[vendor]**.
- Persistent memory across sessions, and **automatic skill creation** from problems it has solved (procedural memory; skills follow the agentskills.io convention) **[vendor]**.
- One agent and one memory reachable from Telegram, Discord, Slack, WhatsApp, Signal, email and a CLI through a **messaging gateway**; **built-in cron** with delivery to any platform **[vendor]**.
- Tools: web search, browser automation, vision, TTS, isolated **subagents**, a Python RPC tool (`execute_code`) **[vendor]**.
- **MCP client** (connect to MCP servers, filter their tools). The pages say nothing about Hermes acting as an MCP server or exposing an OpenAI-compatible server **[vendor; absence unverified]**.
- Bring-your-own model provider (OpenRouter, OpenAI, any endpoint) or Nous Portal **[vendor]**.
- Execution backends: local (no isolation), Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox **[vendor]**.
- Security **[vendor]**: shell command approval (`smart` default, `manual`, `off`), a hard blocklist of catastrophic commands, `approvals.deny` rules, fail-closed 300 s prompt timeout, gateway allowlists with DM pairing (no allowlist means everyone denied), Docker capability dropping, credential env stripping, SSRF blocking, MCP subprocess env stripping and error redaction. The vendor states plainly that its prompt-injection scanning is heuristic and "not a complete defense".

## 2. What we already have that overlaps

| Hermes feature | Our equivalent **[repo]** |
|---|---|
| Messaging gateway (Telegram/Slack/email) | `telegram-webhook`, `slack-events`, `voice`, Team HQ; adapters only translate to `inbound_commands` (master spec §5) |
| Persistent memory | `public.lessons` (append-only, scoped, provenance via `learned_by`), documents, `app.conversation_before`, project knowledge |
| Skill creation | `public.skills` (append-only, retire not delete), proposals/suggestions rounds (#49) |
| Cron | `public.responsibilities` duties + dispatcher |
| Subagents | Claire plus 7 specialists, hand-off children, `branch_groups`, fan-in, `app.obligation_state` |
| Command approval | `mayAct` (`src/agents/approval.ts`), autonomy dial (`autonomy_settings`, `autonomy_policy` with a CHECK that level 3 never resolves to `proceed`), blockers with `on_answer`, `check:answerable` |
| Allowlists/pairing | office model, `app.may_act_outside`, `app.job_origin`, per-office delivery guard |
| MCP client | `app.offer_mcp_tool` classifies discovered tools by reach, `unknown` treated as write |
| Audit | `events`, `outputs` provenance, impediments, `deliveries` |

Consequence: Hermes's headline features are mostly **already built here, with stronger invariants** (provenance, append-only ledgers, office isolation, a floor in a CHECK). Adopting Hermes as the office's brain would duplicate state and, worse, create **two memories and two approval systems**, which this repository's history shows is where defects breed ("two doors onto one field, only one writes the ledger").

## 3. The four options

Scoring: feasibility / compatibility / risk, each Low-Med-High.

### A. Hermes as one specialist among the eight
- **Shape:** a ninth staff row whose "brain" is a Hermes process; Claire delegates a job, a worker adapter calls Hermes, the answer is written as an `outputs` row like any other.
- **Feasibility Med.** Needs a runnable Hermes host, and a stable invocation surface. If Hermes exposes only CLI/gateway (as the vendor pages suggest), the adapter shells out or uses an MCP/ACP bridge; **unknown until a trial**.
- **Compatibility Med.** Its own memory and skill store would sit beside `lessons`/`skills`; it must be given only what the job carries and write nothing back except through our doors.
- **Risk Med.** Its model sees our project documents: same data-egress question as any provider. Output passes the same coherence gates (`claimsToHaveRead`, `fabricatedWhen`, `consequence.ts`) because it enters as an ordinary output.

### B. Hermes as a per-project agent
- **Shape:** one Hermes profile per dashboard project.
- **Feasibility Low-Med; Risk High.** N long-lived processes with memory per project multiplies cost and creates a per-project memory that is not provenance-tracked. The cross-project retrieval policy (ADR-0059) and office isolation would have to be re-implemented around it. Not recommended.

### C. Hermes as an autonomous research / improvement agent (sandboxed, advisory)
- **Shape:** runs in a Docker/Modal sandbox with no credentials, reads a **read-only snapshot** (exported documents, or a repository checkout), and produces proposals: an output document, or an issue draft. A person or Claire's review gate decides anything that changes state.
- **Feasibility High.** It is what the tool is designed for; self-improving skills stay inside the sandbox and are *proposals* to our skills registry, never loaded automatically.
- **Risk Low-Med** if egress is limited to the model endpoint and a fixed search allowlist. This is the only option where the self-improvement property is a benefit rather than a hazard, because nothing it learns can act without passing the gate.

### D. Hermes driving the dashboard directly
- **Shape:** Hermes uses structured APIs (gateway sections/actions; our MCP server) rather than browser automation.
- **Feasibility Med.** `supabase/functions/mcp` is a real MCP server with a bearer token **[repo]**, so Hermes's MCP client can reach it with no new protocol.
- **Risk High unless narrowed.** The single bearer token (`hq.api_token`) is the office key. **Hermes must never receive it.** It would need its own scoped identity with a tool allow-list equal to what an agent of that autonomy level may use, every write going through `mayAct`. Without a per-caller scope the MCP server is "one key, all doors". Browser automation of the dashboard is worse (unstructured, un-gated) and is rejected.

## 4. Recommendation

**Integrate, do not replace, and in this order:**

1. **Option C first** as an isolated, advisory worker (Phase H1). Lowest risk, directly tests the "learns and writes skills" claim, produces evidence.
2. **Option A second** (H2), only if H1 shows it is better than our model chain at a class of task we can name (long web research, multi-step analysis), and only through the normal job/output path.
3. **Option D third** (H3), and only after the MCP server has per-caller scopes (a prerequisite we would want anyway for any external assistant).
4. **Option B: no.**

**Build vs integrate:** integrate for *execution* (research loops, browser/search tooling) and keep *state, policy and provenance* in our system. Do not adopt Hermes's memory or skill store as a source of truth; import only through `lessons`/`skills` proposals that a person accepts.

## 5. Interaction and data flow (recommended H1/H2)

```
Grant / Team HQ / Telegram / Slack
        │  (adapters only translate)
        ▼
 inbound_commands ──► Claire (routes) ──► job (kind: research.hermes)
                                           │  carries: instruction + scoped read-only context
                                           ▼
                                  worker handler "hermes"
                                           │  1. mayAct(tool='research.hermes', level 1)   ← policy first
                                           │  2. start sandbox (no secrets, egress = model + allowlist)
                                           ▼
                                  Hermes process (Docker/Modal)
                                           │  returns: text + cited sources + proposed skills (data only)
                                           ▼
                                  worker: provenance, coherence gates, evidence labelling
                                           ▼
                                  outputs row ──► review gate ──► delivery (Claire only speaks)
                                           │
                                           └─► proposed skill/lesson ──► Governance page ──► Grant accepts or declines
```

Nothing in the box talks to a person. Outbound delivery is the existing `claim_delivery` path, which already refuses harness and unknown-origin jobs.

## 6. Hard boundaries (as instructed) and how each is enforced

| Boundary | Enforcement |
|---|---|
| Never contacts external humans / sends outbound messages | Hermes's own messaging gateway and email are **not configured** in our deployment; the sandbox has no network route except the model endpoint and a search allowlist; the worker is the only sender |
| Never takes externally consequential actions without approval | Tool level 2/3 registered in `tool_permissions` with `delivered_by`; level 3 can never resolve to `proceed` (CHECK) |
| Does not bypass `mayAct` / autonomy | The handler calls `mayAct` before starting; a refusal is recorded with `recordRefusal`, as for any tool |
| No production DB admin, no unrestricted production access | It receives a context bundle in the job, not a connection string; no service-role key; no `ALLOW_PRODUCTION_*` |
| No uncontrolled code execution | Hermes `execute_code`/terminal only inside a container backend with capabilities dropped, CPU/memory/time limits, ephemeral workspace; local backend forbidden |
| Self-modification | Skills it writes stay in the sandbox and leave only as proposals |
| Secrets | Env stripping (vendor) plus we pass none; model key is a per-run, low-limit key |

## 7. Infrastructure and deployment plan

- **Host.** Not Vercel Hobby/Supabase free (no long-running processes). Options: Modal or Daytona serverless sandbox per job (pay per second, scales to zero), or a small VPS with Docker. **Recommendation: serverless sandbox per job**, because persistent compute is exactly what the £0/month constraint rules out (see `docs/agent-runtime-assessment-2026-09-17.md`: state is free, compute is not).
- **Cost [inferred, to be measured in H1]:** model tokens dominate. With free OpenRouter models the infrastructure floor is a few pounds a month at our volume; a paid model or Nous Portal plan ($20 to $200/month **[vendor]**) would break the £0 constraint, so per `CLAUDE.md` it needs Grant's explicit decision with a named cost and the free alternative (our own router chain).
- **Auth.** The worker invokes the sandbox with a short-lived token it mints; the sandbox calls back to nothing.
- **Observability.** One `events` row per run (start, end, tokens, model, sandbox id, exit status) and an `inference_usage` row; the output carries `evidence` and sources like every output.
- **Rollback.** A feature flag in `system_config` (default off) and the job kind unregistered; no schema dependency on Hermes.

## 8. Security and prompt-injection assessment

- Any content Hermes reads from the web is untrusted; `isUntrusted` fencing applies to what returns. The vendor's scanner covers context files only, heuristically.
- The dangerous shape is *research content instructing an agent that holds a tool*. In H1 the agent holds no outward tool, so the worst result is a wrong answer, which our coherence and provenance gates are built for.
- Memory poisoning: Hermes persistent memory is attacker-writable through content it reads. Run H1 with **ephemeral memory per job** (no carry-over) until we choose otherwise; durable learning goes through `lessons` proposals.
- Supply chain: pin an exact release and image digest; review the diff on upgrade; treat community skills as untrusted code.
- MCP (option D): per-caller scoped token, tool allow-list, rate limit, every call logged; the existing `app.guess_reach` classification (name is evidence, description is a claim that may only escalate) applies to any tool Hermes exposes to us.

## 9. Roadmap (incremental, each step gated)

| Phase | Deliverable | Gate to proceed |
|---|---|---|
| H0 (this document) | Assessment, boundaries | Grant's decision on cost line |
| H1 | Sandboxed advisory research worker behind a flag; ephemeral memory; proposals only | a labelled trial of at least 20 research asks, compared blind against the current chain (the existing `verify:judge` pairwise method), with zero outbound sends and zero secret reads in the sandbox audit |
| H2 | Specialist adapter (option A) | H1 shows a named class where it wins; provenance and coherence gates unchanged |
| H3 | Scoped MCP identity (option D) | per-caller scope exists and is attack-tested (`tests/safety` style) |
| H4 | Reviewed skill import | proposals page, human accept, retire path |

## 10. Proof of concept

**Not built in this run, deliberately.** The boundary work (sandbox, per-job token, egress allow-list) cannot be proved without a container host, and the vendor material I could reach does not specify Hermes's programmatic invocation surface; a PoC without that would be a mock proving only my own assumptions. What *is* safe and useful to build first is the contract the integration must satisfy, which is independent of Hermes: the `research.hermes` job kind, its `mayAct` check, and a test that a handler given a fake agent that attempts an outbound call is refused. That belongs to H1 and is listed there.

## 11. Open questions for Grant (none block current work)

1. May H1 spend on a sandbox host (Modal/Daytona usage), and what is the monthly ceiling?
2. Is sending project document excerpts to a Hermes-selected model provider acceptable, or must H1 use only our existing router chain?
3. Is the research class (long multi-step web research) one he actually wants more of? Real usage should decide this, per the standing beta rule.
