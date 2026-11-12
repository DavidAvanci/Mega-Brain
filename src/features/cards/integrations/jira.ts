import { apiClient } from '../../../shared/api/api-client'
import { requestJson } from '../../../shared/api/request-json'
import { reportDesktopApiFailure } from '../../../desktopConnection'
import type { Status } from '../../../../shared/domain/cards'
import { JIRA_STATUS_BY_STATUS } from '../../../../shared/domain/jira-status'
import type { WorkspaceFolder } from '../model/card-mappers'

const JIRA_KEY = /^(?!MB-)[A-Z][A-Z0-9]*-\d+$/i

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

export async function fetchJiraStatuses(folders: WorkspaceFolder[]): Promise<Record<string, string>> {
  const keys = folders.map((folder) => folder.name).filter((name) => JIRA_KEY.test(name))
  if (!keys.length) return {}
  try {
    return await apiClient().json(`/api/jira/statuses?keys=${encodeURIComponent(keys.join(','))}`)
  } catch (error) {
    reportDesktopApiFailure(error)
    return {}
  }
}

export function fetchReadyJiraIssues(): Promise<JiraReadyIssue[]> {
  return requestJson('/api/jira/ready', 'Falha ao buscar cards do Jira')
}

export function createJiraIssue(summary: string, description: string, status: Status): Promise<JiraCreateIssueResult> {
  return requestJson<JiraCreateIssueResult>('/api/jira/create', 'Falha ao criar issue no Jira', {
    method: 'POST',
    body: { project: 'ESTR', summary, description, status },
  })
}

export async function transitionJiraStatus(id: string, status: Status): Promise<string | undefined> {
  const jiraStatus = JIRA_STATUS_BY_STATUS[status]
  if (!jiraStatus || !JIRA_KEY.test(id)) return undefined
  const data = await requestJson<{ status?: string }>(
    '/api/jira/transition',
    `Falha ao mover ${id} para "${jiraStatus}" no Jira`,
    {
      method: 'POST',
      body: { key: id, status: jiraStatus },
    },
  )
  return data.status
}
