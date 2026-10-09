// @vitest-environment jsdom
import { act, useEffect, useImperativeHandle, type Ref } from 'react'
import type { ActivityIslandSettingsHandle } from './ActivityIslandSettings'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'
import { FALLBACK_CODEX_CATALOG } from '../../../shared/domain/codex-models'
import { searchSettings } from './settings-search'
const state = vi.hoisted(() => ({
  mac: true,
  codex: false,
  updateStage: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  saveIsland: vi.fn(),
}))
vi.mock('@/desktopBootstrap', () => ({ isMacOSDesktop: () => state.mac, isTauriDesktop: () => true }))
vi.mock('./ActivityIslandSettings', () => ({
  ActivityIslandSettings: ({
    ref,
    onLoadedChange,
  }: {
    ref?: Ref<ActivityIslandSettingsHandle>
    onLoadedChange?: (loaded: boolean) => void
  }) => {
    useImperativeHandle(ref, () => ({ save: state.saveIsland }))
    useEffect(() => onLoadedChange?.(true), [onLoadedChange])
    return (
      <section aria-label="Ilha dinâmica">
        <label>
          <input type="checkbox" />
          Ativar ilha dinâmica
        </label>
      </section>
    )
  },
}))
vi.mock('./CodexProfilesSettings', () => ({
  CodexProfilesSettings: () => <section aria-label="Perfis do Codex">Perfis do Codex</section>,
}))
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
      general: {
        llmProvider: state.codex ? 'chatgpt' : 'claude',
        editor: 'custom',
        editorCommand: '/bin/sh',
        terminalCommand: '',
        shellCommand: '',
        workspaceDir: '/tmp/cards',
        worktreesDir: '/tmp/trees',
        jiraSite: '',
        jiraEmail: '',
        jiraApiToken: '',
        jiraConfigured: false,
        jevEnabled: false,
        jevBaseUrl: '',
        jevCredentialSource: 'none',
      },
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
    save: state.save,
    close: state.close,
  }),
}))
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  state.mac = true
  state.codex = false
  state.updateStage.mockClear()
  state.save.mockReset().mockResolvedValue(undefined)
  state.close.mockReset()
  state.saveIsland.mockReset().mockResolvedValue(true)
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
  expect(document.body.textContent).toContain('Salvar configurações')
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

function options(label: string) {
  const trigger = document.querySelector(`[aria-label="${label}"]`)!
  const list = document.getElementById(trigger.getAttribute('aria-controls')!)!
  expect(list, label).toBeTruthy()
  return [...list.querySelectorAll<HTMLElement>('[role=option]')]
}
test('Codex selects current models and limits reasoning to the supported options', async () => {
  state.codex = true
  await act(async () => root.render(<SettingsDialog initialTab="models" onClose={() => {}} />))
  expect(document.querySelector('[role=status]')?.textContent).toContain('Pessoal')
  const planningModels = document.querySelector<HTMLButtonElement>('[aria-label="Modelo para Planejamento"]')!
  expect(planningModels.textContent).toContain('GPT-6.1 Sol')
  await act(async () => planningModels.click())
  const models = options('Modelo para Planejamento')
    .map((option) => option.textContent)
    .join(' ')
  expect(models).toContain('GPT-6 Sol')
  expect(models).toContain('GPT-6 Luna')
  expect(models).not.toContain('GPT-5.5')
  await act(async () =>
    options('Modelo para Planejamento')
      .find((option) => option.textContent?.startsWith('GPT-6.1 Sol'))!
      .click(),
  )
  const planningEfforts = document.querySelector('[aria-label="Effort para Planejamento"]')!
  const ultra = [...planningEfforts.querySelectorAll<HTMLButtonElement>('[role=radio]')].find((button) =>
    button.textContent?.includes('Ultra'),
  )!
  expect(ultra.title).toContain('delegação automática')
  await act(async () => ultra.click())
  expect(state.updateStage).toHaveBeenCalledWith('task-planning', 'effort', 'ultra')
  const testEfforts = document.querySelector('[aria-label="Effort para Testes automáticos"]')!
  const efforts = testEfforts.textContent
  expect(efforts).toContain('Max')
  expect(efforts).not.toContain('Ultra')
})

test('categories expose Jira, models, IDEs and terminal as separate panels', async () => {
  await act(async () => root.render(<SettingsDialog onClose={() => {}} />))
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')]
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Geral',
    'Jira',
    'Modelos de execução',
    'IDEs',
    'Shell e terminal',
    'Integrações',
    'Prompts',
    'Ilha Dinâmica',
  ])
  expect(document.querySelector('section[aria-label="Diretórios"]')).toBeTruthy()
  for (const [tabName, section] of [
    ['Jira', 'Jira'],
    ['IDEs', 'IDEs'],
    ['Shell e terminal', 'Shell e terminal'],
  ]) {
    await act(async () => tabs.find((tab) => tab.textContent === tabName)!.click())
    expect(document.querySelector(`section[aria-label="${section}"]`)).toBeTruthy()
    expect(document.querySelector('section[aria-label="Diretórios"]')).toBeNull()
  }
})

test('saving the island awaits persistence before saving the dialog and blocks dismissal meanwhile', async () => {
  let finish!: (success: boolean) => void
  state.saveIsland.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  )
  await act(async () => root.render(<SettingsDialog initialTab="island" onClose={() => {}} />))
  const save = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Salvar configurações',
  )!
  expect(save.disabled).toBe(false)
  await act(async () => save.click())
  expect(state.saveIsland).toHaveBeenCalledTimes(1)
  expect(state.save).not.toHaveBeenCalled()
  expect(save.disabled).toBe(true)
  expect(
    [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].every(
      (tab) => tab.getAttribute('aria-disabled') === 'true',
    ),
  ).toBe(true)
  await act(async () => finish(true))
  expect(state.save).toHaveBeenCalledTimes(1)
})

test('a failed island save keeps the dialog open and allows retry', async () => {
  state.saveIsland.mockResolvedValue(false)
  await act(async () => root.render(<SettingsDialog initialTab="island" onClose={() => {}} />))
  const save = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Salvar configurações',
  )!
  await act(async () => save.click())
  expect(state.save).not.toHaveBeenCalled()
  expect(state.close).not.toHaveBeenCalled()
  expect(save.disabled).toBe(false)
  state.saveIsland.mockResolvedValue(true)
  await act(async () => save.click())
  expect(state.save).toHaveBeenCalledTimes(1)
})

test('Claude exposes the original effort scale beside a model Select with preset options', async () => {
  await act(async () => root.render(<SettingsDialog initialTab="models" onClose={() => {}} />))
  const scale = document.querySelector('[aria-label="Effort para Planejamento"]')!
  expect(scale.getAttribute('role')).toBe('radiogroup')
  const presets = [...scale.querySelectorAll<HTMLButtonElement>('[role=radio]')]
  expect(presets.map((preset) => preset.textContent)).toEqual(['Low', 'Medium', 'High', 'X-high', 'Max'])
  expect(presets[0].getAttribute('aria-checked')).toBe('true')
  await act(async () => presets[2].click())
  expect(state.updateStage).toHaveBeenCalledWith('task-planning', 'effort', 'high')
  const models = document.querySelector<HTMLButtonElement>('[aria-label="Modelo para Planejamento"]')!
  expect(models.getAttribute('role')).toBe('combobox')
  await act(async () => models.click())
  expect(options('Modelo para Planejamento').map((option) => option.textContent)).toEqual([
    'Fable',
    'Opus',
    'Sonnet',
    'Haiku',
  ])
})

test('the effort scale supports keyboard selection between the predefined levels', async () => {
  await act(async () => root.render(<SettingsDialog initialTab="models" onClose={() => {}} />))
  const low = document.querySelector<HTMLButtonElement>('[aria-label="Effort para Planejamento"] [role=radio]')!
  await act(async () => {
    low.focus()
    low.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  expect(state.updateStage).toHaveBeenCalledWith('task-planning', 'effort', 'medium')
})

async function search(query: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Buscar configurações"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

test('settings search matches accents, words and platform availability and opens the matching section', async () => {
  expect(searchSettings('  TOKEN jira ', { desktop: false, macOS: false }).map((entry) => entry.target)).toEqual([
    'jira',
  ])
  expect(searchSettings('ILHA DINAMICA', { desktop: false, macOS: false })).toEqual([])
  await act(async () => root.render(<SettingsDialog onClose={() => {}} />))
  const input = await search('tipografia')
  const result = document.querySelector<HTMLButtonElement>('[role=region] button')!
  expect(result.textContent).toContain('Tipografia')
  await act(async () => result.click())
  expect(input.value).toBe('')
  expect(document.activeElement?.getAttribute('data-settings-section')).toBe('typography')
  expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Geral')
})

test('search preserves the current panel, clears with Escape and selects the matching prompt tab with Enter', async () => {
  await act(async () => root.render(<SettingsDialog initialTab="terminal" onClose={() => {}} />))
  const panel = document.querySelector('section[aria-label="Shell e terminal"]')!
  const input = await search('sem correspondencia')
  expect(document.body.textContent).toContain('Nenhuma configuração encontrada')
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(input.value).toBe('')
  expect(state.close).not.toHaveBeenCalled()
  expect(document.querySelector('section[aria-label="Shell e terminal"]')).toBe(panel)
  await search('revisao smart diff')
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Prompts')
  expect(document.querySelector('[aria-label="Prompts de execução"] [role=tab][aria-selected=true]')?.textContent).toBe(
    'Smart Diff',
  )
  expect(document.querySelector('[data-settings-section="prompt-smartDiffReview"]')?.getAttribute('role')).toBe(
    'tabpanel',
  )
})
