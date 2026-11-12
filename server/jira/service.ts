import { systemClock, type Clock } from '../system'
import { BoundedCache } from '../../shared/lib/bounded-cache'
import type { Status } from '../../shared/domain/cards'
import { DEFAULT_JIRA_STATUS, JIRA_STATUS_BY_STATUS } from '../../shared/domain/jira-status'

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
export interface JiraCreateIssueResult {
  key: string
  sprintName: string
  sprintAdded: boolean
  statusWarning?: string
  sprintWarning?: string
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
const DELIVERY_DOWNSTREAM_BOARD_ID = 135
export interface JiraService {
  ready(): Promise<JiraReadyIssue[]>
  statuses(keys: string): Promise<Record<string, string>>
  transition(key: string, status: string): Promise<{ status?: string }>
  createIssue(input: { project: string; summary: string; description: string; status?: Status }): Promise<JiraCreateIssueResult>
}
export interface JiraServiceDependencies {
  clock?: Clock
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

async function jiraErrorMessage(response: Response): Promise<string> {
  const fallback = `Jira respondeu HTTP ${response.status}`
  let raw: string
  try {
    raw = await response.text()
  } catch {
    return fallback
  }
  if (!raw.trim()) return fallback

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    // Some Jira gateways return a text or HTML error page instead of Jira's JSON envelope.
    const text = raw.replace(/<[^>]*>/g, ' ')
    const detail = cleanJiraErrorDetail(text)
    return detail ? `${fallback}: ${detail}` : fallback
  }
  const fields = record(payload)
  const parts: string[] = []
  if (Array.isArray(fields?.errorMessages)) {
    parts.push(...fields.errorMessages.filter((item): item is string => typeof item === 'string'))
  }
  for (const key of ['message', 'detail', 'title']) {
    if (typeof fields?.[key] === 'string') parts.push(fields[key] as string)
  }
  const errors = record(fields?.errors)
  if (errors) {
    for (const [field, message] of Object.entries(errors)) {
      if (typeof message === 'string') parts.push(`${field}: ${message}`)
    }
  }
  const detail = cleanJiraErrorDetail(parts.join('; ') || raw)
  return detail ? `${fallback}: ${detail}` : fallback
}

function cleanJiraErrorDetail(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
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
  const cache = new BoundedCache<string, { value: string | null; expires: number }>(1000)
  let authenticatedAccountId: string | undefined
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
      const now = clock.now()
      cache.prune((entry) => entry.expires <= now)
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
      const now = clock.now()
      cache.prune((entry) => entry.expires <= now)
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
    async createIssue(input) {
      if (!enabled()) throw new Error('Integração com Jira não configurada. Informe site, e-mail e token em Configurações.')
      const project = input.project.trim().toUpperCase()
      const summary = input.summary.trim()
      if (!/^[A-Z][A-Z0-9]+$/.test(project) || !summary) throw new Error('Projeto ou título inválido')
      const paragraphs = input.description.split(/\r?\n/).map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      }))
      const sprintResponse = await api(
        `/rest/agile/1.0/board/${DELIVERY_DOWNSTREAM_BOARD_ID}/sprint?state=active`,
      )
      if (!sprintResponse.ok) throw new Error(await jiraErrorMessage(sprintResponse))
      const sprintPayload = record(await sprintResponse.json())
      const sprintList = Array.isArray(sprintPayload?.values) ? sprintPayload.values : []
      const sprint = sprintList
        .map(record)
        .find((candidate) => candidate?.state === 'active' && typeof candidate.id === 'number')
      if (!sprint || typeof sprint.id !== 'number' || typeof sprint.name !== 'string')
        throw new Error('Não há sprint ativa no board Delivery - Downstream')
      if (!authenticatedAccountId) {
        const currentUser = await api('/rest/api/3/myself')
        if (!currentUser.ok) throw new Error(await jiraErrorMessage(currentUser))
        const accountId = record(await currentUser.json())?.accountId
        if (typeof accountId !== 'string' || !accountId)
          throw new Error('Jira não retornou a conta do usuário autenticado')
        authenticatedAccountId = accountId
      }
      const response = await api('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            project: { key: project },
            summary,
            description: { type: 'doc', version: 1, content: paragraphs },
            issuetype: { name: 'Tarefa' },
            assignee: { accountId: authenticatedAccountId },
          },
        }),
      })
      if (!response.ok) throw new Error(await jiraErrorMessage(response))
      const result = record(await response.json())
      if (typeof result?.key !== 'string' || !JIRA_KEY_PATTERN.test(result.key))
        throw new Error('Jira criou a issue, mas não retornou uma chave válida')
      const key = result.key.toUpperCase()
      let sprintWarning: string | undefined
      let statusWarning: string | undefined
      const targetStatus = JIRA_STATUS_BY_STATUS[input.status ?? 'a-fazer'] ?? DEFAULT_JIRA_STATUS
      try {
        const transitionResponse = await api(`/rest/api/3/issue/${key}/transitions`)
        if (!transitionResponse.ok) throw new Error(await jiraErrorMessage(transitionResponse))
        const availableTransitions = transitions(await transitionResponse.json())
        const currentStatus = await status(key)
        let transition = matchTransition(availableTransitions, targetStatus)
        let finalStatus = targetStatus

        if (!transition && currentStatus && normalizeStatus(currentStatus) === normalizeStatus(targetStatus)) {
          finalStatus = currentStatus
        } else if (!transition && targetStatus !== DEFAULT_JIRA_STATUS) {
          finalStatus = DEFAULT_JIRA_STATUS
          transition = matchTransition(availableTransitions, DEFAULT_JIRA_STATUS)
          if (!transition && currentStatus && normalizeStatus(currentStatus) === normalizeStatus(DEFAULT_JIRA_STATUS)) {
            finalStatus = currentStatus
          }
        }

        if (transition) {
          const statusResponse = await api(`/rest/api/3/issue/${key}/transitions`, {
            method: 'POST',
            body: JSON.stringify({ transition: { id: transition.id } }),
          })
          if (!statusResponse.ok) throw new Error(await jiraErrorMessage(statusResponse))
        } else if (!currentStatus || normalizeStatus(currentStatus) !== normalizeStatus(finalStatus)) {
          statusWarning = `Não foi possível definir o status ${targetStatus}; confirme se a issue ficou em ${DEFAULT_JIRA_STATUS}.`
        }
      } catch (error) {
        statusWarning = error instanceof Error ? error.message : String(error)
      }
      try {
        const moveResponse = await api(`/rest/agile/1.0/sprint/${sprint.id}/issue`, {
          method: 'POST',
          body: JSON.stringify({ issues: [key] }),
        })
        if (!moveResponse.ok) sprintWarning = await jiraErrorMessage(moveResponse)
      } catch {
        sprintWarning = 'Não foi possível confirmar a inclusão na sprint ativa. Confira a issue no Jira antes de tentar novamente.'
      }
      return {
        key,
        sprintName: sprint.name,
        sprintAdded: !sprintWarning,
        ...(statusWarning ? { statusWarning } : {}),
        ...(sprintWarning ? { sprintWarning } : {}),
      }
    },
  }
}
