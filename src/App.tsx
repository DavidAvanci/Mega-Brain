import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BoardMinimap } from './features/board/BoardMinimap'
import { moveCard, refresh, useCards } from './features/cards/model/card-commands'
import { fetchDetectedEditors, fetchMegaBrainSettings } from './features/cards/api/card-detail-api'
import { CardBody } from './features/cards/ui/CardView'
import { CoffeeButton } from './CoffeeButton'
import { CommandPalette } from './CommandPalette'
import { Column } from './features/board/Column'
import { NewCardDialog } from './features/cards/ui/NewCard'
import { AppSidebar } from './AppSidebar'
import type { AppPage } from './AppSidebar'
import { useAttention } from './useAttention'
import { usePanScroll } from './usePanScroll'
import { cn } from '@/lib/utils'
import { STATUS_GROUPS } from './statusMeta'
import { STATUS_LABELS, type Card, type Status } from '../shared/domain/cards'
import type { EditorDiscovery, MegaBrainSettings } from '../shared/domain/settings'
import { isTauriDesktop } from './desktopBootstrap'
import { DesktopWindowControls, invokeDesktopWindowCommand } from './DesktopWindowControls'

const CardModal = lazy(() => import('./features/cards/ui/CardModal').then((module) => ({ default: module.CardModal })))
const DeployPrsDialog = lazy(() =>
  import('./features/deploy-prs/DeployPrsDialog').then((module) => ({ default: module.DeployPrsDialog })),
)
const SettingsDialog = lazy(() =>
  import('./features/settings/SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
)
const OnboardingDialog = lazy(() =>
  import('./OnboardingDialog').then((module) => ({ default: module.OnboardingDialog })),
)
const AgentsPage = lazy(() => import('./features/agents/AgentsPage').then((module) => ({ default: module.AgentsPage })))
const RepositoriesPage = lazy(() => import('./features/repositories/RepositoriesPage').then((module) => ({ default: module.RepositoriesPage })))

export default function App() {
  const { cards, error, loaded } = useCards()
  useAttention(cards, loaded)
  const [opened, setOpened] = useState<{ id: string; tab?: string } | null>(() => {
    if (isTauriDesktop()) return null
    const params = new URLSearchParams(window.location.search)
    const id = params.get('card')
    return id ? { id, tab: params.get('tab') ?? undefined } : null
  })
  const [dragId, setDragId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deployPrsOpen, setDeployPrsOpen] = useState(false)
  const [onboarding, setOnboarding] = useState<{ settings: MegaBrainSettings; editors: EditorDiscovery } | null>(null)
  const [newCardOpen, setNewCardOpen] = useState(false)
  const [windowControlError, setWindowControlError] = useState<string | null>(null)
  const [page, setPage] = useState<AppPage>('kanban')
  const boardRef = useRef<HTMLElement>(null)
  const openNewCard = useCallback(() => setNewCardOpen(true), [])

  useEffect(() => {
    if (isTauriDesktop()) return
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const id = params.get('card')
      setOpened(id ? { id, tab: params.get('tab') ?? undefined } : null)
    }
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      fetchMegaBrainSettings(),
      fetchDetectedEditors().catch(() => ({ editors: [], scope: 'máquina do backend' }) satisfies EditorDiscovery),
    ])
      .then(([settings, editors]) => {
        const tourNotCompleted = window.localStorage.getItem('mega-brain-onboarding-tour-v1') !== 'done'
        if (active && (!settings.general.onboardingCompleted || tourNotCompleted)) {
          setOnboarding({ settings, editors })
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const openCardDetail = useCallback((id: string, tab?: string) => {
    setOpened({ id, tab })
    if (isTauriDesktop()) return
    const url = new URL(window.location.href)
    url.searchParams.set('card', id)
    if (tab) url.searchParams.set('tab', tab)
    else url.searchParams.delete('tab')
    window.history.pushState({}, '', url)
  }, [])

  const closeCardDetail = useCallback(() => {
    setOpened(null)
    if (isTauriDesktop()) return
    const url = new URL(window.location.href)
    url.searchParams.delete('card')
    url.searchParams.delete('tab')
    window.history.replaceState({}, '', url)
  }, [])

  const runWindowControl = (command: 'minimize_main_window' | 'toggle_maximize_main_window' | 'close_main_window') => {
    setWindowControlError(null)
    void invokeDesktopWindowCommand(command).catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause)
      console.error(`desktop window control failed: ${command}`, cause)
      setWindowControlError(`Não foi possível controlar a janela: ${detail}`)
    })
  }

  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const openCard = opened ? (cardById.get(opened.id) ?? null) : null
  const dragCard = dragId ? (cardById.get(dragId) ?? null) : null
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )
  const { panning, handlers: panHandlers } = usePanScroll<HTMLElement>()

  const cardsByStatus = useMemo(() => {
    const result = new Map<Status, Card[]>()
    for (const card of cards) {
      const bucket = result.get(card.status)
      if (bucket) bucket.push(card)
      else result.set(card.status, [card])
    }
    return result
  }, [cards])

  const onDragStart = ({ active }: DragStartEvent) => setDragId(String(active.id))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null)
    if (over) moveCard(String(active.id), over.id as Status)
  }

  return (
    <TooltipProvider delay={300}>
      <div className="relative flex h-dvh min-h-0 flex-col bg-background text-sm">
        <header
          data-tauri-drag-region
          className="flex min-h-11 shrink-0 items-center gap-2.5 border-b bg-card pl-3 md:pl-4"
          onDoubleClick={(event) => {
            if (isTauriDesktop() && !(event.target as Element).closest('button, input, select, a')) {
              runWindowControl('toggle_maximize_main_window')
            }
          }}
        >
          <h1 data-tauri-drag-region className="flex min-w-0 items-center gap-2.5 font-sans text-base font-semibold">
            <img src="/brain.svg" alt="" aria-hidden="true" className="size-6" />
            <span className="truncate">Mega Brain</span>
          </h1>
          <span data-tauri-drag-region className="min-w-2 flex-1" />
          <CoffeeButton />
          <CommandPalette
            cards={cards}
            onOpenCard={openCardDetail}
            onNewCard={openNewCard}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenRepositories={() => setPage('repositories')}
          />
          {isTauriDesktop() && <DesktopWindowControls onError={setWindowControlError} />}
        </header>

        <div className="flex min-h-0 flex-1">
          <AppSidebar activePage={page} onNavigate={setPage} onOpenSettings={() => setSettingsOpen(true)} />

          {page === 'kanban' ? (
            <section className="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Página Kanban">
              {(error || windowControlError) && (
                <div
                  className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  role="alert"
                >
                  <span className="font-medium">Ação necessária:</span>
                  <span className="min-w-0 flex-1 truncate">{windowControlError ?? error}</span>
                  <Button
                    variant="outline"
                    size="xs"
                    className="border-destructive/30 bg-background text-foreground"
                    onClick={() => {
                      if (windowControlError) setWindowControlError(null)
                      else void refresh()
                    }}
                  >
                    {windowControlError ? 'Dispensar' : 'Tentar novamente'}
                  </Button>
                </div>
              )}

              <main
                ref={boardRef}
                {...panHandlers}
                className={cn(
                  'kanban-canvas kanban-canvas--board grid min-h-0 flex-1 auto-cols-max grid-flow-col items-stretch gap-5 overflow-auto p-3 max-md:block md:p-4',
                  panning ? 'cursor-grabbing select-none' : 'cursor-grab',
                )}
              >
                <DndContext
                  sensors={sensors}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragCancel={() => setDragId(null)}
                >
                  {STATUS_GROUPS.map(({ label, statuses }) => (
                    <section key={label} className="kanban-group flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 px-1 text-[10px] font-medium tracking-widest text-muted-foreground/70 uppercase">
                        {label}
                        <span className="h-px flex-1 bg-border" />
                      </div>
                      <div className="grid flex-1 auto-cols-[minmax(270px,310px)] grid-flow-col gap-3 max-md:mt-2 max-md:grid-flow-row max-md:grid-cols-1">
                        {statuses.map((status) => (
                          <Column
                            key={status}
                            status={status}
                            title={STATUS_LABELS[status]}
                            cards={cardsByStatus.get(status) ?? []}
                            onOpen={openCardDetail}
                            onOpenDeployPrs={status === 'aguardando-deploy' ? () => setDeployPrsOpen(true) : undefined}
                            onNewCard={status === 'a-fazer' ? openNewCard : undefined}
                            jiraSync={status === 'a-fazer'}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                  {createPortal(
                    <DragOverlay>
                      {dragCard && (
                        <div className="w-[290px] cursor-grabbing rounded-md border bg-card p-3 shadow-xl">
                          <CardBody card={dragCard} />
                        </div>
                      )}
                    </DragOverlay>,
                    document.body,
                  )}
                </DndContext>
              </main>
              <BoardMinimap boardRef={boardRef} cardsByStatus={cardsByStatus} />
            </section>
          ) : (
            <Suspense fallback={<div className="min-h-0 flex-1 bg-background" />}>
              {page === 'agents' ? <AgentsPage cards={cards} onOpenCard={openCardDetail} /> : <RepositoriesPage />}
            </Suspense>
          )}
        </div>
        <Suspense fallback={null}>
          {openCard && <CardModal card={openCard} initialTab={opened?.tab} onClose={closeCardDetail} />}
          {deployPrsOpen && <DeployPrsDialog cards={cards} onClose={() => setDeployPrsOpen(false)} />}
          {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
          {onboarding && (
            <OnboardingDialog
              initial={onboarding.settings}
              editors={onboarding.editors}
              onComplete={() => setOnboarding(null)}
            />
          )}
        </Suspense>
        <NewCardDialog open={newCardOpen} onOpenChange={setNewCardOpen} />
      </div>
    </TooltipProvider>
  )
}
