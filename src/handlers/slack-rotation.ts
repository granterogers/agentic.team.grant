/**
 * Keep the Slack configuration tokens alive.
 *
 * Slack's app-configuration tokens expire **twelve hours** after they are
 * issued, and the refresh token is single-use: rotating produces a new pair and
 * kills the old one. Miss the window and the pair is dead, and the only way
 * back is a human at https://api.slack.com/apps regenerating it by hand.
 *
 * A GitHub Actions cron used to do this. Actions were switched off on
 * 2026-09-08 and nothing replaced it, so the tokens have been living on
 * whatever `verify:slack` happens to rotate when the suite is run — which is
 * to say, on luck. Twelve hours of nobody running the suite and Grant is back
 * at the Slack dashboard.
 *
 * ## Why this is safe to run unattended and channel tidying is not
 *
 * The duty this handler answers was seeded in 0133 describing channel
 * archiving. That description was wrong about its own job kind: the module
 * behind `office.slack_rotate` is `src/slack/rotation.ts`, which rotates
 * TOKENS. The distinction matters because they sit on opposite sides of a line
 * — rotating a credential is maintenance, and archiving somebody's channels is
 * destructive and belongs behind `npm run slack:tidy -- --go` where a human
 * types the `--go`.
 *
 * ## Why it checks before it rotates
 *
 * `shouldRotate` reads the recorded expiry and says no while there is time
 * left. The refresh token is single-use, so a rotation that was not needed
 * still burns one — and a duty firing every four hours would burn six a day
 * for no reason, each one a chance to fail.
 *
 * ## Why a failure is a completed job
 *
 * Because the interesting state is recorded either way. `rotateAndPersist`
 * writes the failure and touches no credential, so the existing access token
 * keeps working until it expires — that buys hours, and hours are the
 * difference between a retry and a human. Failing the JOB would retry it three
 * times against a refresh token that is already dead, which is how you turn a
 * recoverable problem into a locked-out app.
 */

import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { rotateAndPersist, secondsUntilExpiry, shouldRotate } from '../slack/rotation.ts'
import { sayAs } from '../text/voice.ts'

export interface SlackRotationDeps {
  readonly db: SqlExecutor
  readonly appId: string
  /** Who writes it, when there is something to say. See `src/text/voice.ts`. */
  readonly router?: ProviderRouter | null
}

export function slackRotationHandler(deps: SlackRotationDeps): Handler {
  const { db, appId } = deps
  const router = deps.router ?? null
  return {
    kind: 'office.slack_rotate',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      const state = (
        await db.execute(`
          select c.config_token_expires_at, c.rotation_failures,
                 -- Straight from the vault by name, exactly as
                 -- scripts/slack/rotate.ts reads it. The credentials row has
                 -- no reference column for this one, and inventing a join
                 -- would have failed on the first firing.
                 (select decrypted_secret from vault.decrypted_secrets
                   where name = 'slack.config_refresh_token') as refresh
            from public.slack_app_credentials c
           where c.enabled and c.revoked_at is null
           limit 1
        `)
      ).rows[0] as
        | {
            config_token_expires_at?: string | null
            rotation_failures?: number
            refresh?: string | null
          }
        | undefined

      if (state === undefined) {
        return {
          ...base,
          body: 'No enabled Slack install, so there is nothing to keep alive.',
          announce: false,
        } satisfies HandlerOutput
      }

      const refreshToken = String(state.refresh ?? '')
      if (refreshToken === '') {
        return {
          ...base,
          body:
            'The Slack refresh token is missing from the vault, so the configuration ' +
            'tokens cannot be renewed. Regenerating the pair is a human step: ' +
            'https://api.slack.com/apps → Your App Configuration Tokens.',
          confidence: 'high',
          // Only a human can regenerate the pair, and the window is twelve
          // hours. That earns an interruption.
          announce: true,
          severity: 'important',
        } satisfies HandlerOutput
      }

      const expiresAt =
        state.config_token_expires_at === null || state.config_token_expires_at === undefined
          ? 0
          : Math.floor(new Date(String(state.config_token_expires_at)).getTime() / 1000)

      if (expiresAt !== 0 && !shouldRotate(expiresAt)) {
        const hours = Math.round(secondsUntilExpiry(expiresAt) / 360) / 10
        return {
          ...base,
          // Every four hours, three times out of four. Not news.
          body: `Slack tokens are good for another ${String(hours)} hours. Left alone.`,
          announce: false,
        } satisfies HandlerOutput
      }

      const outcome = await rotateAndPersist(
        { execute: (sql) => db.execute(sql) },
        appId,
        refreshToken,
      )

      if (outcome.kind === 'failed') {
        /*
          THE ONE BRANCH THAT SPENDS A MODEL, and it claimed it had not.

          `base` carries `path: 'deterministic_retrieval'` and is spread into
          all five returns. Four of them are templated and the claim is true.
          This one asks `sayAs` to explain the failure to Grant — so the moment
          renewal actually failed, the handler spent an inference, claimed
          determinism, and `enforce_deterministic_claim` correctly refused the
          output and failed the job.

          Ten of them failed that way between 16 and 18 September. The config
          token expired with nobody told, because the branch that exists to
          speak up is the branch the check silenced. Grant found out when a
          chore appeared on his own task list.

          `howComposed` reads the record instead of asserting: if anything
          spent a model against this correlation, this is inference, and the
          answer goes through review rather than being thrown away.
        */
        const body = await sayAs(db, router, 'operations-director', {
          purpose:
            'Tell Grant the Slack tokens could not be renewed, and what that ' +
            'means for him. This one is worth his attention — say what he ' +
            'has to do, if anything, and keep the link exactly as given.',
          facts: [
            `the renewal failed with: ${outcome.error}`,
            outcome.needsHuman
              ? 'the refresh token itself is dead, so retrying cannot fix it'
              : 'the token we already hold still works until it expires, and this will retry',
            outcome.needsHuman
              ? 'a human must regenerate the pair at https://api.slack.com/apps under Your App Configuration Tokens'
              : 'no action is needed from Grant yet',
          ],
          fallback:
            `Could not renew the Slack tokens: ${outcome.error}\n\n` +
            (outcome.needsHuman
              ? 'The refresh token itself is dead, so no retry will fix it. Regenerate ' +
                'the pair at https://api.slack.com/apps → Your App Configuration Tokens.'
              : 'The token we hold still works until it expires, and this will be ' +
                'tried again shortly.'),
          // #268: attributed, so the call lands under this job KIND.
          job: { jobId: job.jobId, correlationId: job.correlationId },
          words: 60,
        })
        return {
          ...base,
          body,
          path: await howComposed(db, job.jobId),
          confidence: 'high',
          announce: true,
          severity: outcome.needsHuman ? 'important' : 'routine',
        } satisfies HandlerOutput
      }

      const hours = Math.round(secondsUntilExpiry(outcome.expiresAt) / 360) / 10
      const plain = `Slack tokens renewed. Good for another ${String(hours)} hours.`
      return {
        ...base,
        // Silent, and that is the real answer to Grant's complaint.
        //
        // The first attempt at this was to have Marcus WRITE the sentence
        // instead of templating it, and three runs produced "Renewed Slack
        // tokens; they last about 12 hours", "Renewed Slack tokens – they last
        // about 12 hours", "Slack tokens renewed; new pair valid ~12 hrs".
        // Varied, and still obviously not a person.
        //
        // Because the tell was never the phrasing. It is that a colleague does
        // not message you twice a day to say a background token was renewed.
        // No wording passes that test; not sending it does. It shows on the
        // Set up page for anyone who wants to check, and it speaks up when it
        // FAILS, which is the case that needs a human.
        body: plain,
        announce: false,
      } satisfies HandlerOutput
    },
  }
}
