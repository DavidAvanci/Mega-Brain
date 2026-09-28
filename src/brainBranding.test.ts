import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { BrainIcon } from './BrainIcon'
import { brainSvg } from './brainBranding'

const setIcon = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setIcon }) }))

afterEach(() => vi.unstubAllGlobals())

test('favicon follows palette and mode changes and restores the saved palette on reload', async () => {
  const saved = new Map<string, string>()
  const root = { dataset: {} as Record<string, string>, classList: { toggle: vi.fn() } }
  const favicon = { href: '/brain.svg' }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }) })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  })
  vi.stubGlobal('document', {
    documentElement: root,
    querySelector: () => favicon,
  })
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: () => root.dataset.palette,
  }))

  const { setPalette, setColorMode } = await import('./theme')
  const faviconSvg = () => decodeURIComponent(favicon.href.split(',')[1] ?? '')
  expect(root.dataset.palette).toBe('classic-light')
  expect(faviconSvg()).toContain('stroke="classic-light"')

  setPalette('berry')
  expect(root.dataset.palette).toBe('berry')
  expect(faviconSvg()).toContain('stroke="berry"')

  setColorMode('dark')
  expect(root.dataset.palette).toBe('berry-dark')
  expect(faviconSvg()).toContain('stroke="berry-dark"')

  vi.resetModules()
  await import('./theme')
  expect(root.dataset.palette).toBe('berry-dark')
  expect(faviconSvg()).toContain('stroke="berry-dark"')

  const { setPalette: changePalette } = await import('./theme')
  changePalette('classic')
  expect(root.dataset.palette).toBe('classic-dark')
  expect(faviconSvg()).toContain('stroke="classic-dark"')
})

test('brain uses the palette primary and keeps its raster source transparent', () => {
  const headerIcon = renderToStaticMarkup(createElement(BrainIcon, { className: 'size-6' }))
  expect(headerIcon).toContain('style="color:var(--primary)"')
  expect(headerIcon).toContain('stroke="currentColor"')

  const source = brainSvg('#a44f91')
  expect(source).toContain('stroke="#a44f91"')
  expect(source).not.toContain('<rect')
  expect(source).not.toContain('fill="#fff')
})


test('saved palette updates the Windows icon when its stylesheet becomes ready after theme import', async () => {
  vi.resetModules()
  setIcon.mockReset()
  const frames: FrameRequestCallback[] = []
  const root = { dataset: {} as Record<string, string>, classList: { toggle: vi.fn() } }
  const favicon = { href: '/brain.svg' }
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: {},
    __TAURI__: { core: { invoke: vi.fn() } },
    matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
  })
  vi.stubGlobal('navigator', { userAgent: 'Windows' })
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify({ mode: 'light', palette: 'berry', typography: 'classic', shape: 'classic' }),
  })
  vi.stubGlobal('document', {
    documentElement: root,
    querySelector: () => favicon,
    createElement: () => ({
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['icon'], { type: 'image/png' })),
    }),
  })
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: () => stylesheetReady ? '#a44f91' : '',
  }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('Image', class { src = ''; decode = async () => {} })
  let stylesheetReady = false

  await import('./theme')
  expect(root.dataset.palette).toBe('berry')
  expect(setIcon).not.toHaveBeenCalled()
  expect(frames).toHaveLength(1)

  stylesheetReady = true
  frames[0](0)
  await vi.waitFor(() => expect(setIcon).toHaveBeenCalledOnce())
  expect(decodeURIComponent(favicon.href.split(',')[1] ?? '')).toContain('stroke="#a44f91"')
  expect(setIcon.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer)
})
