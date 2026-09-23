import { AiBrain01Icon, Folder01Icon, GridViewIcon, Settings02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isAgentSessionActive, useAgentSessions } from './features/agents/model/agents-state'
import { UsageMeter } from './UsageMeter'

export type AppPage = 'kanban' | 'agents' | 'repositories'

interface AppSidebarProps {
  activePage: AppPage
  onNavigate: (page: AppPage) => void
  onOpenSettings: () => void
}

const NAV_ITEMS = [
  { page: 'kanban', label: 'Kanban', icon: GridViewIcon },
  { page: 'agents', label: 'Agentes', icon: AiBrain01Icon },
  { page: 'repositories', label: 'Repositórios', icon: Folder01Icon },
] as const

export function AppSidebar({ activePage, onNavigate, onOpenSettings }: AppSidebarProps) {
  const { sessions, loaded } = useAgentSessions()
  let activeAgentCount = 0
  for (const session of sessions) if (isAgentSessionActive(session)) activeAgentCount += 1

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card/60 p-3" aria-label="Navegação principal">
      <nav>
        <p className="mb-2 px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">Navegação</p>
        <div className="space-y-1">
          {NAV_ITEMS.map(({ page, label, icon }) => (
            <button
              key={page}
              type="button"
              className={cn(
                'flex h-10 w-full items-center gap-2.5 rounded-lg px-3 font-sans text-sm font-medium transition-colors',
                activePage === page
                  ? 'bg-secondary text-secondary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              aria-current={activePage === page ? 'page' : undefined}
              onClick={() => onNavigate(page)}
            >
              <HugeiconsIcon icon={icon} strokeWidth={2} className="size-5" />
              {label}
              {page === 'agents' && loaded ? (
                <span
                  className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-semibold text-current tabular-nums"
                  aria-label={`${activeAgentCount} ${activeAgentCount === 1 ? 'agente em execução' : 'agentes em execução'}`}
                >
                  {activeAgentCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      <div className="mt-auto space-y-3 border-t pt-3">
        <section className="rounded-lg border bg-background/70 p-3" aria-label="Consumo do Claude">
          <UsageMeter layout="stacked" />
        </section>

        <Button variant="ghost" className="w-full justify-start gap-2.5" onClick={onOpenSettings}>
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          Configurações
        </Button>
      </div>
    </aside>
  )
}
