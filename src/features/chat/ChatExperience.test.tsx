// @vitest-environment jsdom
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ChatTranscript } from './ChatTranscript'
import { ChatComposer } from './ChatComposer'
import { ChatExport } from './ChatExport'
import type { ChatEntry, ChatModelSelection } from '../../../shared/contracts/chat'

const download = vi.hoisted(() => vi.fn())
vi.mock('./chat-download', () => ({ downloadChat: download }))
vi.mock('@/features/settings/useCodexModels', () => ({
  useCodexModels: () => ({
    loading: false,
    catalog: { source: 'codex', models: [{ id: 'gpt-fixture', label: 'Modelo da conta' }] },
  }),
}))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  download.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const entries: ChatEntry[] = [
  { role: 'user', text: 'Verifique a API' },
  { role: 'assistant', tool: 'cat README.md' },
  { role: 'assistant', output: '# README\n```sh\nnpm run dev\n```\n<script>alert(1)</script>' },
  { role: 'assistant', text: 'A API está **pronta**.' },
]

test('atividade começa recolhida, mantém saídas como texto e destaca respostas Markdown', async () => {
  await act(async () => root.render(<ChatTranscript entries={entries} />))
  const activity = host.querySelector('details')!
  expect(activity.open).toBe(false)
  expect(activity.querySelector('summary')?.textContent).toContain('cat README.md')
  expect(host.querySelector('script')).toBeNull()
  expect(host.querySelectorAll('pre')[1].textContent).toContain('<script>alert(1)</script>')
  expect(host.querySelector('strong')?.textContent).toBe('pronta')
  expect(host.querySelectorAll('details')).toHaveLength(1)
})

test('novos eventos não recolhem uma atividade que o usuário já expandiu', async () => {
  await act(async () => root.render(<ChatTranscript entries={entries.slice(0, 3)} busy />))
  host.querySelector('details')!.open = true
  await act(async () =>
    root.render(
      <ChatTranscript
        entries={[
          ...entries.slice(0, 3),
          { role: 'assistant', tool: 'curl localhost:4100' },
          { role: 'assistant', output: 'OK' },
        ]}
        busy
      />,
    ),
  )
  expect(host.querySelector('details')?.open).toBe(true)
  expect(host.querySelector('summary')?.textContent).toContain('2 comandos')
  expect(host.querySelector('summary')?.textContent).toContain('Em andamento')
  expect(host.querySelectorAll('pre')).toHaveLength(4)
})

test('exportação inclui comandos e saídas recolhidos sem quebrar blocos que contêm crases', async () => {
  await act(async () => root.render(<ChatExport cardId="MB-1" conversation="Ambiente" entries={entries} />))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Exportar chat"]')!.click())
  expect(download).toHaveBeenCalledOnce()
  const [filename, markdown] = download.mock.calls[0]
  expect(filename).toBe('mb-1-ambiente.md')
  expect(markdown).toContain('Verifique a API')
  expect(markdown).toContain('```sh\ncat README.md\n```')
  expect(markdown).toContain('````text\n# README\n```sh\nnpm run dev\n```\n<script>alert(1)</script>\n````')
  expect(markdown).toContain('A API está **pronta**.')
})

function Composer({
  send,
  stop = () => {},
  busy = false,
}: {
  send: (text: string, selection: ChatModelSelection) => void
  stop?: () => void
  busy?: boolean
}) {
  const [input, setInput] = useState('')
  const [selection, setSelection] = useState<ChatModelSelection>({ provider: 'claude', model: 'default' })
  const textarea = useRef<HTMLTextAreaElement>(null)
  return (
    <ChatComposer
      input={input}
      onInput={setInput}
      selection={selection}
      onSelection={setSelection}
      onSend={() => send(input, selection)}
      onStop={stop}
      busy={busy}
      textareaRef={textarea}
      label="Pedido"
      placeholder="Peça ao agente…"
      sendLabel="Enviar"
      stopLabel="Parar"
    />
  )
}

async function type(text: string) {
  await act(async () => {
    const textarea = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function key(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })
  await act(async () => host.querySelector('textarea')!.dispatchEvent(event))
  return event
}
async function select(label: string, text: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
  const trigger = host.querySelector(`[aria-label="${label}"]`)!
  const popup = document.getElementById(trigger.getAttribute('aria-controls')!)!
  const option = [...popup.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.startsWith(text),
  )!
  await act(async () => option.click())
}

test('Enter envia com provedor e modelo escolhidos no catálogo da conta', async () => {
  const send = vi.fn()
  await act(async () => root.render(<Composer send={send} />))
  await select('Provedor do chat', 'Codex')
  await select('Modelo do chat', 'Modelo da conta')
  await type('Investigue o Redis')
  expect((await key()).defaultPrevented).toBe(true)
  expect(send).toHaveBeenCalledWith('Investigue o Redis', { provider: 'chatgpt', model: 'gpt-fixture' })
})

test('Shift+Enter e composição de texto não enviam; Enter repetido e mensagem vazia também não', async () => {
  const send = vi.fn()
  await act(async () => root.render(<Composer send={send} />))
  await type('Uma orientação')
  expect((await key({ shiftKey: true })).defaultPrevented).toBe(false)
  expect((await key({ isComposing: true })).defaultPrevented).toBe(false)
  await key({ repeat: true })
  await type('  ')
  await key()
  expect(send).not.toHaveBeenCalled()
})

test('durante a execução permite preparar rascunho, bloqueia modelo e oferece interrupção', async () => {
  const send = vi.fn()
  const stop = vi.fn()
  await act(async () => root.render(<Composer send={send} stop={stop} busy />))
  expect(host.querySelector('textarea')?.disabled).toBe(false)
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Provedor do chat"]')?.disabled).toBe(true)
  await type('Próximo pedido')
  await key()
  expect(send).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Parar"]')!.click())
  expect(stop).toHaveBeenCalledOnce()
  await act(async () => root.render(<Composer send={send} stop={stop} />))
  expect(host.querySelector('textarea')?.value).toBe('Próximo pedido')
  await key()
  expect(send).toHaveBeenCalledOnce()
})
