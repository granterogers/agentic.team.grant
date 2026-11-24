/**
 * Requests the team answers in code, before any tool runs (0.116.1).
 *
 * The Cowork test of 24 November 2026 found three requests that should never reach a planner: a request for a password was
 * treated as a web search, "connect my Notion account" began linking a real project to Notion without asking, and "archive the
 * project" was refused with the claim that there is no archive action (there is one). Each is answered here with a fixed
 * sentence, so nothing is searched, connected or changed, and the person is told exactly where to do it.
 */

const SETTINGS = 'https://ai-team-hq.vercel.app/settings/connections'

const SECRET_WORD =
  /\b(?:passwords?|passcodes?|pins?|secrets?|api[\s-]?keys?|tokens?|credentials?|private\s+keys?|2fa|one[\s-]time\s+codes?)\b/i
const SECRET_ASK =
  /\b(?:tell|give|share|send|show|reveal|read\s+me|paste|copy|find|what(?:'s|\s+is)|look\s+up|search\s+for)\b/i

const CONNECT =
  /\b(?:connect|link|sign\s+(?:me\s+)?in\s+to|set\s+up)\s+(?:my|our|the|your)\s+(?:google|gmail|drive|calendar|notion|slack|telegram|notebooklm|vikunja|github|dropbox|onedrive)\b|\b(?:connect|link)\s+(?:google|notion|slack|telegram|notebooklm|vikunja|github)\s+(?:account\s+)?for\s+me\b/i

const ARCHIVE =
  /\barchive\s+(?:the\s+|this\s+|my\s+)?[\w'’ -]{0,60}?\bproject\b|\bproject\b[^.?!]{0,40}\barchive\b/i

/** The fixed answer for a request the team does not carry out, or null when the request is an ordinary one. */
export function refusalFor(request: string): string | null {
  const said = String(request ?? '').trim()
  if (said === '') return null
  if (SECRET_WORD.test(said) && SECRET_ASK.test(said)) {
    return (
      "I won't share a password, key, token or code, and I won't go looking for one. " +
      "Sign-ins stay in the vault. To see or change an account, open Settings → Services and use that service's own page: " +
      SETTINGS +
      '. Nothing has been changed.'
    )
  }
  if (CONNECT.test(said)) {
    return (
      "I can't connect an account for you, and nothing has been connected or changed. " +
      'Connect it yourself in Settings → Services: ' +
      SETTINGS +
      ' (for Google, open ' +
      'https://ai-team-hq.vercel.app/settings/google).'
    )
  }
  if (ARCHIVE.test(said)) {
    return (
      "I haven't archived anything, and I don't archive projects for you. You can do it yourself: open the project, choose " +
      'Project settings → Name, export and archive → Archive. Nothing is deleted, and it can be brought back. ' +
      'Nothing has been changed.'
    )
  }
  return null
}
