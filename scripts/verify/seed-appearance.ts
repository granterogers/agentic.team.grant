/**
 * Tell the page which scheme the audit is standing in for.
 *
 * `colorScheme` on a Playwright context only sets `prefers-color-scheme`, and
 * the studio's default is an explicit choice now, not the system's:
 * `DEFAULTS.scheme` is `'dark'` because Grant asked for dark concrete. An
 * explicit choice writes `data-scheme` on the root, and every dark block in
 * `skins.css` is guarded `:not([data-scheme="light"])` — so the media query
 * the audit was setting stopped deciding anything, and the "light" leg of four
 * separate audits silently rendered dark. `verify:layouts` reported 25 contrast
 * failures on a correct change; `npm run shots` wrote six PNGs named `-light`
 * that were dark.
 *
 * This is CLAUDE.md's "a verification that feeds the page the wrong payload"
 * with the sign flipped — it went red rather than green, which is the lucky
 * direction. An audit that wants a scheme has to ASK for it the way a person
 * does, through the stored preference, not through a signal the product has
 * been told to ignore.
 *
 * Pass the extra keys the audit already sets (palette, texture) and they are
 * merged, so a caller never has to know the whole shape.
 */
export const seedAppearance = (
  scheme: 'light' | 'dark' | 'system',
  extra: Record<string, string> = {},
): string =>
  `try { localStorage.setItem('studio.appearance', ${JSON.stringify(
    JSON.stringify({ ...extra, scheme }),
  )}) } catch {}`
