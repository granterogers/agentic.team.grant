# Global Settings: audit and redesign, 3 October 2026

Scope: the page opened from the rail's Settings. Project settings (`.bcsetframe`) were not touched.

## What the page is for

Global Settings answers four questions about the whole of Team HQ, in the order a person asks them:

1. **Your team**: who works for me, how far may they go on their own, what are they asking me, what have they learned.
2. **Connections**: which accounts can they reach, how do they reach me.
3. **You**: how Team HQ looks to me.
4. **System**: what it costs and whether it is healthy; where to get help.

Anything about one project belongs in that project's settings. The page now says so under its title.

## What was wrong (measured, not assumed)

| Finding | Evidence | Fix |
|---|---|---|
| Appearance offered light/dark, texture and density; none changed anything in Team HQ | Toggling each left every computed style identical. The accent token (`--bc-accent`, 80+ uses) was the only lever | Replaced with a real **Accent colour** control wired to the token; scheme is stated as a fact (Dark) |
| Two Settings tabs for Telegram/Slack (Services and Channels), plus a Setup tab repeating Connections | Same rows in three places | Services (accounts), Messaging (how it reaches you); Setup folded in |
| "Governance" mixed an inbox, a memory and diagnostics | One page held open requests, standing rules, refusals, failures | Split into **Requests** (decisions waiting), **What it has learned** (rules), diagnostics under **Usage and health → Details** |
| Developer wording (RPC, vault, slug, ledger, "Setting up") | Copy audit | Rewritten person-facing; terms consistent ("Team Chat", "Talk to Team") |
| Quiet hours control with no effect | No reader | Removed |
| Save feedback invisible | `said` text written to a node the redraw replaced | Rows now carry their own status line beside the control (toast builder exists, not yet wired) |
| Narrowing autonomy asked for confirmation | `chosen !== 'suggest'` also matched Watch only | Only widening (Act, then show me / Act) confirms |
| Native `confirm()`/`prompt()` for risky actions | 12 call sites | In-page dialogs with plain titles, danger styling, Escape, focus return |
| Tab walked into the shell hidden behind the full-page Settings | Playwright Tab trace | Shell is `inert` while Settings is open; Back returns focus to where it came from |
| Initials under portraits drawn at 11.5px | Size scan | 13px, white on tint |

## Information architecture

```
Your team   Team · Autonomy and approvals · Requests · What it has learned
Connections Services · Messaging
You         Appearance
System      Usage and health · Help
```

Phone: the section list is the first screen; choosing one drills in with a Back to Settings; nothing is squeezed.

Danger is separated: disconnecting, retiring a person and declining are confirmed in a dialog that names what stops and what stays. Technical values (providers, MCP, database) are under *Behind the scenes* / *Details for the curious*, collapsed.

## Policy preserved, not changed

The Autonomy page states the existing rule without altering it: the team may message you on its own; contacting anyone else is written by the team and waits for your yes before it is sent. No authorisation logic, RPC or default was changed. Team Chat (voice note, transcribed into a message) and Talk to Team (live conversation) remain separate concepts in Help.

## Files

`web/studio/settings-ui.css` (scoped design layer), `settings-ui.js` (builders), `settings-copy.js` (copy and accents), `settings.js` (groups and routes), `app.js` (section bodies and wiring), `bc/tokens.css` (accent palettes). Capture: `scripts/p5/settings-shots.ts`. Checks: `scripts/p5/settings-qa.ts`, `tests/web/settings-accents.test.ts`.

## Known gaps

- Writer-mode controls (signed in) were exercised by the existing suites and the page's own prototype data, not against the live office, by instruction.
- `scripts/verify/{studio,layouts,controls,keyboard,system}.ts` still address the old DOM (`.setbody`, `role=tab`, `governance`); updated: `wired`, `ui`, `smoke`.
- `usage.js` keeps now-unused card builders; dead wiring for scheme/density/texture remains inert in `wireAppearance`.
- Person editor copy (bot select labels, Skills helper text) not yet rewritten.
