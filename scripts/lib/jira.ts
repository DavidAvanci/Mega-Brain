import { loadEnv } from './env.ts'

export const JIRA_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/

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

async function jiraFetch(env: JiraEnv, path: string, init: RequestInit = {}): Promise<any> {
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

function firstText(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (typeof node.text === 'string') return node.text
  for (const child of node.content ?? []) {
    const found = firstText(child)
    if (found) return found
  }
  return ''
}

export async function upsertComment(env: JiraEnv, key: string, title: string, body: AdfNode): Promise<void> {
  const existing = await jiraFetch(env, `/rest/api/3/issue/${key}/comment?maxResults=100`)
  const found = (existing?.comments ?? []).find((comment: any) => firstText(comment.body).trim().startsWith(title))
  const payload = JSON.stringify({ body })
  if (found) await jiraFetch(env, `/rest/api/3/issue/${key}/comment/${found.id}`, { method: 'PUT', body: payload })
  else await jiraFetch(env, `/rest/api/3/issue/${key}/comment`, { method: 'POST', body: payload })
}

export async function currentStatus(env: JiraEnv, key: string): Promise<string> {
  const data = await jiraFetch(env, `/rest/api/3/issue/${key}?fields=status`)
  return data?.fields?.status?.name ?? ''
}

export async function transitionTo(env: JiraEnv, key: string, statusName: string): Promise<boolean> {
  const status = await currentStatus(env, key)
  if (status.toUpperCase() === statusName.toUpperCase()) return false
  const data = await jiraFetch(env, `/rest/api/3/issue/${key}/transitions`)
  const target = (data?.transitions ?? []).find(
    (transition: any) =>
      transition.name?.toUpperCase() === statusName.toUpperCase() ||
      transition.to?.name?.toUpperCase() === statusName.toUpperCase(),
  )
  if (!target) throw new Error(`Transição para "${statusName}" indisponível a partir de "${status}" em ${key}`)
  await jiraFetch(env, `/rest/api/3/issue/${key}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: target.id } }),
  })
  return true
}
