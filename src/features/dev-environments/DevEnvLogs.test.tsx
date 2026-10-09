// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DevEnvLogs } from './DevEnvLogs'
import type { DevEnvLogs as Logs } from '../../../shared/domain/dev-environments'

const api = vi.hoisted(() => ({ logs: vi.fn() }))
vi.mock('./dev-env-api', () => ({ fetchDevEnvLogs: api.logs }))
let host: HTMLDivElement
let root: Root
const files = ['api.log', 'frontend.log']
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.logs.mockReset().mockImplementation(async (_card: string, file = 'api.log') => ({
    files,
    file,
    content: file === 'api.log' ? 'API ready' : 'Frontend ready',
    truncated: false,
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('tabs laterais abrem o arquivo com falha e copiam o conteúdo selecionado', async () => {
  const copy = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true })
  await act(async () => root.render(<DevEnvLogs cardId="MB-1" failedRepo="frontend" />))
  const list = host.querySelector('[role="tablist"]')
  expect(list?.getAttribute('aria-orientation')).toBe('vertical')
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('frontend')
  expect(host.querySelector('pre')?.textContent).toBe('Frontend ready')
  await act(async () => {
    const frontend = host.querySelector<HTMLButtonElement>('button[aria-label="Log de frontend"]')!
    frontend.focus()
    frontend.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  })
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Log de api')
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Log de api"]')!.click())
  expect(host.querySelector('pre')?.textContent).toBe('API ready')
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Copiar logs"]')!.click())
  expect(copy).toHaveBeenCalledWith('API ready')
})

test('trocar arquivo não exibe o log anterior sob o nome do próximo arquivo', async () => {
  await act(async () => root.render(<DevEnvLogs cardId="MB-1" />))
  let complete: (logs: Logs) => void = () => {}
  api.logs.mockImplementation((_card: string, file = 'api.log') =>
    file === 'api.log'
      ? Promise.resolve({ files, file, content: 'API ready', truncated: false })
      : new Promise<Logs>((resolve) => {
          complete = resolve
        }),
  )
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Log de frontend"]')!.click())
  expect(host.querySelector('pre')?.textContent).toBe('Carregando logs…')
  await act(async () => complete({ files, file: 'frontend.log', content: 'Frontend ready', truncated: true }))
  expect(host.querySelector('pre')?.textContent).toBe('Frontend ready')
  expect(host.textContent).toContain('últimos 64 KB')
})
