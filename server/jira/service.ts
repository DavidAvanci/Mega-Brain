import { systemClock, type Clock } from '../system'

export interface JiraEnv {
  site?: string
  email?: string
  token?: string
}
export const JIRA_KEY_PATTERN = /^(?!MB-)[A-Z][A-Z0-9]*-\d+$/i
export interface JiraTransition {
  id: string
  to?: { name?: string }
}
export interface JiraReadyIssue {
  key: string
  summary: string
  description: string
}
const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'])
export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const { type, text, content } = node as { type?: string; text?: string; content?: unknown[] }
  if (typeof text === 'string') return text
  const inner = (content ?? []).map(adfToText).join('')
  return type && BLOCK_NODES.has(type) ? `${inner}\n` : inner
}
function normalizeStatus(status: string): string {
  return status
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}
export function matchTransition(transitions: JiraTransition[], status: string): JiraTransition | undefined {
  return transitions.find(
    (transition) => transition.to?.name && normalizeStatus(transition.to.name) === normalizeStatus(status),
  )
}
const TTL = 60_000
export interface JiraService {
  ready(): Promise<JiraReadyIssue[]>
  statuses(keys: string): Promise<Record<string, string>>
  transition(key: string, status: string): Promise<{ status?: string }>
}
export interface JiraServiceDependencies {
  clock?: Clock
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function statusName(value: unknown): string | null {
  const fields = record(value)?.fields
  const status = record(fields)?.status
  return typeof record(status)?.name === 'string' ? (record(status)?.name as string) : null
}

function transitions(value: unknown): JiraTransition[] {
  const list = record(value)?.transitions
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    const parsed = record(entry)
    const id = parsed?.id
    const to = record(parsed?.to)
    return typeof id === 'string' ? [{ id, ...(typeof to?.name === 'string' ? { to: { name: to.name } } : {}) }] : []
  })
}

function readyIssues(value: unknown): JiraReadyIssue[] {
  const issues = record(value)?.issues
  if (!Array.isArray(issues)) return []
  return issues.flatMap((entry) => {
    const issue = record(entry)
    const key = issue?.key
    if (typeof key !== 'string') return []
    const fields = record(issue?.fields)
    return [
      {
        key,
        summary: typeof fields?.summary === 'string' ? fields.summary : key,
        description: adfToText(fields?.description).trim(),
      },
    ]
  })
}

export function createJiraService(
  env: JiraEnv,
  request: typeof fetch = fetch,
  dependencies: JiraServiceDependencies = {},
): JiraService {
  const clock = dependencies.clock ?? systemClock
  const cache = new Map<string, { value: string | null; expires: number }>()
  const enabled = () => Boolean(env.site && env.email && env.token)
  const api = (path: string, init?: RequestInit) =>
    request(`https://${env.site}.atlassian.net${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.email}:${env.token}`).toString('base64')}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  const status = async (key: string) => {
    const old = cache.get(key)
    if (old && old.expires > clock.now()) return old.value
    try {
      const res = await api(`/rest/api/3/issue/${key}?fields=status`)
      const value = res.ok ? statusName(await res.json()) : null
      cache.set(key, { value, expires: clock.now() + TTL })
      return value
    } catch {
      return null
    }
  }
  return {
    async ready() {
      if (!enabled()) return []
      const p = new URLSearchParams({
        jql: 'assignee = currentUser() AND status = "READY to do" ORDER BY created ASC',
        fields: 'summary,description',
        maxResults: '100',
      })
      const r = await api(`/rest/api/3/search/jql?${p}`)
      if (!r.ok) throw new Error(`Jira respondeu HTTP ${r.status}`)
      return readyIssues(await r.json())
    },
    async statuses(keys) {
      if (!enabled()) return {}
      const valid = keys
        .split(',')
        .filter((x) => JIRA_KEY_PATTERN.test(x))
        .map((x) => x.toUpperCase())
      const values = await Promise.all(valid.map(async (key) => [key, await status(key)] as const))
      return Object.fromEntries(values.filter((x): x is [string, string] => Boolean(x[1])))
    },
    async transition(key, target) {
      if (!enabled())
        throw new Error('Integração com Jira não configurada. Informe site, e-mail e token em Configurações.')
      if (!JIRA_KEY_PATTERN.test(key) || !target) throw new Error('Requisição inválida: esperado { key, status }')
      const r = await api(`/rest/api/3/issue/${key}/transitions`)
      if (!r.ok) throw new Error(`Jira respondeu HTTP ${r.status}`)
      const transition = matchTransition(transitions(await r.json()), target)
      if (!transition) {
        const current = await status(key)
        if (current && matchTransition([{ id: '', to: { name: current } }], target)) return { status: current }
        throw new Error(`O card ${key} não tem transição para "${target}"`)
      }
      const post = await api(`/rest/api/3/issue/${key}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: transition.id } }),
      })
      if (!post.ok) throw new Error(`Jira respondeu HTTP ${post.status}`)
      const value = transition.to?.name ?? target
      cache.set(key, { value, expires: clock.now() + TTL })
      return { status: value }
    },
  }
}
