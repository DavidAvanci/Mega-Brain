import { readFileSync, writeFileSync } from 'node:fs'

export type ItemState = 'pending' | 'done' | 'failed' | 'blocked'

export interface Item {
  id: string
  explicitId: boolean
  text: string
  repo: string
  files: string[]
  deps: string[]
  details: string[]
  state: ItemState
}

const ITEM = /^(\s*[-*]\s*\[)([ xX!-])(\]\s*)(?:([A-Za-z]+\d+)\s+)?(.*?)\s*$/
const META = /\{([^}]*)\}\s*$/
const STRUCK = /^~~.*~~$/
const STATES: Record<string, ItemState> = { ' ': 'pending', x: 'done', X: 'done', '!': 'failed', '-': 'blocked' }
const MARKS: Record<ItemState, string> = { pending: ' ', done: 'x', failed: '!', blocked: '-' }

export function stripMeta(text: string): string {
  return text.replace(META, '').trim()
}

function parseLine(line: string) {
  const match = ITEM.exec(line)
  if (!match || !match[5]) return null
  return match
}

export function parseChecklist(md: string): Item[] {
  let repo = ''
  let discardedSection = false
  let skipping = false
  const items: Item[] = []
  for (const line of md.split('\n')) {
    const heading = /^##\s+(.*)/.exec(line)
    if (heading) {
      const title = heading[1].trim()
      discardedSection = STRUCK.test(title)
      skipping = discardedSection
      repo = title.replace(/^~~|~~$/g, '').trim().replace(/^.*\//, '')
      continue
    }
    const match = parseLine(line)
    if (!match) {
      const detail = /^\s+(?!>)(\S.*)$/.exec(line)
      if (detail && !skipping && items.length) items[items.length - 1].details.push(detail[1].trim())
      continue
    }
    skipping = discardedSection || match[5].startsWith('~~')
    if (skipping) continue
    const metaRaw = META.exec(match[5])?.[1] ?? ''
    const meta: Record<string, string> = {}
    for (const pair of metaRaw.split(';')) {
      const idx = pair.indexOf(':')
      if (idx !== -1) meta[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    }
    const list = (key: string) =>
      (meta[key] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value && value !== '-')
    items.push({
      id: match[4] ?? `#${items.length + 1}`,
      explicitId: Boolean(match[4]),
      text: stripMeta(match[5]),
      repo: meta.app ?? repo,
      files: list('files'),
      deps: list('deps'),
      details: [],
      state: STATES[match[2]] ?? 'pending',
    })
  }
  return items
}

export function matchesPattern(path: string, pattern: string): boolean {
  if (path === pattern || path.startsWith(`${pattern.replace(/\/?\*?$/, '')}/`)) return true
  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  return regex.test(path)
}

export function overlaps(a: Item, b: Item): boolean {
  if (a.repo !== b.repo) return false
  if (!a.files.length || !b.files.length) return true
  return a.files.some((fa) => b.files.some((fb) => matchesPattern(fa, fb) || matchesPattern(fb, fa)))
}

export function ready(items: Item[], runningIds: Set<string>): Item[] {
  const done = new Set(items.filter((item) => item.state === 'done').map((item) => item.id))
  const running = items.filter((item) => runningIds.has(item.id))
  return items.filter(
    (item) =>
      item.state === 'pending' &&
      !runningIds.has(item.id) &&
      item.deps.every((dep) => done.has(dep)) &&
      !running.some((other) => overlaps(other, item)),
  )
}

export function blockedByDeps(items: Item[]): Map<string, string> {
  const states = new Map(items.map((item) => [item.id, item.state]))
  const blocked = new Map<string, string>()
  let grew = true
  while (grew) {
    grew = false
    for (const item of items) {
      if (item.state !== 'pending' || blocked.has(item.id)) continue
      const culprit = item.deps.find(
        (dep) => blocked.has(dep) || states.get(dep) === 'failed' || states.get(dep) === 'blocked',
      )
      if (culprit) {
        blocked.set(item.id, culprit)
        grew = true
      }
    }
  }
  return blocked
}

function locate(lines: string[], item: Item): number {
  return lines.findIndex((line) => {
    const match = parseLine(line)
    if (!match) return false
    return item.explicitId ? match[4] === item.id : !match[4] && stripMeta(match[5]) === item.text
  })
}

export function markItem(file: string, item: Item, state: ItemState, note?: string): void {
  const lines = readFileSync(file, 'utf8').split('\n')
  const index = locate(lines, item)
  if (index === -1) throw new Error(`Item ${item.id} não encontrado em ${file}`)
  const match = parseLine(lines[index]) as RegExpExecArray
  lines[index] = `${match[1]}${MARKS[state]}${match[3]}${match[4] ? `${match[4]} ` : ''}${match[5]}`
  const inserted = note
    ? note
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => `  > ${line.trim().replace(/^>\s*/, '')}`)
    : []
  lines.splice(index + 1, 0, ...inserted)
  writeFileSync(file, lines.join('\n'))
}

export function resetUnfinished(file: string): void {
  const lines = readFileSync(file, 'utf8').split('\n')
  const next: string[] = []
  let dropNotes = false
  for (const line of lines) {
    const match = parseLine(line)
    if (match) {
      dropNotes = match[2] === '!' || match[2] === '-'
      next.push(dropNotes ? `${match[1]} ${match[3]}${match[4] ? `${match[4]} ` : ''}${match[5]}` : line)
      continue
    }
    if (dropNotes && /^\s*>\s/.test(line)) continue
    if (!/^\s*>\s/.test(line)) dropNotes = false
    next.push(line)
  }
  writeFileSync(file, next.join('\n'))
}

export function widenFiles(file: string, item: Item, touched: string[]): string[] {
  if (!item.files.length) return []
  const added = touched.filter(
    (path) => !item.files.some((pattern) => matchesPattern(path, pattern)),
  )
  if (!added.length) return []
  const lines = readFileSync(file, 'utf8').split('\n')
  const index = locate(lines, item)
  if (index === -1) return []
  const match = parseLine(lines[index]) as RegExpExecArray
  const meta = META.exec(match[5])
  if (!meta || !/(^|;)\s*files\s*:/.test(meta[1])) return []
  const merged = [...item.files, ...added].join(', ')
  const nextMeta = meta[1].replace(/(^|;)(\s*files\s*:)[^;]*/, `$1$2 ${merged}`)
  const nextText = match[5].replace(META, `{${nextMeta}}`)
  lines[index] = `${match[1]}${match[2]}${match[3]}${match[4] ? `${match[4]} ` : ''}${nextText}`
  writeFileSync(file, lines.join('\n'))
  return added
}
