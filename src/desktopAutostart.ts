import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { isTauriDesktop } from './desktopBootstrap'

export async function getDesktopAutostartEnabled(): Promise<boolean> {
  if (!isTauriDesktop()) return false
  return isEnabled()
}

export async function setDesktopAutostartEnabled(enabled: boolean): Promise<void> {
  if (!isTauriDesktop()) throw new Error('A inicialização automática está disponível apenas no aplicativo desktop.')
  await (enabled ? enable() : disable())
}
