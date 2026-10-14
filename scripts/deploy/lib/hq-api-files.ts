/**
 * The files the `hq-api` gateway is uploaded with, flat beside its entrypoint.
 *
 * The entrypoint imports `./file-text.ts`, `./oauth.ts` and `./preview.ts`, each of which is ONE source in `src/`
 * (the `supabase/functions/hq-api/` folder holds symlinks to them for local runs). The list is explicit because the
 * upload is flat; `closureProblems` (lib/bundle.ts) is what proves it is complete, and `tests/deploy/hq-api-files.test.ts`
 * fails the day the entrypoint imports something this list does not carry. `deploy:hq-api` carried three of the four
 * (no `preview.ts`) after 0990 while `deploy:hq` carried all four, so the cheaper command would have uploaded a gateway
 * that fails on its first request.
 */
export const HQ_API_ENTRY = 'index.ts'

export const HQ_API_FILES: readonly { name: string; from: string }[] = [
  { name: 'index.ts', from: 'supabase/functions/hq-api/index.ts' },
  { name: 'file-text.ts', from: 'src/text/file-text.ts' },
  { name: 'oauth.ts', from: 'src/slack/oauth.ts' },
  { name: 'preview.ts', from: 'src/documents/preview.ts' },
  { name: 'background.ts', from: 'src/backgrounds/project-background.ts' },
  { name: 'formats.ts', from: 'src/portability/formats.ts' },
  { name: 'export-route.ts', from: 'src/portability/export-route.ts' },
  { name: 'archive.ts', from: 'src/portability/archive.ts' },
  { name: 'object-store.ts', from: 'src/files/object-store.ts' },
  { name: 'store.ts', from: 'src/files/store.ts' },
  { name: 'originals.ts', from: 'src/portability/originals.ts' },
  { name: 'policy.ts', from: 'src/files/policy.ts' },
  { name: 'links.ts', from: 'src/files/links.ts' },
  { name: 'parts.ts', from: 'src/portability/parts.ts' },
  { name: 'set-store.ts', from: 'src/portability/set-store.ts' },
]
