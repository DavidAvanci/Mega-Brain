import { useSyncExternalStore } from 'react'
import { updateBrainBranding } from './brainBranding'

const STORAGE_KEY = 'mega-brain-theme'

export type Theme = 'light' | 'dark'
export type ColorModePreference = 'system' | 'light' | 'dark'
export type PalettePreference = 'classic' | 'takeat' | 'ocean' | 'terracotta' | 'berry' | 'minecraft'
export type TypographyPreference = 'classic' | 'takeat' | 'editorial' | 'technical' | 'minecraft'
export type ShapePreference = 'classic' | 'takeat' | 'squircle' | 'soft' | 'angular' | 'minecraft'
export type PresetPreference = 'classic' | 'takeat' | 'minecraft' | null

export interface ThemeSettings {
  mode: ColorModePreference
  palette: PalettePreference
  typography: TypographyPreference
  shape: ShapePreference
  preset: PresetPreference
}

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()
const CLASSIC_SETTINGS: ThemeSettings = {
  mode: 'system',
  palette: 'classic',
  typography: 'classic',
  shape: 'classic',
  preset: 'classic',
}
const TAKEAT_SETTINGS: ThemeSettings = {
  mode: 'system',
  palette: 'takeat',
  typography: 'takeat',
  shape: 'takeat',
  preset: 'takeat',
}
const MINECRAFT_SETTINGS: ThemeSettings = {
  mode: 'system',
  palette: 'minecraft',
  typography: 'minecraft',
  shape: 'minecraft',
  preset: 'minecraft',
}

function loadSettings(): ThemeSettings {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'takeat') return TAKEAT_SETTINGS
  if (saved === 'minecraft') return MINECRAFT_SETTINGS
  if (!saved || saved === 'classic') return CLASSIC_SETTINGS
  if (saved === 'light' || saved === 'dark') return { ...CLASSIC_SETTINGS, mode: saved }

  try {
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null) return CLASSIC_SETTINGS
    const candidate = parsed as Partial<ThemeSettings>
    if (
      ['classic', 'takeat', 'ocean', 'terracotta', 'berry', 'minecraft'].includes(candidate.palette ?? '') &&
      ['classic', 'takeat', 'editorial', 'technical', 'minecraft'].includes(candidate.typography ?? '') &&
      ['classic', 'takeat', 'squircle', 'soft', 'angular', 'minecraft'].includes(candidate.shape ?? '')
    ) {
      return {
        mode: candidate.mode === 'light' || candidate.mode === 'dark' ? candidate.mode : 'system',
        palette: candidate.palette as PalettePreference,
        typography: candidate.typography as TypographyPreference,
        shape: candidate.shape as ShapePreference,
        preset: candidate.preset === 'takeat' || candidate.preset === 'classic' || candidate.preset === 'minecraft' ? candidate.preset : null,
      }
    }
  } catch {
    // Older single-theme values other than the retained presets reset to Classic.
  }
  return CLASSIC_SETTINGS
}

let settings = loadSettings()

function resolvedTheme(): Theme {
  if (settings.mode !== 'system') return settings.mode
  return colorScheme.matches ? 'dark' : 'light'
}

function apply(): void {
  const colorMode = resolvedTheme()
  document.documentElement.dataset.palette =
    settings.palette === 'classic' || colorMode === 'dark' ? `${settings.palette}-${colorMode}` : settings.palette
  document.documentElement.dataset.typography = settings.typography
  document.documentElement.dataset.shape = settings.shape
  if (settings.preset) document.documentElement.dataset.preset = settings.preset
  else delete document.documentElement.dataset.preset
  document.documentElement.classList.toggle('dark', colorMode === 'dark')
  updateBrainBranding()
}

function persist(next: ThemeSettings): void {
  settings = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  apply()
  listeners.forEach((notify) => notify())
}

apply()
// The theme can be imported through App before the stylesheet is ready. Retry
// on the first painted frame so the saved palette also colors the window icon.
if (typeof requestAnimationFrame === 'function') requestAnimationFrame(updateBrainBranding)
colorScheme.addEventListener('change', () => {
  if (settings.mode !== 'system') return
  apply()
  listeners.forEach((notify) => notify())
})

export function setPalette(palette: PalettePreference): void {
  if (settings.palette === palette && !settings.preset) return
  persist({ ...settings, palette, preset: null })
}

export function setColorMode(mode: ColorModePreference): void {
  if (settings.mode === mode) return
  persist({ ...settings, mode })
}

export function setTypography(typography: TypographyPreference): void {
  if (settings.typography === typography && !settings.preset) return
  persist({ ...settings, typography, preset: null })
}

export function setShape(shape: ShapePreference): void {
  if (settings.shape === shape && !settings.preset) return
  persist({ ...settings, shape, preset: null })
}

export function setThemePreset(preset: Exclude<PresetPreference, null>): void {
  const presetSettings = preset === 'takeat' ? TAKEAT_SETTINGS : preset === 'minecraft' ? MINECRAFT_SETTINGS : CLASSIC_SETTINGS
  const next = { ...presetSettings, mode: settings.mode }
  if (settings.preset === preset) return
  persist(next)
}

export function useTheme(): Theme {
  return useSyncExternalStore((notify) => {
    listeners.add(notify)
    return () => listeners.delete(notify)
  }, resolvedTheme)
}

export function useThemeSettings(): ThemeSettings {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    () => settings,
  )
}
