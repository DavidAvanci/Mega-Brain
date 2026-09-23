import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'mega-brain-theme'

export type Theme = 'light' | 'dark'
export type ColorModePreference = 'system' | 'light' | 'dark'
export type PalettePreference = 'classic' | 'takeat' | 'ocean' | 'terracotta' | 'berry'
export type TypographyPreference = 'classic' | 'takeat' | 'editorial' | 'technical'
export type ShapePreference = 'classic' | 'takeat' | 'squircle' | 'soft' | 'angular'
export type PresetPreference = 'classic' | 'takeat' | null

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

function loadSettings(): ThemeSettings {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'takeat') return TAKEAT_SETTINGS
  if (!saved || saved === 'classic') return CLASSIC_SETTINGS
  if (saved === 'light' || saved === 'dark') return { ...CLASSIC_SETTINGS, mode: saved }

  try {
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null) return CLASSIC_SETTINGS
    const candidate = parsed as Partial<ThemeSettings>
    if (
      ['classic', 'takeat', 'ocean', 'terracotta', 'berry'].includes(candidate.palette ?? '') &&
      ['classic', 'takeat', 'editorial', 'technical'].includes(candidate.typography ?? '') &&
      ['classic', 'takeat', 'squircle', 'soft', 'angular'].includes(candidate.shape ?? '')
    ) {
      return {
        mode: candidate.mode === 'light' || candidate.mode === 'dark' ? candidate.mode : 'system',
        palette: candidate.palette as PalettePreference,
        typography: candidate.typography as TypographyPreference,
        shape: candidate.shape as ShapePreference,
        preset: candidate.preset === 'takeat' || candidate.preset === 'classic' ? candidate.preset : null,
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
}

function persist(next: ThemeSettings): void {
  settings = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  apply()
  listeners.forEach((notify) => notify())
}

apply()
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
  const next = { ...(preset === 'takeat' ? TAKEAT_SETTINGS : CLASSIC_SETTINGS), mode: settings.mode }
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
