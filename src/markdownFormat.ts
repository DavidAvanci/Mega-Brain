import { Marked, type Tokens } from 'marked'

export type TaskState = 'open' | 'done' | 'skipped' | 'failed'

export interface TaskCounts {
  total: number
  done: number
  skipped: number
  failed: number
}

export interface OutlineEntry {
  id: string
  text: string
}

export interface Rendered {
  html: string
  outline: OutlineEntry[]
}

const TASK_STATES: Record<string, TaskState> = { ' ': 'open', x: 'done', X: 'done', '-': 'skipped', '!': 'failed' }
const TASK_LINE = /^(\s*[-*] )\[([ xX\-!])\] /
const META_LINE = /^([a-z][\w-]*): (.+)$/
const NESTED_LABEL = /^(\s{2,}[-*] )([A-ZÀ-Ú][^:`*\n]{1,30}):\s/

export function countTasks(text: string): TaskCounts {
  const counts: TaskCounts = { total: 0, done: 0, skipped: 0, failed: 0 }
  for (const line of text.split('\n')) {
    const match = TASK_LINE.exec(line)
    if (!match || match[1].length > 2) continue
    counts.total++
    const state = TASK_STATES[match[2]]
    if (state !== 'open') counts[state]++
  }
  return counts
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function safeMarkdownHtml(text: string): string {
  const allowedTags = new Set(['<dl class="meta">', '</dl>', '<div>', '</div>', '<dt>', '</dt>', '<dd>', '</dd>', '</i>'])
  const tags = /<\/?[a-z][^>]*>/gi
  let result = ''
  let cursor = 0
  for (const match of text.matchAll(tags)) {
    const index = match.index!
    result += escape(text.slice(cursor, index))
    const tag = match[0]
    const taskTag = /^<i class="task (?:open|done|skipped|failed)">$/i.test(tag)
    result += allowedTags.has(tag) || taskTag ? tag : escape(tag)
    cursor = index + tag.length
  }
  return result + escape(text.slice(cursor))
}

function safeLink(href: string): string | undefined {
  const value = href.trim()
  if (
    !value ||
    [...value].some(
      (character) => character.charCodeAt(0) <= 0x20 || character.charCodeAt(0) === 0x7f || character === '\\',
    ) ||
    value.startsWith('//')
  )
    return undefined
  if (/^(?:https?:|mailto:)/i.test(value)) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined
  return value
}

function extractMeta(lines: string[]): { meta: [string, string][]; rest: string[] } {
  const start = lines.findIndex((line) => line.trim() !== '')
  if (start < 0 || !lines[start].startsWith('# ')) return { meta: [], rest: lines }
  const meta: [string, string][] = []
  let i = start + 1
  for (; i < lines.length; i++) {
    const match = META_LINE.exec(lines[i])
    if (!match) break
    meta.push([match[1], match[2]])
  }
  if (!meta.length) return { meta: [], rest: lines }
  const items = meta
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`)
  const dl = items.length ? [`<dl class="meta">${items.join('')}</dl>`, ''] : []
  return { meta, rest: [...lines.slice(0, start + 1), '', ...dl, ...lines.slice(i)] }
}

function preprocess(text: string): string {
  return extractMeta(text.split('\n'))
    .rest.map((line) =>
      line
        .replace(TASK_LINE, (_, prefix, mark) => `${prefix}<i class="task ${TASK_STATES[mark]}"></i> `)
        .replace(NESTED_LABEL, '$1**$2:** '),
    )
    .join('\n')
}

export function render(text: string): Rendered {
  const outline: OutlineEntry[] = []
  const seen = new Map<string, number>()
  const uniqueId = (raw: string) => {
    const base = slug(raw)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count ? `${base}-${count}` : base
  }
  const marked = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const id = uniqueId(text)
        if (depth === 2) outline.push({ id, text })
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`
      },
      link({ href, tokens }: Tokens.Link) {
        const safe = safeLink(href)
        const label = this.parser.parseInline(tokens)
        return safe ? `<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
      },
      html(token) {
        return safeMarkdownHtml(token.text)
      },
      image({ text }: Tokens.Image) {
        return `<span class="markdown-image-alt">${escape(text)}</span>`
      },
    },
  })
  return { html: marked.parse(preprocess(text), { async: false }), outline }
}
