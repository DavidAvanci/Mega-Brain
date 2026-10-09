export type MarkdownAction =
  'bold' | 'italic' | 'heading' | 'bullet' | 'numbered' | 'checklist' | 'quote' | 'link' | 'code' | 'codeBlock'

export type PromptSelection = { value: string; start: number; end: number }

function replace(selection: PromptSelection, text: string, start: number, end: number): PromptSelection {
  return {
    value: selection.value.slice(0, selection.start) + text + selection.value.slice(selection.end),
    start: selection.start + start,
    end: selection.start + end,
  }
}

function wrap(selection: PromptSelection, before: string, after = before, placeholder = 'texto'): PromptSelection {
  const { value, start, end } = selection
  const selected = value.slice(start, end)
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const text = selected.slice(before.length, -after.length)
    return replace(selection, text, 0, text.length)
  }
  if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    return replace({ value, start: start - before.length, end: end + after.length }, selected, 0, selected.length)
  }
  const text = selected || placeholder
  return replace(selection, before + text + after, before.length, before.length + text.length)
}

function wholeLines(selection: PromptSelection): PromptSelection {
  const { value, start, end } = selection
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const newline = value.indexOf('\n', Math.max(start, end - 1))
  return { value, start: start === 0 ? 0 : lineStart, end: newline < 0 ? value.length : newline }
}

const BLOCKS = {
  heading: { pattern: /^#{2}\s/, prefix: () => '## ' },
  bullet: { pattern: /^- (?!\[[ xX]\] )/, prefix: () => '- ' },
  numbered: { pattern: /^\d+\. /, prefix: (index: number) => `${index + 1}. ` },
  checklist: { pattern: /^- \[[ xX]\] /, prefix: () => '- [ ] ' },
  quote: { pattern: /^> /, prefix: () => '> ' },
}
const EXISTING_BLOCK = /^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/

export function formatPrompt(selection: PromptSelection, action: MarkdownAction): PromptSelection {
  if (action === 'bold' || action === 'italic') {
    const selected = selection.value.slice(selection.start, selection.end)
    const leading = selected.length - selected.trimStart().length
    const trailing = selected.trim().length ? selected.length - selected.trimEnd().length : 0
    return wrap(
      { ...selection, start: selection.start + leading, end: selection.end - trailing },
      action === 'bold' ? '**' : '_',
    )
  }
  if (action === 'code') {
    const selected = selection.value.slice(selection.start, selection.end)
    const runs = selected.match(/`+/g) ?? []
    const marker = '`'.repeat(Math.max(1, ...runs.map((run) => run.length + 1)))
    const padding = selected.startsWith('`') || selected.endsWith('`') ? ' ' : ''
    return wrap(selection, marker + padding, padding + marker, 'código')
  }
  if (action === 'link') {
    const label = selection.value.slice(selection.start, selection.end) || 'texto do link'
    const text = `[${label}](https://)`
    return replace(selection, text, label.length + 3, text.length - 1)
  }
  const lines = wholeLines(selection)
  if (action === 'codeBlock') {
    const selected = lines.value.slice(lines.start, lines.end)
    const runs = selected.match(/`+/g) ?? []
    const marker = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)))
    return wrap(lines, `${marker}\n`, `\n${marker}`, 'código')
  }
  const block = BLOCKS[action]
  const content = lines.value.slice(lines.start, lines.end).split('\n')
  const remove = content.every((line) => block.pattern.test(line.trimStart()))
  const text = content
    .map((line, index) => {
      const indent = line.match(/^[\t ]*/)?.[0] ?? ''
      const body = line.slice(indent.length)
      return (
        indent + (remove ? body.replace(block.pattern, '') : block.prefix(index) + body.replace(EXISTING_BLOCK, ''))
      )
    })
    .join('\n')
  return replace(lines, text, 0, text.length)
}
