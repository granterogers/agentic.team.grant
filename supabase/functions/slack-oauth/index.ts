/**
 * The Slack OAuth callback (ADR-0065): where Slack sends a person back after they install the app into their own workspace.
 *
 * `verify_jwt` is false because Slack cannot present a Supabase JWT; what authenticates the request is the single-use,
 * ten-minute `state` that only a signed-in person's session could mint, checked by the database in `slack_link_redeem`. All
 * the logic lives in `./oauth.ts` (the file `scripts/deploy/slack-oauth.ts` uploads from `src/slack/oauth.ts`), the same file
 * the unit tests drive, so what is tested is what runs.
 */
import { handleCallback } from './oauth.ts'

Deno.serve((request: Request) =>
  handleCallback(request, {
    fetch,
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    clientSecret: Deno.env.get('SLACK_CLIENT_SECRET') ?? '',
    siteUrl: Deno.env.get('HQ_SITE_URL') ?? 'https://ai-team-hq.vercel.app',
  }),
)
