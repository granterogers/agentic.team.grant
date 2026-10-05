# Preview experiment: excluding static files from the Python function bundles

Evidence for item 2 of `../vercel-storage-audit-2026-10-05.md`. Read that document for the results; this is how to repeat it.

| File | What it is |
|---|---|
| `zz-probe.py` | Experiment-only function, copied into each variant. It lists what is inside its own bundle. Never ship it. |
| `deploy_variants.py` | Creates preview deployments of `ai-team-hq` from the file set `deploy:hq-page` builds. No `target`, so nothing can move a production alias. |
| `verify_variants.py` | Reads each bundle's size from the build output and runs one identical 15-request matrix against every variant. |
| `vercel.proposed.json` | The configuration this evidence supports. **Not applied**; a test pins it to `scripts/deploy/lib/function-exclude.ts`. |

Run from the repository root, with a scratch directory **outside** the repository (it receives a 0600 file holding a throwaway
secret, and the JSON results):

```
export EXP_OUT=<a directory outside the repository>   # contains zz-probe.py as well
export VERCEL_TOKEN=...                                  # never printed by these scripts
python3 deploy_variants.py && python3 verify_variants.py
```

Differences between these copies and what ran on 5 October 2026:

- The two path constants now come from `REPO_ROOT` (default: the current directory) and `EXP_OUT`. As run, they were absolute
  sandbox paths; the repository's secret scan rightly refuses to carry those.
- `deploy_variants.py` is the **second** version. The first run created A, B and C together, but B and C failed to build because
  the first exclusion pattern, a list of 44 names, was 455 characters (Vercel's limit is 256). After shortening the pattern, B and C were created
  again and A was reused with its secret, which is why the script reads `variants.json` and keeps only `A`. To repeat from
  nothing, create A first (its `vercel.json` is the repository's, unchanged) and write `variants.json` and `.exp-secret`, or
  edit the script to create all three.

Safety properties, each asserted in the scripts: every response is checked not to echo the secret or the submitted cookie jar;
the secret is random per run; `scripts/notebook/act.py` and the function sources can never match the exclusion pattern.
