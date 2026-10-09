// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { downloadChat } from './chat-download'

const native = vi.hoisted(() => ({ desktop: false, invoke: vi.fn() }))
vi.mock('@/desktopBootstrap', () => ({ isTauriDesktop: () => native.desktop }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  native.invoke.mockReset()
})

test('desktop usa a janela nativa sem receber um caminho do cliente', async () => {
  native.desktop = true
  native.invoke.mockResolvedValue(false)
  await downloadChat('mb-1-ambiente.md', '# Conversa')
  expect(native.invoke).toHaveBeenCalledWith('export_chat_markdown', {
    filename: 'mb-1-ambiente.md',
    markdown: '# Conversa',
  })
})

test('web baixa o Markdown e libera o URL temporário após iniciar o download', async () => {
  native.desktop = false
  vi.useFakeTimers()
  const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:chat-export')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    },
  )
  let link: { filename: string; url: string } | undefined
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    link = { filename: this.download, url: this.href }
  })
  await downloadChat('mb-1-ambiente.md', '# Conversa')
  expect(link?.filename).toBe('mb-1-ambiente.md')
  expect(link?.url).toBe('blob:chat-export')
  expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
  expect(native.invoke).not.toHaveBeenCalled()
  expect(revokeObjectURL).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1000)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:chat-export')
})
