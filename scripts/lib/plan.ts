import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PlanInfo {
  issue?: string
  type: 'fix' | 'feature'
  raw: string
}

export function readPlan(wsPath: string): PlanInfo {
  const file = join(wsPath, 'PLAN.md')
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const issue = /^issue:\s*(\S+)/im.exec(raw)?.[1]
  const type = /^type:\s*(bug|fix)/im.test(raw) ? 'fix' : 'feature'
  return { issue, type, raw }
}

export function planSection(raw: string, headingPattern: RegExp): string {
  const lines = raw.split('\n')
  const start = lines.findIndex((line) => /^#{2,4}\s/.test(line) && headingPattern.test(line))
  if (start === -1) return ''
  const level = (/^#+/.exec(lines[start]) as RegExpExecArray)[0].length
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    const match = /^(#+)\s/.exec(line)
    if (match && match[1].length <= level) break
    body.push(line)
  }
  return body.join('\n').trim()
}

export function itemContext(raw: string, itemId: string): string {
  return planSection(raw, new RegExp(`\\b${itemId}\\b`))
}
