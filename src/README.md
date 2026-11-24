# Team HQ: the server side

TypeScript that runs the team. About 317 files and 97,000 lines. The database is the system; these modules read from it, decide what to do next, and write the result back.

## The main parts

| Folder | What it does |
|---|---|
| `jobs/` | The job engine: a queue of work, its states, retries, and the worker that drains it. `jobs/worker.ts` states the rule the system is built on |
| `agents/` | The team: each colleague's remit and style, how a request is understood, and how the answer is written |
| `providers/` | The model router. It tries free models in order, fails over between them, and releases an answer only inside the answer format (`providers/envelope.ts`) |
| `handlers/` | The entry points for each kind of request: an instruction from the chat, a reminder, a briefing |
| `channels/`, `slack/`, `telegram/` | Adapters for Slack and Telegram. They translate messages in and out and decide nothing |
| `db/`, `migrations/` | Access to Postgres and the migration ledger. Migrations are applied once, in order, and recorded |
| `knowledge/`, `documents/`, `files/` | Documents attached to projects, and their full-text search |
| `google/`, `notion/`, `mcp/`, `browser/` | Connections to outside services, each shown with its own status |
| `safety/` | The production gate and provenance checks: the rules that stop a command from touching production by accident |
| `auth/`, `credentials/` | Who is signed in, and how secrets are held (in the vault, never in the repository) |

## Rules this folder follows

- **Adapters translate; they do not decide.** The decision lives in one place.
- **Nothing that changes the outside world happens silently.** Sends, payments and connections wait for a person.
- **A check must be able to fail.** Each suite is written so that deleting the feature would make it go red.
- **Secrets never appear in the repository, logs or reports.** `npm run check:secrets` runs before every push.

Run the unit suite with `npm test`. Run the core gate with `npm run verify`.
