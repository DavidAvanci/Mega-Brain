// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_PROMPTS, type PromptSettings } from '../../../shared/domain/settings'
import { PROMPT_FIELDS, PromptsSettings } from './PromptsSettings'

vi.mock('./PromptMarkdownEditor', () => ({ PromptMarkdownEditor: () => null }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

function restoreButton(key: keyof PromptSettings) {
  return host.querySelector<HTMLButtonElement>(`[data-settings-section="prompt-${key}"] button`)!
}

test.each(PROMPT_FIELDS)('recognizes the saved default for $key after backend trimming', async ({ key }) => {
  const value = Object.fromEntries(
    Object.entries(DEFAULT_PROMPTS).map(([field, prompt]) => [field, prompt.trim()]),
  ) as PromptSettings
  await act(async () =>
    root.render(<PromptsSettings value={value} onChange={vi.fn()} tab={key} onTabChange={vi.fn()} />),
  )
  expect(restoreButton(key).disabled).toBe(true)
})

test.each(PROMPT_FIELDS)('restores changed $key and stays disabled after saving and reopening', async ({ key }) => {
  let value = { ...DEFAULT_PROMPTS, [key]: `${DEFAULT_PROMPTS[key].trim()}\nInstrução personalizada.` }
  const onChange = vi.fn((next: PromptSettings) => {
    value = next
  })
  const panel = () => <PromptsSettings value={value} onChange={onChange} tab={key} onTabChange={vi.fn()} />
  await act(async () => root.render(panel()))
  expect(restoreButton(key).disabled).toBe(false)
  await act(async () => restoreButton(key).click())
  expect(onChange).toHaveBeenCalledWith(DEFAULT_PROMPTS)
  await act(async () => root.render(panel()))
  expect(restoreButton(key).disabled).toBe(true)

  value = { ...value, [key]: value[key].trim() }
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(panel()))
  expect(restoreButton(key).disabled).toBe(true)
})

test('disables restoring custom prompts while settings are being saved', async () => {
  const value = { ...DEFAULT_PROMPTS, taskPlanning: 'Planejamento personalizado' }
  await act(async () =>
    root.render(
      <PromptsSettings value={value} onChange={vi.fn()} tab="taskPlanning" onTabChange={vi.fn()} disabled />,
    ),
  )
  expect(restoreButton('taskPlanning').disabled).toBe(true)
})
