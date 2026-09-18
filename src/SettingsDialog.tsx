import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PaintBrush01Icon, ToolsIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchDetectedEditors, fetchMegaBrainSettings, refresh, saveMegaBrainSettings } from './cards'
import type { BoardSettings, EditorDiscovery, Effort, GeneralSettings, MegaBrainSettings } from './types'
import { setTheme, useThemePreference } from './theme'
import { GeneralSettingsForm } from './GeneralSettingsForm'
import { getDesktopAutostartEnabled, setDesktopAutostartEnabled } from './desktopAutostart'
import { isTauriDesktop } from './desktopBootstrap'

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
  { title: 'Simples', path: 'Planejamento → Desenvolvimento → Code Review', artifacts: 'Gera somente TASK-CHECKLIST.md' },
  { title: 'Médio', path: 'Planejamento → Revisão de plano → Desenvolvimento → Code Review', artifacts: 'Gera PLAN.md e TASK-CHECKLIST.md' },
  { title: 'Difícil', path: 'Fluxo completo, incluindo revisão e Auto Testing', artifacts: 'Gera plano, tasks e testes' },
]

const EMPTY_EDITOR_DISCOVERY: EditorDiscovery = { editors: [], scope: 'máquina do backend' }

function ModelRadioGroup({ value, options, disabled, onChange, label }: {
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
            <span className={`grid size-3 place-items-center rounded-full border ${selected ? 'border-primary' : 'border-muted-foreground/50'}`} aria-hidden="true">
              {selected ? <span className="size-1.5 rounded-full bg-primary" /> : null}
            </span>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function EffortScale({ value, disabled, onChange, label }: {
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
            <span className={`h-1.5 rounded-full transition-colors ${index <= selectedIndex ? effort.activeClass : 'bg-muted'}`} aria-hidden="true" />
            <span className={`text-[9px] leading-none ${selected ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{effort.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const theme = useThemePreference()
  const desktop = isTauriDesktop()
  const [settings, setSettings] = useState<MegaBrainSettings | null>(null)
  const [editorDiscovery, setEditorDiscovery] = useState<EditorDiscovery>(EMPTY_EDITOR_DISCOVERY)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartLoaded, setAutostartLoaded] = useState(!desktop)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchMegaBrainSettings(),
      fetchDetectedEditors().catch(() => EMPTY_EDITOR_DISCOVERY),
      desktop
        ? getDesktopAutostartEnabled().catch((cause) => {
            setError(cause instanceof Error ? cause.message : String(cause))
            return false
          })
        : Promise.resolve(false),
    ]).then(([nextSettings, discovery, nextAutostartEnabled]) => {
      setSettings(nextSettings)
      setEditorDiscovery(discovery)
      setAutostartEnabled(nextAutostartEnabled)
      setAutostartLoaded(true)
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [desktop])

  const update = (key: keyof BoardSettings, field: 'model' | 'effort', value: string) => {
    setSettings((current) => current ? { ...current, stages: { ...current.stages, [key]: { ...current.stages[key], [field]: value } } } : current)
  }

  const updateGeneral = (general: GeneralSettings) => {
    setSettings((current) => {
      if (!current) return current
      if (current.general.llmProvider === general.llmProvider) return { ...current, general }
      const stages = Object.fromEntries(Object.entries(current.stages).map(([key, stage]) => [key, {
        ...stage,
        model: general.llmProvider === 'chatgpt' ? 'default' : (key === 'run-test-checklist' ? 'sonnet' : 'fable'),
      }])) as BoardSettings
      return { general, stages }
    })
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      await Promise.all([
        saveMegaBrainSettings(settings),
        desktop ? setDesktopAutostartEnabled(autostartEnabled) : Promise.resolve(),
      ])
      await refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl" showCloseButton={!saving}>
        <DialogHeader className="px-5 py-4">
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>
            Personalize a aparência e os agentes do Mega Brain.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="mx-5 mb-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        {!settings ? (
          <p className="border-t px-5 py-10 text-sm text-muted-foreground">Carregando configurações…</p>
        ) : (
          <Tabs defaultValue="general" orientation="vertical" className="min-h-0 flex-1 gap-0 border-t">
            <TabsList variant="line" className="w-36 shrink-0 justify-start gap-1 rounded-none border-r bg-muted/25 p-2">
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
                    <p className="text-xs text-muted-foreground">Tema compartilhado entre web e desktop.</p>
                  </div>
                  <div className="grid grid-cols-3 rounded-lg border bg-muted p-1" role="group" aria-label="Tema da interface">
                    {([
                      ['system', 'Sistema'],
                      ['light', 'Claro'],
                      ['dark', 'Escuro'],
                    ] as const).map(([value, label]) => (
                      <Button key={value} type="button" size="sm" variant={theme === value ? 'default' : 'ghost'} aria-pressed={theme === value} className={theme === value ? 'shadow-sm' : 'text-muted-foreground'} onClick={() => setTheme(value)}>
                        {label}
                      </Button>
                    ))}
                  </div>
                </section>

                {desktop && (
                  <section className="grid gap-2">
                    <div>
                      <h3 className="text-sm font-medium">Inicialização</h3>
                      <p className="text-xs text-muted-foreground">Controle quando o aplicativo deve ser aberto no Windows.</p>
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
                        <span className="block text-[11px] text-muted-foreground">Inicia o Mega Brain automaticamente após entrar no Windows.</span>
                      </span>
                      <span className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${autostartEnabled ? 'bg-primary' : 'bg-muted-foreground/35'}`} aria-hidden="true">
                        <span className={`size-4 rounded-full bg-background shadow-sm transition-transform ${autostartEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                      </span>
                    </button>
                  </section>
                )}

                <section className="grid gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Perfis de fluxo</h3>
                    <p className="text-xs text-muted-foreground">Cada perfil aumenta gradualmente as etapas e os artefatos gerados.</p>
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
                <GeneralSettingsForm value={settings.general} onChange={updateGeneral} disabled={saving} initialEditors={editorDiscovery} />
                <section className="grid gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Agentes por etapa</h3>
                    <p className="text-xs text-muted-foreground">Modelo e intensidade de raciocínio usados em cada parte do fluxo.</p>
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
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Modelo</span>
                            <ModelRadioGroup label={`Modelo para ${title}`} value={settings.stages[key].model} onChange={(model) => update(key, 'model', model)} disabled={saving} options={settings.general.llmProvider === 'chatgpt' ? CHATGPT_MODELS : CLAUDE_MODELS} />
                          </div>
                          <div className="grid gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Effort</span>
                            <EffortScale label={`Effort para ${title}`} value={settings.stages[key].effort} onChange={(effort) => update(key, 'effort', effort)} disabled={saving} />
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
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={!settings || saving}>{saving ? 'Salvando…' : 'Salvar configurações'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
