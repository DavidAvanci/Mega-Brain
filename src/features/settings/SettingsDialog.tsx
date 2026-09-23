import { HugeiconsIcon } from '@hugeicons/react'
import { PaintBrush01Icon, ToolsIcon } from '@hugeicons/core-free-icons'
import type { CSSProperties } from 'react'
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
import type { BoardSettings, Effort } from '../../../shared/domain/settings'
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
import { GeneralSettingsForm } from '@/GeneralSettingsForm'
import { isTauriDesktop } from '@/desktopBootstrap'
import { useSettingsDialog } from './useSettingsDialog'

const CLAUDE_MODELS = [
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]
const CHATGPT_MODELS = [
  { value: 'default', label: 'Automático' },
  { value: 'gpt-6-astra', label: 'Astra' },
  { value: 'gpt-5.6-sol', label: 'Sol' },
  { value: 'gpt-5.6-terra', label: 'Terra' },
  { value: 'gpt-5.6-luna', label: 'Luna' },
  { value: 'gpt-5.5', label: 'GPT-5.5' },
]

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
      { value: 'classic', label: 'Clássica', description: 'Neutros, segue o modo do sistema.', colors: ['#ffffff', '#f1f1f1', '#29707a', '#222222'], darkColors: ['#171717', '#292929', '#29707a', '#eeeeee'] },
      { value: 'takeat', label: 'Takeat', description: 'Vermelho, branco e cinza.', colors: ['#ffffff', '#f6f6f6', '#c8131b', '#545454'], darkColors: ['#181719', '#222023', '#ff6872', '#f5f1f2'] },
      { value: 'ocean', label: 'Oceano', description: 'Azuis frios e ciano.', colors: ['#f2f7fb', '#ffffff', '#397bd8', '#70c7dc'], darkColors: ['#111a26', '#192535', '#73adff', '#70d2e3'] },
      { value: 'terracotta', label: 'Terracota', description: 'Creme, coral e âmbar.', colors: ['#fbf4e6', '#fffaf1', '#d5573f', '#eca34a'], darkColors: ['#211a17', '#2c231e', '#ff977f', '#ffc16f'] },
      { value: 'berry', label: 'Frutas silvestres', description: 'Malva, ameixa e rosa.', colors: ['#f8f1f7', '#fffaff', '#a44f91', '#916de0'], darkColors: ['#211823', '#2b202f', '#e88bd2', '#b19aff'] },
    ],
  },
  {
    key: 'typography',
    title: 'Tipografia',
    description: 'Muda somente as famílias tipográficas e o ritmo do texto.',
    options: [
      { value: 'classic', label: 'Clássica', description: 'JetBrains Mono, compacta e técnica.', fontFamily: "'JetBrains Mono Variable', monospace" },
      { value: 'takeat', label: 'Poppins', description: 'Poppins, geométrica e amigável.', fontFamily: "'Poppins', sans-serif" },
      { value: 'editorial', label: 'Editorial', description: 'Georgia, serifada e espaçosa.', fontFamily: "Georgia, 'Times New Roman', serif" },
      { value: 'technical', label: 'Técnica', description: 'JetBrains Mono com mais espaçamento.', fontFamily: "'JetBrains Mono Variable', monospace" },
    ],
  },
  {
    key: 'shape',
    title: 'Formatos',
    description: 'Muda somente o raio e a forma dos cantos.',
    options: [
      { value: 'classic', label: 'Clássico', description: 'Cantos arredondados discretos.', radius: '0.625rem', cornerShape: 'round' },
      { value: 'takeat', label: 'Takeat', description: 'Arredondamento suave de 12 px.', radius: '0.75rem', cornerShape: 'round' },
      { value: 'squircle', label: 'Squircle', description: 'Superelipse com curva acentuada.', radius: '1.75rem', cornerShape: 'superellipse(1.5)' },
      { value: 'soft', label: 'Suave', description: 'Curvas amplas e orgânicas.', radius: '1.25rem', cornerShape: 'superellipse(1.2)' },
      { value: 'angular', label: 'Angular', description: 'Cantos pequenos e geométricos.', radius: '0.3rem', cornerShape: 'superellipse(4)' },
    ],
  },
  {
    key: 'preset',
    title: 'Presets',
    description: 'Aplica paleta, tipografia e formatos em conjunto.',
    options: [
      { value: 'takeat', label: 'Takeat', description: 'Identidade Takeat completa.', colors: ['#ffffff', '#f6f6f6', '#c8131b', '#545454'], darkColors: ['#181719', '#222023', '#ff6872', '#f5f1f2'] },
      { value: 'classic', label: 'Clássico', description: 'Aparência original do Mega Brain.', colors: ['#ffffff', '#f1f1f1', '#29707a', '#222222'], darkColors: ['#171717', '#292929', '#29707a', '#eeeeee'] },
    ],
  },
]

const EFFORTS: { value: Effort; label: string; activeClass: string }[] = [
  { value: 'low', label: 'Low', activeClass: 'bg-primary/30' },
  { value: 'medium', label: 'Medium', activeClass: 'bg-primary/45' },
  { value: 'high', label: 'High', activeClass: 'bg-primary/65' },
  { value: 'xhigh', label: 'X-high', activeClass: 'bg-primary/80' },
  { value: 'max', label: 'Max', activeClass: 'bg-primary' },
]
const STAGES: { key: keyof BoardSettings; title: string; description: string }[] = [
  { key: 'task-planning', title: 'Planejamento', description: 'Criação do plano e checklists.' },
  { key: 'run-task-checklist', title: 'Desenvolvimento', description: 'Execução dos itens de desenvolvimento.' },
  { key: 'run-test-checklist', title: 'Testes automáticos', description: 'Execução dos cenários de teste.' },
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
    path: 'Fluxo completo, incluindo revisão e Auto Testing',
    artifacts: 'Gera plano, tasks e testes',
  },
]

function ModelRadioGroup({
  value,
  options,
  disabled,
  onChange,
  label,
}: {
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
  label: string
}) {
  const visibleOptions = options.some((option) => option.value === value)
    ? options
    : [{ value, label: value }, ...options]

  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
      {visibleOptions.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 ${selected ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border/70 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <span
              className={`grid size-3 place-items-center rounded-full border ${selected ? 'border-primary' : 'border-muted-foreground/50'}`}
              aria-hidden="true"
            >
              {selected ? <span className="size-1.5 rounded-full bg-primary" /> : null}
            </span>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function EffortScale({
  value,
  disabled,
  onChange,
  label,
}: {
  value: Effort
  disabled?: boolean
  onChange: (value: Effort) => void
  label: string
}) {
  const selectedIndex = EFFORTS.findIndex((effort) => effort.value === value)
  return (
    <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={label}>
      {EFFORTS.map((effort, index) => {
        const selected = effort.value === value
        return (
          <button
            key={effort.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(effort.value)}
            className={`group grid w-[40px] gap-1 rounded-md px-0.5 py-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 ${selected ? 'bg-primary/8' : 'hover:bg-muted/70'}`}
          >
            <span
              className={`h-1.5 rounded-full transition-colors ${index <= selectedIndex ? effort.activeClass : 'bg-muted'}`}
              aria-hidden="true"
            />
            <span
              className={`text-[9px] leading-none ${selected ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
            >
              {effort.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const theme = useThemeSettings()
  const colorMode = useTheme()
  const desktop = isTauriDesktop()
  const {
    settings,
    editorDiscovery,
    autostartEnabled,
    autostartLoaded,
    error,
    saving,
    setAutostartEnabled,
    updateStage,
    updateGeneral,
    save,
  } = useSettingsDialog(desktop, onClose)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl" showCloseButton={!saving}>
        <DialogHeader className="px-5 py-4">
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>Personalize a aparência e os agentes do Mega Brain.</DialogDescription>
        </DialogHeader>
        {error && <p className="mx-5 mb-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        {!settings ? (
          <p className="border-t px-5 py-10 text-sm text-muted-foreground">Carregando configurações…</p>
        ) : (
          <Tabs defaultValue="general" orientation="vertical" className="min-h-0 flex-1 gap-0 border-t">
            <TabsList
              variant="line"
              className="w-36 shrink-0 justify-start gap-1 rounded-none border-r bg-muted/25 p-2"
            >
              <TabsTrigger value="general" className="h-9 min-w-0 px-2 text-xs">
                <HugeiconsIcon icon={PaintBrush01Icon} strokeWidth={2} /> Geral
              </TabsTrigger>
              <TabsTrigger value="tools" className="h-9 min-w-0 px-2 text-xs">
                <HugeiconsIcon icon={ToolsIcon} strokeWidth={2} /> Ferramentas
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="max-h-[65vh] overflow-y-auto p-4 sm:p-5">
              <div className="grid gap-5">
                <section className="grid gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Aparência</h3>
                    <p className="text-xs text-muted-foreground">Tema compartilhado entre web e desktop. Personalize cada aspecto ou aplique um preset.</p>
                  </div>
                  <section className="grid gap-2" aria-label="Modo de cores">
                    <div>
                      <h4 className="text-xs font-semibold">Modo</h4>
                      <p className="text-[10px] text-muted-foreground">Use a preferência do sistema ou escolha claro/escuro.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/50 p-1" role="radiogroup" aria-label="Modo de cores">
                      {([
                        ['system', 'Sistema'],
                        ['light', 'Claro'],
                        ['dark', 'Escuro'],
                      ] as const).map(([value, label]) => {
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
                      <section key={category.title} className="grid gap-2" aria-label={category.title}>
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
                                className={`grid grid-cols-[auto_1fr] items-center gap-3 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${selected ? 'border-primary bg-primary/8 ring-1 ring-primary/25' : 'border-border hover:bg-muted/60'}`}
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
                                    {(colorMode === 'dark' ? option.darkColors ?? option.colors : option.colors).map((color) => (
                                      <span key={color} style={{ backgroundColor: color }} />
                                    ))}
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
                                  <span className="grid size-10 place-items-center rounded-md border bg-muted" aria-hidden="true">
                                    <span
                                      className="size-7 border-2 border-primary bg-primary/15"
                                      style={{ borderRadius: option.radius, cornerShape: option.cornerShape } as CSSProperties}
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
                  <section className="grid gap-2">
                    <div>
                      <h3 className="text-sm font-medium">Inicialização</h3>
                      <p className="text-xs text-muted-foreground">
                        Controle quando o aplicativo deve ser aberto no Windows.
                      </p>
                    </div>
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
                          Inicia o Mega Brain automaticamente após entrar no Windows.
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
                  </section>
                )}

                <section className="grid gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Perfis de fluxo</h3>
                    <p className="text-xs text-muted-foreground">
                      Cada perfil aumenta gradualmente as etapas e os artefatos gerados.
                    </p>
                  </div>
                  <div className="divide-y overflow-hidden rounded-lg border">
                    {FLOW_SUMMARIES.map((profile) => (
                      <div key={profile.title} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[70px_1fr] sm:gap-3">
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

            <TabsContent value="tools" className="max-h-[65vh] overflow-y-auto p-4 sm:p-5">
              <div className="grid gap-5">
                <GeneralSettingsForm
                  value={settings.general}
                  onChange={updateGeneral}
                  disabled={saving}
                  initialEditors={editorDiscovery}
                />
                <section className="grid gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Agentes por etapa</h3>
                    <p className="text-xs text-muted-foreground">
                      Modelo e intensidade de raciocínio usados em cada parte do fluxo.
                    </p>
                  </div>
                  <div className="divide-y overflow-hidden rounded-lg border">
                    {STAGES.map(({ key, title, description }) => (
                      <fieldset key={key} className="grid gap-2.5 p-3">
                        <legend className="sr-only">{title}</legend>
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="text-xs font-semibold">{title}</div>
                          <p className="text-[10px] text-muted-foreground">{description}</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <div className="grid gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Modelo
                            </span>
                            <ModelRadioGroup
                              label={`Modelo para ${title}`}
                              value={settings.stages[key].model}
                              onChange={(model) => updateStage(key, 'model', model)}
                              disabled={saving}
                              options={settings.general.llmProvider === 'chatgpt' ? CHATGPT_MODELS : CLAUDE_MODELS}
                            />
                          </div>
                          <div className="grid gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Effort
                            </span>
                            <EffortScale
                              label={`Effort para ${title}`}
                              value={settings.stages[key].effort}
                              onChange={(effort) => updateStage(key, 'effort', effort)}
                              disabled={saving}
                            />
                          </div>
                        </div>
                      </fieldset>
                    ))}
                  </div>
                </section>
              </div>
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!settings || saving}>
            {saving ? 'Salvando…' : 'Salvar configurações'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
