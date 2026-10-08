import { invoke } from '@tauri-apps/api/core'
import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/Tip'
import { requestJson } from '@/shared/api/request-json'
import { DEFAULT_ISLAND_DISPLAY, type IslandDisplaySettings } from '../../../shared/domain/activity-island'
import { CodexProfilesSettings } from './CodexProfilesSettings'

type Monitor = { id: string; label: string; primary: boolean }
type DisplayPatch = Partial<IslandDisplaySettings>
type PreviewState = 'running' | 'thinking' | 'waiting' | 'success' | 'error'
const SETTINGS_PATH = '/api/activity-island/settings'
const SAVE_DELAY = 150
const STATES = [
  ['running', 'Executando', 'runningColor'],
  ['thinking', 'Pensando', 'thinkingColor'],
  ['waiting', 'Aguardando resposta', 'waitingColor'],
  ['success', 'Concluído', 'successColor'],
  ['error', 'Erro', 'errorColor'],
] as const
const RANGES = [
  ['fontSize', 'Texto', 9, 14],
  ['cornerRadius', 'Cantos arredondados', 12, 40],
  ['compactWidth', 'Largura compacta', 360, 600],
  ['maxWidth', 'Largura expandida', 520, 900],
  ['completionHeight', 'Altura mínima do card', 54, 140],
  ['maxHeight', 'Altura expandida', 220, 600],
] as const

function useIslandSettings() {
  const [display, setDisplay] = useState({ ...DEFAULT_ISLAND_DISPLAY })
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<'ready' | 'saving' | 'saved'>('ready')
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const current = useRef(display)
  const pending = useRef<DisplayPatch>({})
  const inFlight = useRef<DisplayPatch | null>(null)
  const blocked = useRef(false)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushRef = useRef<() => Promise<void>>(async () => {})

  const mergeServer = useCallback((settings: IslandDisplaySettings, local: DisplayPatch) => {
    current.current = { ...DEFAULT_ISLAND_DISPLAY, ...settings, ...local }
    if (mounted.current) setDisplay(current.current)
  }, [])
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void flushRef.current()
    }, SAVE_DELAY)
  }, [])
  const flush = useCallback(async () => {
    if (inFlight.current || blocked.current || !Object.keys(pending.current).length) return
    const patch = pending.current
    pending.current = {}
    inFlight.current = patch
    generation.current += 1
    if (mounted.current) {
      setStatus('saving')
      setError('')
    }
    try {
      const settings = await requestJson<IslandDisplaySettings>(SETTINGS_PATH, 'Falha ao salvar a ilha', {
        method: 'PATCH',
        body: patch,
      })
      mergeServer(settings, pending.current)
      if (mounted.current && !Object.keys(pending.current).length) setStatus('saved')
    } catch (cause: unknown) {
      pending.current = { ...patch, ...pending.current }
      blocked.current = true
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setStatus('ready')
      }
    } finally {
      inFlight.current = null
      generation.current += 1
      if (Object.keys(pending.current).length && !blocked.current) {
        if (mounted.current) schedule()
        else void flushRef.current()
      }
    }
  }, [mergeServer, schedule])
  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const load = useCallback(async () => {
    try {
      const settings = await requestJson<IslandDisplaySettings>(SETTINGS_PATH, 'Falha ao carregar a ilha')
      if (mounted.current) {
        mergeServer(settings, { ...inFlight.current, ...pending.current })
        setLoaded(true)
        setError('')
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [mergeServer])
  useEffect(() => {
    mounted.current = true
    let active = true
    let polling = false
    void load()
    void invoke<Monitor[]>('list_island_monitors')
      .catch(() => [])
      .then((screens) => {
        if (active) setMonitors(screens)
      })
    const interval = setInterval(() => {
      if (polling) return
      polling = true
      const startGeneration = generation.current
      void requestJson<IslandDisplaySettings>(SETTINGS_PATH, 'Falha ao sincronizar a ilha')
        .then((settings) => {
          // A GET started before a save may return stale values after that save.
          if (active && startGeneration === generation.current) {
            mergeServer(settings, { ...inFlight.current, ...pending.current })
          }
        })
        .catch(() => {})
        .finally(() => {
          polling = false
        })
    }, 1000)
    return () => {
      active = false
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      // Switching tabs should still save the last slider movement.
      void flushRef.current()
      clearInterval(interval)
    }
  }, [load, mergeServer])

  const update = (patch: DisplayPatch) => {
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([key, value]) => {
        const existing = current.current[key as keyof IslandDisplaySettings]
        return Array.isArray(value) && Array.isArray(existing)
          ? JSON.stringify(existing) !== JSON.stringify(value)
          : existing !== value
      }),
    ) as DisplayPatch
    if (!Object.keys(changed).length) return
    current.current = { ...current.current, ...changed }
    pending.current = { ...pending.current, ...changed }
    generation.current += 1
    blocked.current = false
    setDisplay(current.current)
    setStatus('saving')
    setError('')
    schedule()
  }
  const retry = () => {
    if (!loaded) {
      void load()
      return
    }
    blocked.current = false
    void flushRef.current()
  }
  return { display, monitors, loaded, status, error, update, retry }
}

function PetPreview({
  agent,
  color,
  size,
  state,
  animations,
  speed,
}: {
  agent: 'codex' | 'claude'
  color: string
  size: number
  state: PreviewState
  animations: boolean
  speed: number
}) {
  const codex = [
    [1, 2],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 1],
    [6, 2],
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
    [5, 3],
    [6, 3],
    [2, 4],
    [5, 4],
  ]
  const claude = [
    [2, 1],
    [5, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 2],
    [6, 2],
    [1, 3],
    [3, 3],
    [4, 3],
    [6, 3],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
  ]
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 18"
      className="shrink-0 island-pet-preview"
      width={size}
      height={size * 0.75}
      style={{
        color,
        filter: `drop-shadow(0 0 4px ${color}66)`,
        animation: animations ? `island-pet-${state} ${100 / speed}s ease-in-out infinite` : 'none',
      }}
    >
      {(agent === 'claude' ? claude : codex).map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x * 3} y={y * 3} width="3" height="3" fill="currentColor" />
      ))}
    </svg>
  )
}

function IslandPreview({ display }: { display: IslandDisplaySettings }) {
  const [state, setState] = useState<PreviewState>('running')
  const [, label, colorKey] = STATES.find(([value]) => value === state)!
  const color = display[colorKey]
  const agent = display.petAppearance === 'auto' ? 'codex' : display.petAppearance
  const asking = state === 'waiting' && display.autoExpandOnWaiting
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/20 p-3" aria-label="Prévia da ilha dinâmica">
      <style>{`
        @keyframes island-pet-running { 50% { transform: translateY(-2px); } }
        @keyframes island-pet-thinking { 50% { opacity: .45; transform: scale(.94); } }
        @keyframes island-pet-waiting { 50% { transform: rotate(-8deg); } }
        @keyframes island-pet-success { 50% { transform: translateY(-3px) scale(1.08); } }
        @keyframes island-pet-error { 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
        @media (prefers-reduced-motion: reduce) { .island-pet-preview { animation: none !important; } }
      `}</style>
      <div
        className={`mx-auto grid max-w-full gap-3 bg-black p-4 text-white transition-opacity ${display.enabled ? '' : 'opacity-35'}`}
        style={{ width: display.compactWidth, borderRadius: display.cornerRadius, fontSize: display.fontSize }}
      >
        <div className="flex items-center gap-3">
          <PetPreview
            agent={agent}
            color={color}
            size={display.petSize}
            state={state}
            animations={display.animations}
            speed={display.animationSpeed}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {display.style === 'detailed' ? 'Atualizar Mega Brain' : 'Mega Brain'}
            </p>
            {display.showActivity && <p style={{ color }}>{label}</p>}
          </div>
          <span className="text-white/50">2 agentes</span>
        </div>
        {asking && (
          <div className="grid gap-2 border-t border-white/15 pt-3">
            <p>Qual abordagem devo seguir?</p>
            <div className="rounded-md border border-white/20 px-3 py-2 text-white/35">Sua resposta…</div>
            <div className={`flex gap-2 text-white/60 ${display.compactOthers ? 'items-center' : 'flex-col'}`}>
              <PetPreview
                agent="claude"
                color={display.thinkingColor}
                size={16}
                state="thinking"
                animations={display.animations}
                speed={display.animationSpeed}
              />
              <span>Outro agente · pensando</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">Prévia · escolha um estado</span>
        <div className="flex gap-1" role="group" aria-label="Estado da prévia">
          {STATES.map(([value, title, key]) => (
            <Tip key={value} label={title}>
              <Button
                type="button"
                size="icon-xs"
                variant={state === value ? 'secondary' : 'ghost'}
                aria-label={`Prévia: ${title}`}
                aria-pressed={state === value}
                onClick={() => setState(value)}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: display[key] }} />
              </Button>
            </Tip>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ActivityIslandSettings() {
  const { display, monitors, loaded, status, error, update, retry } = useIslandSettings()
  return (
    <section className="grid gap-4" aria-label="Ilha dinâmica">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Ilha dinâmica</h3>
          <p className="text-xs text-muted-foreground">Acompanhe agentes e responda às tarefas no topo da tela.</p>
          <p className="mt-1 text-[10px] text-muted-foreground" role="status" aria-live="polite">
            {!loaded
              ? 'Carregando…'
              : error
                ? 'Alterações pendentes'
                : status === 'saving'
                  ? 'Salvando…'
                  : status === 'saved'
                    ? 'Salvo · ilha atualizada'
                    : 'Alterações aplicadas em tempo real'}
          </p>
        </div>
        <Tip label="Restaurar padrões">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Restaurar padrões da ilha"
            disabled={!loaded}
            onClick={() => update(DEFAULT_ISLAND_DISPLAY)}
          >
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
          </Button>
        </Tip>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2">
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
          <Tip label="Tentar novamente">
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Tentar salvar novamente" onClick={retry}>
              <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
            </Button>
          </Tip>
        </div>
      )}
      <IslandPreview display={display} />
      <fieldset disabled={!loaded} className="grid gap-4">
        <div className="grid gap-2">
          <Toggle label="Ativar ilha dinâmica" checked={display.enabled} onChange={(enabled) => update({ enabled })} />
          <Toggle
            label="Sons dos agentes e tarefas"
            checked={display.taskSounds}
            onChange={(taskSounds) => update({ taskSounds })}
          />
        </div>
        <label className="grid gap-1 text-xs">
          Tela
          <select
            className="rounded-md border bg-background p-2"
            value={display.monitorId}
            onChange={(event) => update({ monitorId: event.target.value })}
          >
            <option value="">Tela principal</option>
            {display.monitorId && !monitors.some((monitor) => monitor.id === display.monitorId) && (
              <option value={display.monitorId}>Tela desconectada (usando a principal)</option>
            )}
            {monitors.map((monitor) => (
              <option key={monitor.id} value={monitor.id}>
                {monitor.label}
                {monitor.primary ? ' · principal' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2" role="group" aria-label="Estilo da ilha">
          {(['clean', 'detailed'] as const).map((style) => (
            <Button
              key={style}
              type="button"
              size="sm"
              variant={display.style === style ? 'default' : 'outline'}
              aria-pressed={display.style === style}
              onClick={() => update({ style })}
            >
              {style === 'clean' ? 'Compacta' : 'Detalhada'}
            </Button>
          ))}
        </div>
        <section className="grid gap-3 border-t pt-3" aria-label="Personalização do mascote">
          <h4 className="text-xs font-medium">Mascote</h4>
          <label className="grid gap-1 text-xs">
            Aparência
            <select
              className="rounded-md border bg-background p-2"
              value={display.petAppearance}
              onChange={(event) =>
                update({ petAppearance: event.target.value as IslandDisplaySettings['petAppearance'] })
              }
            >
              <option value="auto">De acordo com o agente</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Range
              label="Tamanho do mascote"
              value={display.petSize}
              min={16}
              max={40}
              onChange={(petSize) => update({ petSize })}
            />
            <Range
              label="Velocidade da animação"
              value={display.animationSpeed}
              min={25}
              max={200}
              unit="%"
              onChange={(animationSpeed) => update({ animationSpeed })}
            />
          </div>
          <Toggle
            label="Animar conforme a atividade"
            checked={display.animations}
            onChange={(animations) => update({ animations })}
          />
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="Cores dos estados">
            {STATES.map(([, label, key]) => (
              <label key={key} className="grid gap-1 text-[10px] text-muted-foreground">
                <input
                  type="color"
                  aria-label={`Cor: ${label}`}
                  className="h-8 w-full cursor-pointer rounded-md border bg-background p-1"
                  value={display[key]}
                  onChange={(event) => update({ [key]: event.target.value })}
                />
                <span>{label === 'Aguardando resposta' ? 'Resposta' : label}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="grid gap-2 border-t pt-3" aria-label="Comportamento da ilha">
          <h4 className="text-xs font-medium">Interação</h4>
          <Toggle
            label="Abrir perguntas automaticamente"
            checked={display.autoExpandOnWaiting}
            onChange={(autoExpandOnWaiting) => update({ autoExpandOnWaiting })}
          />
          <Toggle
            label="Mostrar outros agentes em uma linha compacta"
            checked={display.compactOthers}
            onChange={(compactOthers) => update({ compactOthers })}
          />
          <Toggle
            label="Mostrar a atividade atual"
            checked={display.showActivity}
            onChange={(showActivity) => update({ showActivity })}
          />
        </section>
        <div className="border-t pt-3">
          <CodexProfilesSettings
            compact
            island={{
              hiddenIds: display.hiddenCodexProfileIds,
              showBadge: display.showProfileBadge,
              onHiddenChange: (hiddenCodexProfileIds) => update({ hiddenCodexProfileIds }),
              onBadgeChange: (showProfileBadge) => update({ showProfileBadge }),
            }}
          />
        </div>
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-xs font-medium">Dimensões e texto</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {RANGES.map(([key, label, min, max]) => (
              <Range
                key={key}
                label={label}
                value={display[key]}
                min={min}
                max={max}
                onChange={(value) => update({ [key]: value })}
              />
            ))}
          </div>
        </details>
      </fieldset>
    </section>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function Range({
  label,
  value,
  min,
  max,
  unit = 'px',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="flex justify-between gap-2">
        {label}
        <output className="shrink-0 text-muted-foreground">
          {value} {unit}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
