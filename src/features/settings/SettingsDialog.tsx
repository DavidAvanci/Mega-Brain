import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ActivityIslandSettingsHandle } from './ActivityIslandSettings'
import { DirectorySettings } from './DirectorySettings'
const ActivityIslandSettings = lazy(() =>
  import('./ActivityIslandSettings').then((module) => ({ default: module.ActivityIslandSettings })),
)
const ExecutionSettings = lazy(() =>
  import('./ExecutionSettings').then((module) => ({ default: module.ExecutionSettings })),
)
const IdeSettings = lazy(() => import('./IdeSettings').then((module) => ({ default: module.IdeSettings })))
const JiraSettings = lazy(() => import('./JiraSettings').then((module) => ({ default: module.JiraSettings })))
const TerminalSettings = lazy(() =>
  import('./TerminalSettings').then((module) => ({ default: module.TerminalSettings })),
)
const TriageSettings = lazy(() => import('./TriageSettings').then((module) => ({ default: module.TriageSettings })))
import { HugeiconsIcon } from '@hugeicons/react'
import {
  PaintBrush01Icon,
  CodeIcon,
  CpuIcon,
  CommandLineIcon,
  Link01Icon,
  FileEditIcon,
  Layers01Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { PromptSettings } from '../../../shared/domain/settings'
import {
  setColorMode,
  setPalette,
  setShape,
  setThemePreset,
  setTypography,
  useTheme,
  useThemeSettings,
  type ThemeSettings,
} from '@/theme'
import { isMacOSDesktop, isTauriDesktop } from '@/desktopBootstrap'
import { useSettingsDialog } from './useSettingsDialog'
import { FALLBACK_CODEX_CATALOG } from '../../../shared/domain/codex-models'
import { SettingsSearchInput, SettingsSearchResults } from './SettingsSearch'
import { searchSettings, SETTINGS_TAB_LABELS, type SettingsSearchEntry, type SettingsTab } from './settings-search'
import { PROMPT_FIELDS, PromptsSettings } from './PromptsSettings'

type ThemeChoice = {
  value: string
  label: string
  description: string
  colors?: [string, string, string, string]
  darkColors?: [string, string, string, string]
  fontFamily?: string
  radius?: string
  cornerShape?: string
}

function SettingsSectionLoading() {
  return (
    <div className="space-y-3" aria-label="Carregando configurações" aria-busy="true">
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}

const THEME_CATEGORIES: {
  key: 'palette' | 'typography' | 'shape' | 'preset'
  title: string
  description: string
  options: ThemeChoice[]
}[] = [
  {
    key: 'palette',
    title: 'Paleta de cores',
    description: 'Muda somente as cores usadas no aplicativo.',
    options: [
      {
        value: 'classic',
        label: 'Clássica',
        description: 'Neutros, segue o modo do sistema.',
        colors: ['#ffffff', '#f1f1f1', '#29707a', '#222222'],
        darkColors: ['#171717', '#292929', '#29707a', '#eeeeee'],
      },
      {
        value: 'takeat',
        label: 'Takeat',
        description: 'Vermelho, branco e cinza.',
        colors: ['#ffffff', '#f6f6f6', '#c8131b', '#545454'],
        darkColors: ['#181719', '#222023', '#ff6872', '#f5f1f2'],
      },
      {
        value: 'minecraft',
        label: 'Minecraft',
        description: 'Blocos, tons de grama e tipografia técnica.',
        colors: ['#e8efdd', '#dce7cf', '#4b7d32', '#8c6b3d'],
        darkColors: ['#1d271d', '#283629', '#91c45e', '#c2995d'],
      },
      {
        value: 'ocean',
        label: 'Oceano',
        description: 'Azuis frios e ciano.',
        colors: ['#f2f7fb', '#ffffff', '#397bd8', '#70c7dc'],
        darkColors: ['#111a26', '#192535', '#73adff', '#70d2e3'],
      },
      {
        value: 'terracotta',
        label: 'Terracota',
        description: 'Creme, coral e âmbar.',
        colors: ['#fbf4e6', '#fffaf1', '#d5573f', '#eca34a'],
        darkColors: ['#211a17', '#2c231e', '#ff977f', '#ffc16f'],
      },
      {
        value: 'berry',
        label: 'Frutas silvestres',
        description: 'Malva, ameixa e rosa.',
        colors: ['#f8f1f7', '#fffaff', '#a44f91', '#916de0'],
        darkColors: ['#211823', '#2b202f', '#e88bd2', '#b19aff'],
      },
    ],
  },
  {
    key: 'typography',
    title: 'Tipografia',
    description: 'Muda somente as famílias tipográficas e o ritmo do texto.',
    options: [
      {
        value: 'classic',
        label: 'Clássica',
        description: 'JetBrains Mono, compacta e técnica.',
        fontFamily: "'JetBrains Mono Variable', monospace",
      },
      {
        value: 'takeat',
        label: 'Poppins',
        description: 'Poppins, geométrica e amigável.',
        fontFamily: "'Poppins', sans-serif",
      },
      {
        value: 'editorial',
        label: 'Editorial',
        description: 'Georgia, serifada e espaçosa.',
        fontFamily: "Georgia, 'Times New Roman', serif",
      },
      {
        value: 'technical',
        label: 'Técnica',
        description: 'JetBrains Mono com mais espaçamento.',
        fontFamily: "'JetBrains Mono Variable', monospace",
      },
      {
        value: 'minecraft',
        label: 'Minecraft',
        description: 'Pixelify Sans, pixelada com leitura mais suave.',
        fontFamily: "'Pixelify Sans Variable', monospace",
      },
    ],
  },
  {
    key: 'shape',
    title: 'Formatos',
    description: 'Muda somente o raio e a forma dos cantos.',
    options: [
      {
        value: 'classic',
        label: 'Clássico',
        description: 'Cantos arredondados discretos.',
        radius: '0.625rem',
        cornerShape: 'round',
      },
      {
        value: 'takeat',
        label: 'Takeat',
        description: 'Arredondamento suave de 12 px.',
        radius: '0.75rem',
        cornerShape: 'round',
      },
      {
        value: 'squircle',
        label: 'Squircle',
        description: 'Superelipse com curva acentuada.',
        radius: '1.75rem',
        cornerShape: 'superellipse(1.5)',
      },
      {
        value: 'soft',
        label: 'Suave',
        description: 'Curvas amplas e orgânicas.',
        radius: '1.25rem',
        cornerShape: 'superellipse(1.2)',
      },
      {
        value: 'angular',
        label: 'Angular',
        description: 'Cantos pequenos e geométricos.',
        radius: '0.3rem',
        cornerShape: 'superellipse(4)',
      },
      {
        value: 'minecraft',
        label: 'Minecraft',
        description: 'Blocos quadrados com borda em camadas.',
        radius: '0',
        cornerShape: 'round',
      },
    ],
  },
  {
    key: 'preset',
    title: 'Presets',
    description: 'Aplica paleta, tipografia e formatos em conjunto.',
    options: [
      {
        value: 'takeat',
        label: 'Takeat',
        description: 'Identidade Takeat completa.',
        colors: ['#ffffff', '#f6f6f6', '#c8131b', '#545454'],
        darkColors: ['#181719', '#222023', '#ff6872', '#f5f1f2'],
      },
      {
        value: 'classic',
        label: 'Clássico',
        description: 'Aparência original do Mega Brain.',
        colors: ['#ffffff', '#f1f1f1', '#29707a', '#222222'],
        darkColors: ['#171717', '#292929', '#29707a', '#eeeeee'],
      },
      {
        value: 'minecraft',
        label: 'Minecraft',
        description: 'Visual pixelado com paleta de grama, terra e pedra.',
        colors: ['#e8efdd', '#dce7cf', '#4b7d32', '#8c6b3d'],
        darkColors: ['#1d271d', '#283629', '#91c45e', '#c2995d'],
      },
    ],
  },
]

const FLOW_SUMMARIES = [
  {
    title: 'Simples',
    path: 'Planejamento → Desenvolvimento → Code Review',
    artifacts: 'Gera somente TASK-CHECKLIST.md',
  },
  {
    title: 'Médio',
    path: 'Planejamento → Revisão de plano → Desenvolvimento → Code Review',
    artifacts: 'Gera PLAN.md e TASK-CHECKLIST.md',
  },
  {
    title: 'Difícil',
    path: 'Fluxo completo, incluindo revisão de plano',
    artifacts: 'Gera plano, tasks e testes',
  },
]

const SETTINGS_TABS = [
  { value: 'general', label: SETTINGS_TAB_LABELS.general, icon: PaintBrush01Icon },
  { value: 'jira', label: SETTINGS_TAB_LABELS.jira, icon: Link01Icon },
  { value: 'models', label: SETTINGS_TAB_LABELS.models, icon: CpuIcon },
  { value: 'ides', label: SETTINGS_TAB_LABELS.ides, icon: CodeIcon },
  { value: 'terminal', label: SETTINGS_TAB_LABELS.terminal, icon: CommandLineIcon },
  { value: 'integrations', label: SETTINGS_TAB_LABELS.integrations, icon: Link01Icon },
  { value: 'prompts', label: SETTINGS_TAB_LABELS.prompts, icon: FileEditIcon },
  { value: 'island', label: SETTINGS_TAB_LABELS.island, icon: Layers01Icon },
] as const

export function SettingsDialog({
  onClose,
  initialTab = 'general',
}: {
  onClose: () => void
  initialTab?: SettingsTab | 'tools'
}) {
  const [tab, setTab] = useState<string>(
    initialTab === 'tools' ? 'models' : initialTab === 'island' && !isMacOSDesktop() ? 'general' : initialTab,
  )
  const islandSettings = useRef<ActivityIslandSettingsHandle>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchResults = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [searchTarget, setSearchTarget] = useState<SettingsSearchEntry | null>(null)
  const [promptTab, setPromptTab] = useState<keyof PromptSettings>('taskPlanning')
  const [savingIsland, setSavingIsland] = useState(false)
  const [islandLoaded, setIslandLoaded] = useState(false)
  const theme = useThemeSettings()
  const colorMode = useTheme()
  const desktop = isTauriDesktop()
  const {
    settings,
    editorDiscovery,
    editorsLoaded,
    autostartEnabled,
    autostartLoaded,
    error,
    saving,
    codexCatalog = FALLBACK_CODEX_CATALOG,
    codexModelsLoading = false,
    refreshModels,
    setAutostartEnabled,
    updateStage,
    updateGeneral,
    updatePrompts,
    save,
    close,
  } = useSettingsDialog(desktop, onClose, tab as SettingsTab)

  const busy = saving || savingIsland
  const settingsReady = settings !== null
  const searching = Boolean(query.trim())
  const results = searchSettings(query, {
    desktop,
    macOS: isMacOSDesktop(),
    codex: settings?.general.llmProvider === 'chatgpt',
  })
  const changeQuery = (value: string) => {
    setQuery(value)
    setSearchTarget(null)
  }
  const selectResult = (entry: SettingsSearchEntry) => {
    if (busy) return
    if (entry.tab === 'prompts') {
      const field = PROMPT_FIELDS.find((field) => `prompt-${field.key}` === entry.target)
      if (field) setPromptTab(field.key)
    }
    setTab(entry.tab)
    setQuery('')
    setSearchTarget(entry)
  }

  useEffect(() => {
    if (!searchTarget || searching) return
    const target = dialog.current?.querySelector<HTMLElement>(`[data-settings-section="${searchTarget.target}"]`)
    if (!target) return
    if (target instanceof HTMLDetailsElement) target.open = true
    target.tabIndex = -1
    target.scrollIntoView?.({ block: 'start' })
    target.focus({ preventScroll: true })
  }, [searchTarget, searching])

  const saveSettings = async () => {
    if (busy) return
    if (tab === 'island') {
      setSavingIsland(true)
      try {
        if (!(await islandSettings.current?.save())) return
        await save()
      } finally {
        setSavingIsland(false)
      }
      return
    }
    await save()
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return
        if (query && details.reason === 'escape-key') {
          details.cancel()
          changeQuery('')
          searchInput.current?.focus()
          return
        }
        if (!busy) close()
      }}
    >
      <DialogContent
        ref={dialog}
        className="flex h-[48rem] max-h-[90dvh] w-[56rem] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-clip p-0 sm:max-w-[calc(100vw-2rem)]"
        showCloseButton={!busy}
      >
        <DialogHeader className="shrink-0 px-5 py-4">
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>Personalize o aplicativo, as integrações e seu ambiente de execução.</DialogDescription>
        </DialogHeader>
        {error && <p className="mx-5 mb-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        <div className="h-full min-h-0 min-w-0 flex-1">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(String(value))
              setSearchTarget(null)
            }}
            orientation="vertical"
            className="h-full min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-clip border-t sm:flex-row"
          >
            <aside
              aria-label="Navegação de configurações"
              className="flex max-h-[45%] min-h-0 min-w-0 w-full shrink-0 flex-col gap-2 overflow-x-hidden overflow-y-clip border-b bg-muted/25 p-2 sm:max-h-none sm:w-48 sm:border-e sm:border-b-0"
            >
              <SettingsSearchInput
                inputRef={searchInput}
                query={query}
                onChange={changeQuery}
                onSelectFirst={() => results[0] && selectResult(results[0])}
                onFocusResults={() => searchResults.current?.querySelector<HTMLButtonElement>('button')?.focus()}
                disabled={busy}
              />
              {searching && (
                <SettingsSearchResults
                  results={results}
                  categories={SETTINGS_TABS}
                  onSelect={selectResult}
                  inputRef={searchInput}
                  containerRef={searchResults}
                  disabled={busy}
                />
              )}
              <TabsList
                aria-label="Categorias de configurações"
                className={`grid h-auto min-h-0 min-w-0 w-full grid-cols-2 justify-start gap-1 overflow-x-hidden overflow-y-auto rounded-none bg-transparent p-0 sm:flex sm:flex-col ${searching ? 'hidden sm:hidden' : ''}`}
              >
                {SETTINGS_TABS.filter((item) => item.value !== 'island' || isMacOSDesktop()).map((item) => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className="h-9 min-w-0 justify-start px-2 text-xs group-data-vertical/tabs:after:right-0"
                    disabled={busy}
                  >
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                    <span className="whitespace-normal text-start">{item.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </aside>

            <TabsContent value="general" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
              <div className="grid min-w-0 gap-5">
                <section className="grid gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Aparência</h3>
                    <p className="text-xs text-muted-foreground">
                      Tema compartilhado entre web e desktop. Personalize cada aspecto ou aplique um preset.
                    </p>
                  </div>
                  <section className="grid gap-2" aria-label="Modo de cores" data-settings-section="mode">
                    <div>
                      <h4 className="text-xs font-semibold">Modo</h4>
                      <p className="text-[10px] text-muted-foreground">
                        Use a preferência do sistema ou escolha claro/escuro.
                      </p>
                    </div>
                    <div
                      className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/50 p-1"
                      role="radiogroup"
                      aria-label="Modo de cores"
                    >
                      {(
                        [
                          ['system', 'Sistema'],
                          ['light', 'Claro'],
                          ['dark', 'Escuro'],
                        ] as const
                      ).map(([value, label]) => {
                        const selected = theme.mode === value
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            onClick={() => setColorMode(value)}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                  <div className="grid gap-4" aria-label="Categorias de tema">
                    {THEME_CATEGORIES.map((category) => (
                      <section
                        key={category.title}
                        className="grid gap-2"
                        aria-label={category.title}
                        data-settings-section={category.key}
                      >
                        <div>
                          <h4 className="text-xs font-semibold">{category.title}</h4>
                          <p className="text-[10px] text-muted-foreground">{category.description}</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={category.title}>
                          {category.options.map((option) => {
                            const selected = theme[category.key] === option.value
                            return (
                              <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                  className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${selected ? 'border-primary bg-primary/8 ring-1 ring-primary/25' : 'border-border hover:bg-muted/60'}`}
                                onClick={() => {
                                  if (category.key === 'palette') setPalette(option.value as ThemeSettings['palette'])
                                  else if (category.key === 'typography') {
                                    setTypography(option.value as ThemeSettings['typography'])
                                  } else if (category.key === 'shape') setShape(option.value as ThemeSettings['shape'])
                                  else setThemePreset(option.value as Exclude<ThemeSettings['preset'], null>)
                                }}
                              >
                                {option.colors ? (
                                  <span
                                    className="grid size-10 grid-cols-2 overflow-hidden rounded-md border border-black/10 shadow-sm"
                                    aria-hidden="true"
                                  >
                                    {(colorMode === 'dark' ? (option.darkColors ?? option.colors) : option.colors).map(
                                      (color) => (
                                        <span key={color} style={{ backgroundColor: color }} />
                                      ),
                                    )}
                                  </span>
                                ) : category.key === 'typography' ? (
                                  <span
                                    className="grid size-10 place-items-center rounded-md border bg-muted text-lg font-semibold"
                                    style={{ fontFamily: option.fontFamily }}
                                    aria-hidden="true"
                                  >
                                    Aa
                                  </span>
                                ) : (
                                  <span
                                    className="grid size-10 place-items-center rounded-md border bg-muted"
                                    aria-hidden="true"
                                  >
                                    <span
                                      className="size-7 border-2 border-primary bg-primary/15"
                                      style={
                                        {
                                          borderRadius: option.radius,
                                          cornerShape: option.cornerShape,
                                        } as CSSProperties
                                      }
                                    />
                                  </span>
                                )}
                                <span className="min-w-0">
                                  <span className="block text-xs font-semibold">{option.label}</span>
                                  <span className="block truncate text-[10px] text-muted-foreground">
                                    {option.description}
                                  </span>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>

                {desktop && (
                  <section className="grid gap-2" data-settings-section="startup">
                    <div>
                      <h3 className="text-sm font-medium">Inicialização</h3>
                      <p className="text-xs text-muted-foreground">
                        Controle quando o aplicativo deve ser aberto ao entrar no{' '}
                        {isMacOSDesktop() ? 'macOS' : 'Windows'}.
                      </p>
                    </div>
                    {!settingsReady || !autostartLoaded ? (
                      <div
                        className="h-14 animate-pulse rounded-lg bg-muted"
                        aria-label="Carregando inicialização"
                        aria-busy="true"
                      />
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autostartEnabled}
                        disabled={saving || !autostartLoaded}
                        onClick={() => setAutostartEnabled((enabled) => !enabled)}
                        className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span>
                          <span className="block text-xs font-medium">Abrir ao iniciar o computador</span>
                          <span className="block text-[11px] text-muted-foreground">
                            Inicia o Mega Brain automaticamente após entrar na sua conta do sistema.
                          </span>
                        </span>
                        <span
                          className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${autostartEnabled ? 'bg-primary' : 'bg-muted-foreground/35'}`}
                          aria-hidden="true"
                        >
                          <span
                            className={`size-4 rounded-full bg-background shadow-sm transition-transform ${autostartEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                          />
                        </span>
                      </button>
                    )}
                  </section>
                )}

                {settings ? (
                  <DirectorySettings value={settings.general} onChange={updateGeneral} disabled={busy} />
                ) : (
                  <section className="grid gap-3" aria-label="Carregando diretórios" aria-busy="true">
                    <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                    <div className="h-10 animate-pulse rounded-md bg-muted" />
                    <div className="h-10 animate-pulse rounded-md bg-muted" />
                  </section>
                )}

                <section className="grid gap-2" data-settings-section="flows">
                  <div>
                    <h3 className="text-sm font-medium">Perfis de fluxo</h3>
                    <p className="text-xs text-muted-foreground">
                      Cada perfil aumenta gradualmente as etapas e os artefatos gerados.
                    </p>
                  </div>
                  <div className="divide-y overflow-hidden rounded-lg border">
                    {FLOW_SUMMARIES.map((profile) => (
                        <div key={profile.title} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[70px_minmax(0,1fr)] sm:gap-3">
                        <div className="text-xs font-semibold">{profile.title}</div>
                        <div>
                          <p className="text-xs text-foreground/85">{profile.path}</p>
                          <p className="text-[10px] text-muted-foreground">{profile.artifacts}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </TabsContent>

            <TabsContent value="jira" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
              {settings ? (
                <Suspense fallback={<SettingsSectionLoading />}>
                  <JiraSettings value={settings.general} onChange={updateGeneral} disabled={busy} />
                </Suspense>
              ) : (
                <SettingsSectionLoading />
              )}
            </TabsContent>
            <TabsContent value="models" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
              {settings ? (
                <Suspense fallback={<SettingsSectionLoading />}>
                  <ExecutionSettings
                    settings={settings}
                    onGeneralChange={updateGeneral}
                    onStageChange={updateStage}
                    disabled={busy}
                    catalog={codexCatalog}
                    loading={codexModelsLoading}
                    onRefresh={refreshModels}
                  />
                </Suspense>
              ) : (
                <SettingsSectionLoading />
              )}
            </TabsContent>
            <TabsContent value="ides" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
              {settings && editorsLoaded ? (
                <Suspense fallback={<SettingsSectionLoading />}>
                  <IdeSettings
                    value={settings.general}
                    onChange={updateGeneral}
                    disabled={busy}
                    initialEditors={editorDiscovery}
                  />
                </Suspense>
              ) : (
                <SettingsSectionLoading />
              )}
            </TabsContent>
            <TabsContent value="terminal" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
              {settings ? (
                <Suspense fallback={<SettingsSectionLoading />}>
                  <TerminalSettings value={settings.general} onChange={updateGeneral} disabled={busy} />
                </Suspense>
              ) : (
                <SettingsSectionLoading />
              )}
            </TabsContent>
            <TabsContent value="integrations" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
              {settings ? (
                <Suspense fallback={<SettingsSectionLoading />}>
                  <TriageSettings value={settings.general} onChange={updateGeneral} disabled={busy} />
                </Suspense>
              ) : (
                <SettingsSectionLoading />
              )}
            </TabsContent>

            <TabsContent value="prompts" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
              {settings ? (
                <PromptsSettings
                  value={settings.prompts}
                  onChange={updatePrompts}
                  tab={promptTab}
                  onTabChange={(next) => {
                    setPromptTab(next)
                    setSearchTarget(null)
                  }}
                  disabled={busy}
                />
              ) : (
                <SettingsSectionLoading />
              )}
            </TabsContent>
            {isMacOSDesktop() && (
              <TabsContent value="island" className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5">
                <Suspense fallback={<SettingsSectionLoading />}>
                  <ActivityIslandSettings ref={islandSettings} onLoadedChange={setIslandLoaded} />
                </Suspense>
              </TabsContent>
            )}
          </Tabs>
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-5 py-3">
          <Button variant="outline" onClick={close} disabled={busy}>
            {tab === 'island' ? 'Fechar' : 'Cancelar'}
          </Button>
          <Button
            onClick={() => void saveSettings()}
            disabled={
              !settingsReady ||
              busy ||
              (tab === 'island' && !islandLoaded) ||
              (settings.general.llmProvider === 'chatgpt' && codexModelsLoading)
            }
          >
            {busy ? 'Salvando…' : 'Salvar configurações'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
