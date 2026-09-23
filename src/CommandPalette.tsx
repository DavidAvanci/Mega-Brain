import { useEffect, useMemo, useState } from 'react'
import { CommandIcon, Folder01Icon, GridViewIcon, PlusSignIcon, Search01Icon, Settings02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Card } from '../shared/domain/cards'

interface CommandPaletteProps {
  cards: Card[]
  onOpenCard: (id: string) => void
  onNewCard: () => void
  onOpenSettings: () => void
  onOpenRepositories: () => void
}

interface CommandAction {
  label: string
  keywords: string
  icon: IconSvgElement
  run: () => void
}

export function CommandPalette({ cards, onOpenCard, onNewCard, onOpenSettings, onOpenRepositories }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const openPalette = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', openPalette)
    return () => window.removeEventListener('keydown', openPalette)
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const actions: CommandAction[] = [
    { label: 'Novo card', keywords: 'adicionar criar tarefa', icon: PlusSignIcon, run: onNewCard },
    { label: 'Configurações', keywords: 'preferências ajustes', icon: Settings02Icon, run: onOpenSettings },
    { label: 'Repositórios', keywords: 'repos git checkout', icon: Folder01Icon, run: onOpenRepositories },
  ]
  const visibleActions = normalizedQuery
    ? actions.filter((action) => `${action.label} ${action.keywords}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery))
    : actions
  const visibleCards = useMemo(() => {
    if (!normalizedQuery) return []
    return cards
      .filter((card) =>
        [card.id, card.title, card.description]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedQuery),
      )
      .slice(0, 8)
  }, [cards, normalizedQuery])

  const closeAndRun = (action: () => void) => {
    setOpen(false)
    setQuery('')
    action()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-muted-foreground"
        aria-label="Abrir command palette"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={CommandIcon} strokeWidth={2} />
        <span className="hidden xl:inline">Comandos</span>
        <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-[10px] leading-none font-normal lg:inline">
          Ctrl K
        </kbd>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setQuery('')
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <div className="relative border-b">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar cards ou comandos…"
              className="h-12 rounded-none border-0 bg-transparent pr-4 pl-12 font-sans shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="max-h-[min(24rem,60dvh)] overflow-y-auto p-2">
            {visibleActions.length > 0 && (
              <section aria-labelledby="palette-actions">
                <h2 id="palette-actions" className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Ações
                </h2>
                {visibleActions.map((action) => (
                  <PaletteItem key={action.label} icon={action.icon} onClick={() => closeAndRun(action.run)}>
                    {action.label}
                  </PaletteItem>
                ))}
              </section>
            )}

            {visibleCards.length > 0 && (
              <section className={cn(visibleActions.length > 0 && 'mt-2 border-t pt-2')} aria-labelledby="palette-cards">
                <h2 id="palette-cards" className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Cards
                </h2>
                {visibleCards.map((card) => (
                  <PaletteItem
                    key={card.id}
                    icon={GridViewIcon}
                    detail={card.id}
                    onClick={() => closeAndRun(() => onOpenCard(card.id))}
                  >
                    {card.title}
                  </PaletteItem>
                ))}
              </section>
            )}

            {normalizedQuery && visibleActions.length === 0 && visibleCards.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PaletteItem({
  icon,
  detail,
  children,
  onClick,
}: {
  icon: IconSvgElement
  detail?: string
  children: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-sans text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail && <span className="shrink-0 font-mono text-xs text-muted-foreground">{detail}</span>}
    </button>
  )
}
