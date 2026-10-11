/**
 * The order Hermes ships in (Hermes, M6): the worker that can answer a Hermes-chosen turn goes first, then the voice door that lets a
 * person choose it.
 *
 * The voice function records the person's choice on their message. A worker that predates the engine seam does not read it, so a
 * message the person sent to Hermes would be answered by the team with nothing to say it was not Hermes: the wrong engine, silently,
 * which is the one thing this feature promises never to do. So `deploy:voice` reads the LIVE worker bundle and refuses to ship the door
 * unless the worker already carries the two engine calls in the handler.
 *
 * Pure: bytes of module sources in, a verdict out. The caller fetches the bundle.
 */

/** The two names the handler's engine seam is made of; both must be in a worker that can answer a Hermes turn. */
export const ENGINE_SEAM_NAMES = ['engineRunFor', 'commandEngine'] as const

export interface SeamVerdict {
  readonly ready: boolean
  /** The names the bundle does not carry. */
  readonly missing: readonly string[]
  /** How many modules were read: zero means there was nothing to judge, which is never "ready". */
  readonly modulesRead: number
}

/**
 * Whether a worker bundle (the decoded text of each of its source modules) carries the engine seam.
 *
 * A name counts only as an awaited CALL (`await engineRunFor(`), which is how the handler consumes it. A comment, an import line or
 * the function's own declaration is not a call, and an empty bundle is not ready.
 */
export const workerCanAnswerHermes = (sources: readonly string[]): SeamVerdict => {
  const stripped = sources.map((s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
  )
  const missing = ENGINE_SEAM_NAMES.filter(
    (name) => !stripped.some((s) => new RegExp(`\\bawait\\s+${name}\\s*\\(`).test(s)),
  )
  return {
    ready: stripped.length > 0 && missing.length === 0,
    missing,
    modulesRead: stripped.length,
  }
}
