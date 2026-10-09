// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { PromptMarkdownEditor } from './PromptMarkdownEditor'
import { formatPrompt } from './prompt-markdown'
import { render } from '@/markdownFormat'

test('formatting preserves surrounding instructions and excludes whitespace from emphasis', () => {
  const original = { value: 'Antes: ação Depois', start: 6, end: 12 }
  const formatted = formatPrompt(original, 'bold')
  expect(formatted.value).toBe('Antes: **ação** Depois')
  expect(formatted.value.slice(formatted.start, formatted.end)).toBe('ação')
  expect(formatPrompt(formatted, 'bold').value).toBe(original.value)
})

test('lists respect line boundaries and code blocks preserve embedded fences', () => {
  const list = formatPrompt({ value: 'Antes\nUm\nDois\nDepois', start: 7, end: 14 }, 'checklist')
  expect(list.value).toBe('Antes\n- [ ] Um\n- [ ] Dois\nDepois')
  expect(formatPrompt(list, 'checklist').value).toBe('Antes\nUm\nDois\nDepois')
  const code = '```js\nconst answer = 42\n```'
  const block = formatPrompt({ value: code, start: 0, end: code.length }, 'codeBlock')
  expect(render(block.value).html).toContain('```js\nconst answer = 42\n```')
})

test('the prompt editor preserves selection through formatting, undo, redo and preview', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const changes = vi.fn()
  function Example() {
    const [value, setValue] = useState('Antes\nAção\nDepois')
    return (
      <PromptMarkdownEditor
        title="Planejamento"
        value={value}
        onChange={(next) => {
          changes(next)
          setValue(next)
        }}
      />
    )
  }
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  try {
    await act(async () => root.render(<Example />))
    const textarea = host.querySelector('textarea')!
    textarea.setSelectionRange(6, 10)
    await act(async () => button('Negrito (⌘/Ctrl B)').click())
    expect(textarea.value).toBe('Antes\n**Ação**\nDepois')
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('Ação')
    await act(async () => button('Desfazer').click())
    expect(textarea.value).toBe('Antes\nAção\nDepois')
    await act(async () => button('Refazer').click())
    expect(textarea.value).toBe('Antes\n**Ação**\nDepois')
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    )
    expect(textarea.value).toBe('Antes\n**_Ação_**\nDepois')
    const edits = changes.mock.calls.length
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'Prévia')!.click(),
    )
    expect(host.querySelector('[aria-label="Prévia do prompt: Planejamento"] strong em')?.textContent).toBe('Ação')
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'Editar')!.click(),
    )
    expect(changes).toHaveBeenCalledTimes(edits)
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('Ação')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
