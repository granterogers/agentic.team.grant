/**
 * Microsoft To Do, as the gateway reads it: the lists the account holds, and a connection test (ADR-0076, 1095).
 *
 * The worker's provider lives in `src/tasks/microsoft-todo.ts`. This file is the gateway's own small reader, because
 * `hq-api` is a Deno function and cannot import from `src/`. It is kept to the three calls the Settings card needs:
 * an access token, the lists, and a test that creates one clearly named task, reads it back, deletes it and confirms
 * it is gone.
 *
 * ## Nothing secret leaves this file
 *
 * The client secret and the refresh token are read with the service key and used here. Errors name the step and the
 * status, never a token, and the result of the test carries only what each step did.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const SCOPE = 'Tasks.ReadWrite offline_access'
const TEST_TITLE = 'Team HQ connection test (safe to delete)'
const PAGES = 10

/** What the gateway lends this file: the office's held credentials and the database, nothing else. */
export interface MicrosoftContext {
  readonly office: string
  readonly held: (name: string) => Promise<string>
  readonly rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>
}

export interface ListChoice {
  readonly id: string
  readonly name: string
  readonly default: boolean
}

export interface TestStep {
  readonly step: string
  readonly ok: boolean
  readonly detail: string
}

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

/**
 * An access token for the office's connection, and the store of any refresh token Microsoft rotated. The rotated token
 * is stored BEFORE the token is used, because the old one may stop working at once.
 */
async function accessToken(ctx: MicrosoftContext): Promise<Outcome<string>> {
  const clientId = await microsoftClientId(ctx)
  const secret = await ctx.held('microsoft.client_secret')
  const refresh = await ctx.held('microsoft_todo.refresh_token')
  if (clientId === '' || secret === '' || refresh === '') {
    return {
      ok: false,
      error: 'Microsoft To Do is not connected yet. Connect it in Settings and try again.',
    }
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: 'refresh_token',
      refresh_token: refresh,
      scope: SCOPE,
    }).toString(),
  })
  const said = (await res.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    error?: string
  }
  if (!res.ok || typeof said.access_token !== 'string') {
    if (said.error === 'invalid_grant' || said.error === 'unauthorized_client') {
      return {
        ok: false,
        error:
          'Microsoft has withdrawn the connection. Disconnect, then connect again in Settings.',
      }
    }
    return {
      ok: false,
      error: `Microsoft did not renew the connection (http ${String(res.status)}).`,
    }
  }
  if (typeof said.refresh_token === 'string' && said.refresh_token !== '') {
    await ctx.rpc('microsoft_todo_store_rotation', {
      p_office: ctx.office,
      p_refresh_token: said.refresh_token,
    })
  }
  return { ok: true, value: said.access_token }
}

async function microsoftClientId(ctx: MicrosoftContext): Promise<string> {
  const config = (await ctx.rpc('microsoft_oauth_config', {})) as { client_id?: string } | null
  return String(config?.client_id ?? '')
}

interface Reply {
  readonly status: number
  readonly json: unknown
}

async function graph(token: string, method: string, url: string, body?: unknown): Promise<Reply> {
  const res = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'outlook.body-content-type="text"',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, json }
}

/** The lists the account holds, Microsoft's default one marked. Paged, and refused rather than cut short. */
export async function microsoftLists(ctx: MicrosoftContext): Promise<Outcome<ListChoice[]>> {
  const token = await accessToken(ctx)
  if (!token.ok) return token
  return await listsWith(token.value)
}

async function listsWith(token: string): Promise<Outcome<ListChoice[]>> {
  const out: ListChoice[] = []
  let next: string | null = '/me/todo/lists?$top=100'
  for (let page = 0; next !== null; page += 1) {
    if (page >= PAGES)
      return { ok: false, error: 'Microsoft lists more To Do lists than this page can show.' }
    const reply: Reply = await graph(token, 'GET', next)
    if (reply.status !== 200) {
      return {
        ok: false,
        error: `Microsoft refused the list of To Do lists (http ${String(reply.status)}).`,
      }
    }
    const got = reply.json as {
      value?: Array<{ id?: string; displayName?: string; wellknownListName?: string }>
      '@odata.nextLink'?: string
    }
    for (const l of got.value ?? []) {
      if (typeof l.id === 'string') {
        out.push({
          id: l.id,
          name: String(l.displayName ?? ''),
          default: l.wellknownListName === 'defaultList',
        })
      }
    }
    next = got['@odata.nextLink'] ?? null
  }
  return { ok: true, value: out }
}

/**
 * The connection test: a task is made in the chosen list, read back, deleted, and its absence confirmed. Each step is
 * reported in words. If the task was made, the delete is always attempted, so a failed read does not leave it behind.
 */
export async function microsoftTest(
  ctx: MicrosoftContext,
  listId: string,
): Promise<{ ok: boolean; steps: TestStep[] }> {
  const steps: TestStep[] = []
  const token = await accessToken(ctx)
  if (!token.ok) {
    steps.push({ step: 'connection', ok: false, detail: token.error })
    return { ok: false, steps }
  }
  steps.push({ step: 'connection', ok: true, detail: 'Microsoft renewed the connection.' })

  const lists = await listsWith(token.value)
  if (!lists.ok) {
    steps.push({ step: 'lists', ok: false, detail: lists.error })
    return { ok: false, steps }
  }
  const chosen = lists.value.find((l) => l.id === listId)
  if (chosen === undefined) {
    steps.push({
      step: 'list',
      ok: false,
      detail: 'The chosen list is not in this account. Choose a list again.',
    })
    return { ok: false, steps }
  }
  steps.push({ step: 'list', ok: true, detail: `Using "${chosen.name}".` })

  const path = `/me/todo/lists/${encodeURIComponent(listId)}/tasks`
  const made = await graph(token.value, 'POST', path, {
    title: TEST_TITLE,
    body: {
      contentType: 'text',
      content: 'Made by Team HQ to check the connection. It is deleted at the end of the test.',
    },
  })
  const taskId = (made.json as { id?: string } | null)?.id
  if (made.status !== 201 || typeof taskId !== 'string') {
    steps.push({
      step: 'create',
      ok: false,
      detail: `Microsoft did not take the test task (http ${String(made.status)}).`,
    })
    return { ok: false, steps }
  }
  steps.push({ step: 'create', ok: true, detail: 'A test task was made in the list.' })

  const taskUrl = `${path}/${encodeURIComponent(taskId)}`
  const read = await graph(token.value, 'GET', taskUrl)
  const title = (read.json as { title?: string } | null)?.title
  steps.push(
    read.status === 200 && title === TEST_TITLE
      ? { step: 'read back', ok: true, detail: 'The test task reads back with its title.' }
      : {
          step: 'read back',
          ok: false,
          detail: `The test task did not read back (http ${String(read.status)}).`,
        },
  )

  const removed = await graph(token.value, 'DELETE', taskUrl)
  steps.push(
    removed.status === 204
      ? { step: 'delete', ok: true, detail: 'The test task was deleted.' }
      : {
          step: 'delete',
          ok: false,
          detail: `Microsoft did not delete the test task (http ${String(removed.status)}). Delete "${TEST_TITLE}" by hand.`,
        },
  )

  const gone = await graph(token.value, 'GET', taskUrl)
  steps.push(
    gone.status === 404
      ? { step: 'gone', ok: true, detail: 'It is no longer in the list.' }
      : {
          step: 'gone',
          ok: false,
          detail: `The test task is still there (http ${String(gone.status)}).`,
        },
  )

  return { ok: steps.every((s) => s.ok), steps }
}
