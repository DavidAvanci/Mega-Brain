import { basename } from 'node:path'
import { readPlan, type PlanInfo } from './plan.ts'

export const JIRA_KEY = /^(?!MB-)[A-Z][A-Z0-9]*-\d+$/i

export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'task'
}

export function taskJiraKey(wsPath: string, plan: PlanInfo = readPlan(wsPath)): string | undefined {
  const folder = basename(wsPath)
  if (JIRA_KEY.test(folder)) return folder.toUpperCase()
  return plan.issue && JIRA_KEY.test(plan.issue) ? plan.issue.toUpperCase() : undefined
}

export function taskId(wsPath: string, plan: PlanInfo = readPlan(wsPath)): string {
  return taskJiraKey(wsPath, plan) ?? slugify(basename(wsPath))
}
