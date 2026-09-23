import { loadEnv } from './env.ts'

export const JIRA_KEY = /^(?!MB-)[A-Z][A-Z0-9]*-\d+$/i

export interface JiraEnv {
  site: string
  email: string
  token: string
}

export function jiraEnv(): JiraEnv | null {
  const env = loadEnv()
  if (!env.JIRA_SITE || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) return null
  return { site: env.JIRA_SITE, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

async function jiraFetch(env: JiraEnv, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`https://${env.site}.atlassian.net${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.email}:${env.token}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  })
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200)
    throw new Error(`Jira ${init.method ?? 'GET'} ${path} → HTTP ${response.status}: ${body}`)
  }
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

type AdfNode = Record<string, unknown>

const text = (value: string, marks?: AdfNode[]): AdfNode => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const paragraph = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content })
const heading = (level: number, value: string): AdfNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
})

export function prsCommentAdf(title: string, prs: Record<string, string>, sections: [string, string][]): AdfNode {
  return {
    version: 1,
    type: 'doc',
    content: [
      heading(1, title),
      {
        type: 'bulletList',
        content: Object.entries(prs).map(([repo, url]) => ({
          type: 'listItem',
          content: [paragraph(text(repo, [{ type: 'link', attrs: { href: url } }]))],
        })),
      },
      ...sections.flatMap(([name, body]) => [
        heading(2, name),
        ...body
          .split(/\n{2,}/)
          .map((chunk) => chunk.trim())
          .filter(Boolean)
          .map((chunk) => paragraph(text(chunk.replace(/\s*\n\s*/g, ' ')))),
      ]),
    ],
  }
}

export function textCommentAdf(value: string): AdfNode {
  return { version: 1, type: 'doc', content: [paragraph(text(value))] }
}

function firstText(node: unknown): string {
  const parsed = record(node)
  if (!parsed) return ''
  if (typeof parsed.text === 'string') return parsed.text
  const content = parsed.content
  if (!Array.isArray(content)) return ''
  for (const child of content) {
    const found = firstText(child)
    if (found) return found
  }
  return ''
}

export async function upsertComment(env: JiraEnv, key: string, title: string, body: AdfNode): Promise<void> {
  const existing = record(await jiraFetch(env, `/rest/api/3/issue/${key}/comment?maxResults=100`))
  const comments = Array.isArray(existing?.comments) ? existing.comments.map(record) : []
  const found = comments.find((comment) => firstText(comment?.body).trim().startsWith(title))
  const payload = JSON.stringify({ body })
  if (typeof found?.id === 'string')
    await jiraFetch(env, `/rest/api/3/issue/${key}/comment/${found.id}`, { method: 'PUT', body: payload })
  else await jiraFetch(env, `/rest/api/3/issue/${key}/comment`, { method: 'POST', body: payload })
}

export async function currentStatus(env: JiraEnv, key: string): Promise<string> {
  const data = record(await jiraFetch(env, `/rest/api/3/issue/${key}?fields=status`))
  const fields = record(data?.fields)
  const status = record(fields?.status)
  return typeof status?.name === 'string' ? status.name : ''
}

export async function transitionTo(env: JiraEnv, key: string, statusName: string): Promise<boolean> {
  const status = await currentStatus(env, key)
  if (status.toUpperCase() === statusName.toUpperCase()) return false
  const data = record(await jiraFetch(env, `/rest/api/3/issue/${key}/transitions`))
  const transitions = Array.isArray(data?.transitions) ? data.transitions.map(record) : []
  const target = transitions.find((transition) => {
    const to = record(transition?.to)
    const transitionName = transition?.name
    const targetName = to?.name
    return (
      (typeof transitionName === 'string' && transitionName.toUpperCase() === statusName.toUpperCase()) ||
      (typeof targetName === 'string' && targetName.toUpperCase() === statusName.toUpperCase())
    )
  })
  if (!target || typeof target.id !== 'string')
    throw new Error(`Transição para "${statusName}" indisponível a partir de "${status}" em ${key}`)
  await jiraFetch(env, `/rest/api/3/issue/${key}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: target.id } }),
  })
  return true
}
