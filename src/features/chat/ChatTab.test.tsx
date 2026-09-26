// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ChatTab } from './ChatTab'

const mocks = vi.hoisted(() => ({
  fetchChat: vi.fn(),
  sendChat: vi.fn(),
  abortChat: vi.fn(),
}))
vi.mock('@/features/cards/api/card-detail-api', () => mocks)
vi.mock('@/features/repositories/useRepositoryMentions', () => ({
  useRepositoryMentions: () => ({
    repositories: [{ id: 'repo', alias: 'api', displayName: 'API' }],
    loading: false,
    error: null,
  }),
}))
vi.mock('@/Markdown', () => ({ Markdown: ({ text }: { text: string }) => <p>{text}</p> }))

let root: Root
let host: HTMLDivElement
let finishSend: (() => void) | undefined
let rejectSend: ((error: Error) => void) | undefined

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mocks.fetchChat.mockResolvedValue({ entries: [], sessionId: 'session', settings: null })
  mocks.sendChat.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        finishSend = resolve
        rejectSend = reject
      }),
  )
  await act(async () => {
    root.render(<ChatTab cardId="card-1" />)
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.clearAllMocks()
  finishSend = undefined
  rejectSend = undefined
})

function input() {
  return host.querySelector<HTMLTextAreaElement>('textarea')!
}

async function type(value: string) {
  await act(async () => {
    const element = input()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function sendWithEnter() {
  await act(async () => {
    input().focus()
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
}

async function finish() {
  await act(async () => {
    finishSend?.()
  })
}

test('restores actual DOM focus after sending with Enter', async () => {
  await type('olá')
  await sendWithEnter()
  expect(mocks.sendChat).toHaveBeenCalledOnce()
  await finish()
  expect(document.activeElement).toBe(input())
})

test('restores focus after button send and a failed response', async () => {
  await type('olá')
  await act(async () => {
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Enviar mensagem"]')!
    button.focus()
    button.click()
  })
  await act(async () => {
    rejectSend?.(new Error('falhou'))
  })
  expect(document.activeElement).toBe(input())
})

test('restores focus when sending fails immediately', async () => {
  mocks.sendChat.mockRejectedValueOnce(new Error('indisponível'))
  await type('olá')
  await sendWithEnter()
  expect(document.activeElement).toBe(input())
})

test('does not focus after closing the chat', async () => {
  await type('olá')
  await sendWithEnter()
  await act(async () => {
    root.unmount()
  })
  const other = document.createElement('button')
  document.body.append(other)
  other.focus()
  await finish()
  expect(document.activeElement).toBe(other)
  other.remove()
  root = createRoot(host)
})

test('does not take focus from another control during streaming', async () => {
  await type('olá')
  await sendWithEnter()
  const other = document.createElement('button')
  document.body.append(other)
  await act(async () => {
    other.focus()
  })
  await finish()
  expect(document.activeElement).toBe(other)
  other.remove()
})

test('does not restore focus after switching cards', async () => {
  await type('olá')
  await sendWithEnter()
  await act(async () => {
    root.render(<ChatTab cardId="card-2" />)
  })
  const other = document.createElement('button')
  document.body.append(other)
  await act(async () => {
    other.focus()
  })
  await finish()
  expect(document.activeElement).toBe(other)
  other.remove()
})

test('restores focus after stopping a response', async () => {
  await type('olá')
  await sendWithEnter()
  await act(async () => {
    const stop = host.querySelector<HTMLButtonElement>('[aria-label="Parar resposta"]')!
    stop.focus()
    stop.click()
  })
  expect(mocks.abortChat).toHaveBeenCalledWith('card-1')
  await finish()
  expect(document.activeElement).toBe(input())
})

test('Enter selecting a mention does not send', async () => {
  await type('@a')
  await sendWithEnter()
  expect(mocks.sendChat).not.toHaveBeenCalled()
  expect(input().value).toBe('@api ')
})
