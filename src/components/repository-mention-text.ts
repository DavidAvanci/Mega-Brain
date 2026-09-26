export interface MentionMatch {
  start: number
  end: number
  query: string
}

export function mentionAtCursor(value: string, cursor: number): MentionMatch | null {
  const before = value.slice(0, cursor)
  const match = /(?:^|[^\p{L}\p{N}_.@-])@([a-zA-Z0-9._-]*)$/u.exec(before)
  if (!match) return null
  const start = cursor - match[1].length - 1
  let end = cursor
  while (end < value.length && /[a-zA-Z0-9._-]/.test(value[end])) end++
  return { start, end, query: match[1] }
}

export function replaceMention(value: string, match: MentionMatch, alias: string): { value: string; cursor: number } {
  const replacement = `@${alias}`
  const suffix = value.slice(match.end)
  const addSpace = suffix.length === 0 || !/^[\s,.;:!?)}\]]/.test(suffix)
  return {
    value: value.slice(0, match.start) + replacement + (addSpace ? ' ' : '') + suffix,
    cursor: match.start + replacement.length + (addSpace ? 1 : 0),
  }
}
