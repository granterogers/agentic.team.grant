/**
 * A request to create a project, and a "yes" to one (0.117.3). The Cowork test of 24 November 2026 (T11): "Create a new project called
 * Test Pop-up Market" was answered with questions, and after "Yes, go ahead." the team talked of a Notion project that did not exist.
 *
 * A project in Team HQ needs a source: a Notion database or a notebook (app.hq_create_project refuses one without). So the team does
 * not create it from a chat "yes", and it says so plainly, rather than claiming a project it did not make.
 */

const CREATE =
  /\b(?:create|make|start|set\s+up|add)\s+(?:a\s+|an\s+|another\s+|one\s+)?(?:new\s+)?project\b/i
const AFFIRM =
  /^\s*(?:yes|yep|yeah|ok|okay|sure|go\s+ahead|yes,?\s*go\s+ahead|yes,?\s*do\s+it|do\s+it|please\s+do)[\s.!,]*$/i

/** The name the person gave, when they gave one ("called X" / "named X"). */
export function projectNameAsked(text: string): string | null {
  const m = /\b(?:called|named)\s+["“']?([^"”'.?!\n]+?)["”']?\s*(?:[.?!]|$)/i.exec(text)
  const name = m?.[1]?.trim() ?? ''
  return name === '' ? null : name
}

export function projectCreateReplyFor(request: string, lastTurn: string): string | null {
  const asks = CREATE.test(request)
  const yesToCreate = AFFIRM.test(request) && CREATE.test(lastTurn)
  if (!asks && !yesToCreate) return null
  const name = projectNameAsked(asks ? request : lastTurn)
  const what = name === null ? 'That project' : `"${name}"`
  return (
    `${what} has not been created, and nothing has been changed. A project needs a source first: a Notion database or a notebook. ` +
    'Tell me which one it should use, or create it yourself with ☰ → Create project.'
  )
}
