# Branch audit — 29 September 2026

Every remote branch was compared with `main` at `831238c2`. Each check used the
branch's commits, `git cherry` patch-ids and, for merge commits, a recomputed
automatic merge. The goal was one canonical `main` and no orphaned production
work.

## Result

| Branch | Head | Commits not on main | Verdict |
|---|---|---|---|
| `claude/371-paused-edges` | `227c68f7` | 0 | merged: delete |
| `claude/373-project-provenance` | `69fc3e6c` | 0 | merged: delete |
| `claude/375-harness` | `ce12e710` | 0 | merged: delete |
| `claude/378-containment` | `939f32ce` | 0 | merged: delete |
| `claude/basecamp-team-hq` | `9c51e1e3` | 0 | merged: delete |
| `claude/dazzling-dirac-acjwqf` | `a8ed7e87` | 0 | merged: delete |
| `claude/human-simulation-harness` | `3bb5bb82` | 0 | merged: delete |
| `claude/jolly-darwin-8rwmp3` | `dcc03386` | 0 | merged: delete |
| `claude/phase-7-communications-kh8ow8` | `3c941508` | 0 | merged: delete |
| `claude/production-reliability` | `7be135f0` | 0 | merged: delete |
| `trial/three-branch-integration-2026-09-24` | `78ba12a1` | 0 | the promoted 24 September trial: delete |
| `claude/378-acceptance-prep` | `7c9c9638` | 1 | its patch is already on main (`git cherry` reports it as merged): tag, then delete |
| `claude/new-session-o2oklu` | `6f9bfe7d` | 2 merge commits | both trees equal the automatic merge of parents that are on main, so they add nothing: tag, then delete |
| `claude/gracious-volta-48lh36` | `85f0a544` | 1 | the three-branch reconnaissance plan. Two main docs cite it, and it was missing from main. **Copied to `docs/integration/three-branch-reconnaissance-2026-09-24.md`**, then tag and delete |
| `claude/docs-onboarding-setup-5nxt5z` | `554ec4e1` | 1 | a 7 September draft of `docs/new-environment.md`. It was superseded by main's own version, which was maintained afterwards. Tag, then delete |
| `claude/agentic-team-integration-rc-dx8x7e` | = main | 0 | working branch, kept |

**Not yet deleted.** The build session's git proxy refuses branch deletions
and tag pushes (HTTP 403); only its working branch and `main` can be pushed.
From any clone with push access, run these commands. They tag first, so a
branch with unique commits stays recoverable as `archive/<branch>`:

```bash
git fetch origin --prune
for b in 378-acceptance-prep docs-onboarding-setup-5nxt5z gracious-volta-48lh36 new-session-o2oklu; do
  git tag "archive/claude/$b" "origin/claude/$b"
done
git push origin 'refs/tags/archive/*'
git push origin --delete \
  claude/371-paused-edges claude/373-project-provenance claude/375-harness \
  claude/378-containment claude/basecamp-team-hq claude/dazzling-dirac-acjwqf \
  claude/human-simulation-harness claude/jolly-darwin-8rwmp3 \
  claude/phase-7-communications-kh8ow8 claude/production-reliability \
  trial/three-branch-integration-2026-09-24 \
  claude/378-acceptance-prep claude/docs-onboarding-setup-5nxt5z \
  claude/gracious-volta-48lh36 claude/new-session-o2oklu
```

Nothing above changes a commit: the tags add refs, the deletes remove them, and
the heads are listed in the table, so any branch can be recreated with
`git push origin <head>:refs/heads/<name>`.

## Left alone: the fresh-install lineage

Four branches carry the unmerged fresh-install work. They are out of scope and
untouched:

| Branch | Head | Note |
|---|---|---|
| `claude/fresh-install-onboarding` | `23ebdf1c` | the 15 fresh-install commits |
| `trial/integration-2026-09-24b` | `07f2312f` | integration candidate carrying fresh-install. Its non-fresh-install fixes are already on main by patch-id |
| `trial/integration-2026-09-24` | `0b570714` | an earlier candidate, superseded by 24b |
| `trial/integration-2026-09-23` | `a479125b` | "NOT FOR MERGE" trial, superseded by 24 and 24b |

The three trial branches differ from main only in fresh-install and
integration-specific resolution commits. Once fresh-install is merged or
abandoned, all four can go.

## Also removed from main

These are removed per #375 item 4. Each defaulted to the production project,
wrote to it, and had no `scripts/isolated/guard.ts`. They are one-offs whose
migrations shipped, and nothing references them.

- `scripts/scratch/approve.ts`: answers a job's blocker with unescaped SQL.
- `scripts/scratch/runone.ts`: calls the global `requeue_retrying()`.
- `scripts/scratch/prove-0592b.sql` … `prove-0599.sql` (7 files): committed
  writes against specific production job ids.
