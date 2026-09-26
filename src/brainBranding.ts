import { BRAIN_PATHS } from './BrainIcon'
import { isTauriDesktop } from './desktopBootstrap'

export function brainSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${BRAIN_PATHS.map((path) => `<path d="${path}"/>`).join('')}</svg>`
}

let lastWindowIcon = ''
let windowIconRequest = 0

export function updateBrainBranding(): void {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const color = style.getPropertyValue('--primary').trim()
  if (!color) return

  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (favicon) favicon.href = `data:image/svg+xml,${encodeURIComponent(brainSvg(color))}`

  if (!isTauriDesktop() || !navigator.userAgent.includes('Windows')) return
  if (color === lastWindowIcon) return
  lastWindowIcon = color
  const request = ++windowIconRequest
  void updateWindowIcon(brainSvg(color), request).catch((error: unknown) => {
    console.warn('Could not update the desktop window icon:', error)
    if (request === windowIconRequest) lastWindowIcon = ''
  })
}

async function updateWindowIcon(svg: string, request: number): Promise<void> {
  const image = new Image()
  image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  context.clearRect(0, 0, 128, 128)
  context.drawImage(image, 0, 0, 128, 128)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG encoding failed'))), 'image/png')
  })
  if (request !== windowIconRequest) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  if (request !== windowIconRequest) return
  await getCurrentWindow().setIcon(await blob.arrayBuffer())
}
