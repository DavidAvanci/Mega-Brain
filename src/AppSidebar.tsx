import { BookOpen01Icon, AiBrain01Icon, Folder01Icon, GridViewIcon, Settings02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isAgentSessionActive, useAgentSessions } from './features/agents/model/agents-state'
import { UsageMeter } from './UsageMeter'

export type AppPage = 'kanban' | 'agents' | 'repositories' | 'knowledge'

interface AppSidebarProps {
  activePage: AppPage
  onNavigate: (page: AppPage) => void
  onOpenSettings: () => void
  compactOnMobile?: boolean
}

const NAV_ITEMS = [
  { page: 'kanban', label: 'Kanban', icon: GridViewIcon },
  { page: 'agents', label: 'Agentes', icon: AiBrain01Icon },
  { page: 'knowledge', label: 'Conhecimento', icon: BookOpen01Icon },
  { page: 'repositories', label: 'Repositórios', icon: Folder01Icon },
] as const

export function AppSidebar({ activePage, onNavigate, onOpenSettings, compactOnMobile = false }: AppSidebarProps) {
  const { sessions, loaded } = useAgentSessions()
  let activeAgentCount = 0
  for (const session of sessions) if (isAgentSessionActive(session)) activeAgentCount += 1

  return (
    <aside
      className={cn(
        'flex min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r bg-card/60 p-3',
        compactOnMobile && 'max-md:w-16 max-md:px-2',
      )}
      aria-label="Navegação principal"
    >
      <nav>
        <p className={cn(
          'mb-2 px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase',
          compactOnMobile && 'max-md:hidden',
        )}>Navegação</p>
        <div className="space-y-1">
          {NAV_ITEMS.map(({ page, label, icon }) => (
            <button
              key={page}
              type="button"
              className={cn(
                'flex h-10 w-full items-center gap-2.5 rounded-lg px-3 font-sans text-sm font-medium transition-colors',
                compactOnMobile && 'max-md:justify-center max-md:px-0',
                activePage === page
                  ? 'bg-secondary text-secondary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              aria-current={activePage === page ? 'page' : undefined}
              aria-label={label}
              title={compactOnMobile ? label : undefined}
              onClick={() => onNavigate(page)}
            >
              <HugeiconsIcon icon={icon} strokeWidth={2} className="size-5" />
              <span className={compactOnMobile ? 'max-md:sr-only' : undefined}>{label}</span>
              {page === 'agents' && loaded ? (
                <span
                  className={cn(
                    'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-semibold text-current tabular-nums',
                    compactOnMobile && 'max-md:hidden',
                  )}
                  aria-label={`${activeAgentCount} ${activeAgentCount === 1 ? 'agente em execução' : 'agentes em execução'}`}
                >
                  {activeAgentCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      <div className="mt-auto shrink-0 space-y-3 border-t pt-3">
        <section className={cn('rounded-lg border bg-background/70 p-3', compactOnMobile && 'max-md:hidden')} aria-label="Consumo dos agentes">
          <p className="mb-2 text-xs font-medium">Codex</p>
          <UsageMeter layout="stacked" provider="codex" />
          <p className="mt-3 mb-2 text-xs font-medium">Claude</p>
          <UsageMeter layout="stacked" provider="claude" />
        </section>

        <Button
          variant="ghost"
          className={cn('w-full justify-start gap-2.5', compactOnMobile && 'max-md:h-10 max-md:justify-center max-md:px-0')}
          onClick={onOpenSettings}
          aria-label="Configurações"
          title={compactOnMobile ? 'Configurações' : undefined}
        >
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          <span className={compactOnMobile ? 'max-md:sr-only' : undefined}>Configurações</span>
        </Button>
      </div>
    </aside>
  )
}
