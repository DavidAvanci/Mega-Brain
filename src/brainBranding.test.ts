import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { BrainIcon } from './BrainIcon'
import { brainSvg } from './brainBranding'

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
