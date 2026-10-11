import { parseTaskChecklist, type TaskChecklist, type ChecklistItem, type TaskState } from '../domain/task-checklist.ts'

/** Migration only: no execution, progress or UI consumer interprets Markdown. */
export function convertLegacyChecklist(markdown: string): TaskChecklist {
  const items: ChecklistItem[] = []
  const used = new Set([...markdown.matchAll(/\b([A-Za-z]+\d+)\b/g)].map((match) => match[1]))
  const generated = new Map<string, string>()
  const marks: Record<string, TaskState> = { ' ': 'pending', x: 'done', X: 'done', '!': 'failed', '-': 'blocked' }
  let repo = ''
  let discardedSection = false
  let nextId = 1
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.+)/.exec(line)
    if (heading) {
      discardedSection = /^~~.*~~$/.test(heading[1].trim())
      repo = heading[1].replace(/~~/g, '').trim().replace(/^.*\//, '')
      continue
    }
    const match = /^\s*[-*]\s*\[([ xX!-])\]\s*(.+)/.exec(line)
    if (!match) {
      const last = items.at(-1)
      if (!last) continue
      const note = /^\s+>\s*(.+)/.exec(line)
      if (note) last.notes.push(note[1].trim())
      else if (/^\s+\S/.test(line)) last.context = [last.context, line.trim()].filter(Boolean).join('\n')
      continue
    }
    const discarded = discardedSection || match[2].replace(/^[A-Za-z]+\d+\s+/, '').startsWith('~~')
    const raw = match[2].replace(/~~/g, '').trim()
    const metadata = /\{([^}]*)\}\s*$/.exec(raw)
    const meta: Record<string, string> = {}
    for (const pair of (metadata?.[1] ?? '').split(';')) {
      const colon = pair.indexOf(':')
      if (colon >= 0) meta[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim()
    }
    const body = raw.replace(/\{[^}]*\}\s*$/, '').trim()
    const identified = /^([A-Za-z]+\d+)\s+(.+)/.exec(body)
    let id = identified?.[1]
    if (!id) {
      while (used.has(`T${nextId}`)) nextId++
      id = `T${nextId++}`
      used.add(id)
      generated.set(`#${items.filter((item) => item.state !== 'discarded').length + 1}`, id)
    }
    const list = (key: string) =>
      (meta[key] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value && value !== '-')
    const positive = (key: string) => {
      if (!meta[key]) return undefined
      const value = Number(meta[key])
      if (!Number.isInteger(value) || value < 1) throw new Error(`${id}: ${key} inválido na checklist antiga`)
      return value
    }
    items.push({
      id,
      title: identified?.[2] ?? body,
      repo: meta.app ?? repo,
      files: list('files'),
      requires: list('requires'),
      creates: list('creates'),
      deps: list('deps'),
      context: '',
      completionCriteria: [],
      notes: [],
      state: discarded ? 'discarded' : marks[match[1]],
      ...(discarded ? { discardReason: 'Descartado na checklist original em Markdown' } : {}),
      ...(meta.timeoutMin ? { timeoutMinutes: positive('timeoutMin') } : {}),
      ...(meta.attempts ? { maxAttempts: positive('attempts') } : {}),
    })
  }
  for (const item of items) item.deps = item.deps.map((id) => generated.get(id) ?? id)
  const issue = /^issue:\s*(\S+)/m.exec(markdown)?.[1]
  return parseTaskChecklist({ schemaVersion: 1, ...(issue ? { issue } : {}), items })
}
