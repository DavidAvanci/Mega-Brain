import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'mega-brain-theme'

export type Theme = 'light' | 'dark'
export type ThemePreference = 'system' | Theme

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const savedTheme = localStorage.getItem(STORAGE_KEY)
let preference: ThemePreference = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system'
const listeners = new Set<() => void>()

function resolvedTheme(): Theme {
  return preference === 'system' ? (colorScheme.matches ? 'dark' : 'light') : preference
}

function apply(): void {
  document.documentElement.classList.toggle('dark', resolvedTheme() === 'dark')
}
apply()
colorScheme.addEventListener('change', () => {
  if (preference !== 'system') return
  apply()
  listeners.forEach((notify) => notify())
})

export function setTheme(nextTheme: ThemePreference): void {
  if (preference === nextTheme) return
  preference = nextTheme
  if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, preference)
  apply()
  listeners.forEach((notify) => notify())
}

export function useTheme(): Theme {
  return useSyncExternalStore((notify) => {
    listeners.add(notify)
    return () => listeners.delete(notify)
  }, resolvedTheme)
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    () => preference,
  )
}
