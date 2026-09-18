import { useMemo } from 'react'
import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { openPrs } from './cards'
import { isTauriDesktop } from './desktopBootstrap'
import { groupOpenMasterPrs } from './deployPrs'
import type { Card } from './types'

export function DeployPrsDialog({ cards, onClose }: { cards: Card[]; onClose: () => void }) {
  const groups = useMemo(() => groupOpenMasterPrs(cards), [cards])
  const total = groups.reduce((sum, group) => sum + group.prs.length, 0)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(80dvh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="gap-1.5 border-b px-5 py-4 pr-12">
          <DialogTitle className="font-sans text-lg">PRs de master abertos</DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${total} ${total === 1 ? 'PR' : 'PRs'} em ${groups.length} ${groups.length === 1 ? 'projeto' : 'projetos'}, agrupados por projeto.`
              : 'Nenhum PR de master aberto nos cards que aguardam deploy.'}
          </DialogDescription>
        </DialogHeader>

        {groups.length > 0 ? (
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <section key={group.project} className="overflow-hidden rounded-lg border bg-card">
                  <h3 className="border-b bg-muted/50 px-3 py-2 font-sans text-sm font-semibold">
                    {group.project}
                  </h3>
                  <ul className="divide-y">
                    {group.prs.map((pr) => (
                      <li key={`${pr.cardId}:${pr.url}`} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-sans text-sm font-medium">{pr.cardTitle}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{pr.cardId}</p>
                        </div>
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none dark:text-chart-2"
                          onClick={(event) => {
                            if (!isTauriDesktop()) return
                            event.preventDefault()
                            void openPrs(pr.cardId, 'master', group.project)
                          }}
                        >
                          Abrir PR
                          <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3.5" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid min-h-36 place-items-center px-5 py-8 text-center text-sm text-muted-foreground">
            Os PRs abertos aparecerão aqui quando estiverem disponíveis.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
