// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'
import { FALLBACK_CODEX_CATALOG } from '../../../shared/domain/codex-models'
const state = vi.hoisted(() => ({ mac: true, codex: false, updateStage: vi.fn() }))
vi.mock('@/desktopBootstrap', () => ({ isMacOSDesktop: () => state.mac, isTauriDesktop: () => true }))
vi.mock('./ActivityIslandSettings', () => ({
  ActivityIslandSettings: () => (
    <section aria-label="Ilha dinâmica">
      <label>
        <input type="checkbox" />
        Ativar ilha dinâmica
      </label>
    </section>
  ),
}))
vi.mock('./CodexProfilesSettings', () => ({
  CodexProfilesSettings: () => <section aria-label="Perfis do Codex">Perfis do Codex</section>,
}))
vi.mock('@/GeneralSettingsForm', () => ({ GeneralSettingsForm: () => <p>Preferências gerais</p> }))
vi.mock('@/theme', () => ({
  useThemeSettings: () => ({ palette: 'classic', typography: 'classic', shape: 'classic', preset: null }),
  useTheme: () => 'light',
  setColorMode: () => {},
  setPalette: () => {},
  setShape: () => {},
  setThemePreset: () => {},
  setTypography: () => {},
}))
vi.mock('./useSettingsDialog', () => ({
  useSettingsDialog: () => ({
    settings: {
      general: { llmProvider: state.codex ? 'chatgpt' : 'claude' },
      stages: {
        'task-planning': { model: state.codex ? 'gpt-6.1-sol' : 'fable', effort: 'low' },
        'run-task-checklist': { model: state.codex ? 'gpt-6.1-sol' : 'fable', effort: 'low' },
        'run-test-checklist': { model: state.codex ? 'gpt-6-luna' : 'fable', effort: 'low' },
      },
    },
    editorDiscovery: { editors: [] },
    autostartEnabled: false,
    autostartLoaded: true,
    error: null,
    saving: false,
    setAutostartEnabled: () => {},
    updateStage: state.updateStage,
    codexCatalog: { ...FALLBACK_CODEX_CATALOG, source: 'codex', profileName: 'Pessoal' },
    codexModelsLoading: false,
    refreshModels: () => {},
    updateGeneral: () => {},
    save: () => {},
    close: () => {},
  }),
}))
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  state.mac = true
  state.codex = false
  state.updateStage.mockClear()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
test('island settings occupy their own macOS tab rather than the general panel', async () => {
  await act(async () => root.render(<SettingsDialog onClose={() => {}} />))
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((tab) =>
    tab.textContent?.includes('Ilha Dinâmica'),
  )!
  expect(tab).toBeTruthy()
  expect(document.querySelector('section[aria-label="Ilha dinâmica"]')).toBeNull()
  await act(async () => tab.click())
  expect(tab.getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('section[aria-label="Ilha dinâmica"]')).toBeTruthy()
  expect(document.body.textContent).not.toContain('Salvar configurações')
})
test('the native gear can open the island tab directly', async () => {
  await act(async () => root.render(<SettingsDialog initialTab="island" onClose={() => {}} />))
  expect(document.querySelector('section[aria-label="Ilha dinâmica"]')).toBeTruthy()
})
test('Windows does not expose native island settings', async () => {
  state.mac = false
  await act(async () => root.render(<SettingsDialog onClose={() => {}} />))
  expect([...document.querySelectorAll('[role=tab]')].some((tab) => tab.textContent?.includes('Ilha Dinâmica'))).toBe(
    false,
  )
})

test('Codex profiles remain configurable when Claude is the default provider', async () => {
  await act(async () => root.render(<SettingsDialog initialTab="tools" onClose={() => {}} />))
  expect(document.querySelector('section[aria-label="Perfis do Codex"]')).toBeTruthy()
})

test('Codex exposes current model names, descriptions and only supported reasoning efforts', async () => {
  state.codex = true
  await act(async () => root.render(<SettingsDialog initialTab="tools" onClose={() => {}} />))
  const planningModels = document.querySelector('[aria-label="Modelo para Planejamento"]')!
  expect(planningModels.textContent).toContain('GPT-6.1 Sol')
  expect(planningModels.textContent).toContain('GPT-6 Sol')
  expect(planningModels.textContent).toContain('GPT-6 Luna')
  expect(planningModels.textContent).not.toContain('GPT-5.5')
  expect(document.querySelector('[role=status]')?.textContent).toContain('Pessoal')
  const planningEfforts = document.querySelector('[aria-label="Effort para Planejamento"]')!
  const testEfforts = document.querySelector('[aria-label="Effort para Testes automáticos"]')!
  const ultra = [...planningEfforts.querySelectorAll<HTMLButtonElement>('[role=radio]')].find((button) =>
    button.textContent?.includes('Ultra'),
  )!
  expect(ultra.title).toContain('delegação automática')
  expect(testEfforts.textContent).toContain('Max')
  expect(testEfforts.textContent).not.toContain('Ultra')
  await act(async () => ultra.click())
  expect(state.updateStage).toHaveBeenCalledWith('task-planning', 'effort', 'ultra')
})
