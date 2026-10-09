/**
 * The pages allowed to ask the `signin` function for a session. ONE list, read by `deploy:signin` (which sets it with
 * the function) and by `deploy:signin-origin` (which sets only it).
 *
 * Stable aliases only: Vercel gives every deployment its own hostname, so a list that grew one entry per deploy would
 * never shrink. Each origin here can request a sign-in and be a magic-link redirect target, so an entry is a decision.
 *
 * `https://team-hq-ux-review.vercel.app` was added on 9 October 2026 on Grant's explicit instruction: it is the
 * isolated review copy of the Team HQ redesign, a Vercel project of his own that carries no secret and no function.
 */
import '../../../src/safety/require-production-writes.ts'

export const SIGNIN_PAGE_ORIGINS: readonly string[] = [
  'https://ai-team-hq.vercel.app',
  'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app',
  'https://team-hq-ux-review.vercel.app',
]

/** What the list was before the review origin was added: the rollback value. */
export const SIGNIN_PAGE_ORIGINS_BEFORE: readonly string[] = SIGNIN_PAGE_ORIGINS.slice(0, 2)
