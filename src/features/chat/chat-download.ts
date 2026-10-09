import { invoke } from '@tauri-apps/api/core'
import { isTauriDesktop } from '@/desktopBootstrap'

export async function downloadChat(filename: string, markdown: string): Promise<void> {
  if (isTauriDesktop()) {
    await invoke('export_chat_markdown', { filename, markdown })
    return
  }
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
