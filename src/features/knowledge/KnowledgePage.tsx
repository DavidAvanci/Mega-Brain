import { useCallback, useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Cancel01Icon,
  Clock01Icon,
  Delete02Icon,
  Download01Icon,
  Upload01Icon,
  File01Icon,
  Folder01Icon,
  FolderAddIcon,
  MoreHorizontalIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/Tip'
import { Markdown } from '@/Markdown'
import type {
  KnowledgeCatalog,
  KnowledgeFolder,
  KnowledgePage as Page,
  KnowledgeRef,
} from '../../../shared/domain/knowledge'
import { knowledgeApi } from './api'
import { KnowledgeEditor } from './KnowledgeEditor'
import { useKnowledgeDraft } from './useKnowledgeDraft'

function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string
  icon: typeof Add01Icon
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tip label={label}>
      <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled}>
        <HugeiconsIcon icon={icon} size={16} />
      </Button>
    </Tip>
  )
}
function ancestors(parentId: string | null, folders: KnowledgeFolder[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  let id = parentId
  while (id && !seen.has(id)) {
    seen.add(id)
    const folder = folders.find((folder) => folder.id === id)
    if (!folder) break
    result.unshift(folder.title)
    id = folder.parentId
  }
  return result
}
function PageEditor({
  id,
  folders,
  onSaved,
  onAction,
}: {
  id: string
  folders: KnowledgeFolder[]
  onSaved: () => void
  onAction: () => void
}) {
  const { page, draft, status, error, conflict, update, retry, useRemote, saveMerged } = useKnowledgeDraft(id, onSaved)
  const importInput = useRef<HTMLInputElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState<Page | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const openHistory = async () => {
    setHistoryOpen(true)
    setHistoryError(null)
    try {
      setHistoryPage(await knowledgeApi.read(id))
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : 'Falha ao carregar histórico')
    }
  }
  const restore = async (revision: number) => {
    if (!historyPage || !draft) return
    try {
      // Preserve the current local draft before any history operation.
      if (draft.title !== page?.title || draft.markdown !== page?.markdown) {
        setHistoryError('Salve ou resolva o rascunho antes de restaurar uma revisão.')
        return
      }
      await knowledgeApi.restoreRevision(id, revision, historyPage.revision)
      setHistoryOpen(false)
      setStatusHint('Revisão restaurada. A página será atualizada.')
      onSaved()
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : 'Falha ao restaurar')
    }
  }
  const [statusHint, setStatusHint] = useState('')
  if (!draft)
    return (
      <div role="status" className="p-8 text-muted-foreground">
        {error ?? 'Carregando página…'}
        {error && (
          <Button className="ml-3" variant="outline" onClick={() => window.location.reload()}>
            Tentar novamente
          </Button>
        )}
      </div>
    )
  const previous = historyPage?.history.find((item) => item.revision === preview)
  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {[...ancestors(page?.parentId ?? null, folders), draft.title || 'Sem título'].join(' / ')}
        </p>
        <span role="status" className="text-[11px] text-muted-foreground">
          {statusHint || status}
        </span>
        <input
          ref={importInput}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          className="hidden"
          aria-label="Arquivo Markdown"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (file.size > 1_000_000) {
              setStatusHint('O arquivo deve ter até 1 MB.')
              return
            }
            void file
              .text()
              .then((markdown) => {
                update({ markdown })
                setStatusHint('')
              })
              .catch(() => setStatusHint('Não foi possível importar o arquivo.'))
          }}
        />
        <IconButton label="Importar Markdown" icon={Upload01Icon} onClick={() => importInput.current?.click()} />
        <IconButton
          label="Exportar Markdown"
          icon={Download01Icon}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([draft.markdown], { type: 'text/markdown;charset=utf-8' }))
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = `${draft.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'pagina'}.md`
            anchor.click()
            URL.revokeObjectURL(url)
          }}
        />
        <IconButton
          label="Histórico de revisões"
          icon={Clock01Icon}
          onClick={() => {
            void openHistory()
          }}
        />
        <IconButton label="Ações da página" icon={MoreHorizontalIcon} onClick={onAction} />
      </header>
      {error && (
        <div role="alert" className="flex items-center gap-3 border-b px-5 py-2 text-xs text-destructive">
          <span className="flex-1">{error}</span>
          {!conflict && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                void retry()
              }}
            >
              Tentar novamente
            </Button>
          )}
        </div>
      )}
      {conflict && (
        <section className="border-b bg-muted/40 p-4" aria-label="Conflito de versões">
          <p className="mb-3 text-sm">
            A página foi alterada por {conflict.actor.name}. Seu rascunho foi preservado. Edite-o abaixo para conciliar
            as versões.
          </p>
          <div className="mb-3 grid max-h-52 grid-cols-2 gap-4 overflow-auto text-xs">
            <div>
              <strong>Seu rascunho</strong>
              <Markdown text={draft.markdown} />
            </div>
            <div>
              <strong>Versão atual · {conflict.title}</strong>
              <Markdown text={conflict.markdown} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="xs" variant="outline" onClick={useRemote}>
              Usar versão atual
            </Button>
            <Button
              size="xs"
              onClick={() => {
                void saveMerged()
              }}
            >
              Salvar rascunho conciliado
            </Button>
          </div>
        </section>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-8 py-12">
          <input
            aria-label="Título da página"
            value={draft.title}
            maxLength={240}
            placeholder="Sem título"
            onChange={(event) => update({ title: event.target.value })}
            className="mb-6 w-full border-0 bg-transparent font-sans text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
          <KnowledgeEditor markdown={draft.markdown} onChange={(markdown) => update({ markdown })} />
        </div>
      </div>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Histórico da página</DialogTitle>
          </DialogHeader>
          {historyError && (
            <p role="alert" className="text-sm text-destructive">
              {historyError}
            </p>
          )}
          <div className="grid max-h-[65vh] grid-cols-[190px_1fr] gap-5 overflow-auto">
            <div>
              {historyPage?.history
                .slice()
                .reverse()
                .map((revision) => (
                  <button
                    type="button"
                    key={revision.revision}
                    onClick={() => setPreview(revision.revision)}
                    className="mb-1 w-full rounded-lg p-2 text-left text-xs hover:bg-accent"
                  >
                    <strong>Revisão {revision.revision}</strong>
                    <p>{revision.actor.name}</p>
                    <p className="text-muted-foreground">{new Date(revision.updatedAt).toLocaleString('pt-BR')}</p>
                  </button>
                ))}
              {historyPage && !historyPage.history.length && (
                <p className="text-xs text-muted-foreground">Nenhuma revisão anterior.</p>
              )}
            </div>
            <div>
              {previous ? (
                <>
                  <h3 className="mb-3 font-semibold">{previous.title}</h3>
                  <div className="grid grid-cols-2 gap-5">
                    <section aria-label="Revisão anterior">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">Revisão anterior</p>
                      <Markdown text={previous.markdown} />
                    </section>
                    <section aria-label="Versão atual">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">Versão atual</p>
                      <Markdown text={draft.markdown} />
                    </section>
                  </div>
                  <Button
                    className="mt-4"
                    size="sm"
                    onClick={() => {
                      void restore(previous.revision)
                    }}
                  >
                    Restaurar esta revisão
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Selecione uma revisão para comparar com a página atual.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  )
}
type Action = { kind: 'create-page' | 'create-folder' | 'item'; ref?: KnowledgeRef }
export function KnowledgePage() {
  const [catalog, setCatalog] = useState<KnowledgeCatalog>({ version: 1, folders: [], pages: [] })
  const [selected, setSelected] = useState<KnowledgeRef | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Awaited<ReturnType<typeof knowledgeApi.search>>>([])
  const [trash, setTrash] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState<string>('')
  const [pending, setPending] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const reload = useCallback(async () => {
    try {
      const result = await knowledgeApi.list(trash)
      setCatalog(result)
      setLoaded(true)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar conhecimento')
    }
  }, [trash])
  useEffect(() => {
    void reload()
    const timer = window.setInterval(reload, 5_000)
    return () => window.clearInterval(timer)
  }, [reload])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      if (query.trim())
        void knowledgeApi
          .search(query)
          .then((result) => {
            if (active) setSearchResults(result)
          })
          .catch((cause) => {
            if (active) setError(cause instanceof Error ? cause.message : 'Falha ao pesquisar')
          })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, catalog])
  const openAction = (next: Action) => {
    const item = next.ref ? [...catalog.folders, ...catalog.pages].find((item) => item.id === next.ref!.id) : null
    setTitle(item?.title ?? '')
    setDestination(item?.parentId ?? (selected?.kind === 'folder' ? selected.id : ''))
    setAction(next)
  }
  const run = async (operation: () => Promise<unknown>, close = true) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await operation()
      if (close) setAction(null)
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha na ação')
    } finally {
      setPending(false)
    }
  }
  const create = () =>
    run(async () => {
      const item = await knowledgeApi.create(
        action?.kind === 'create-folder' ? 'folder' : 'page',
        title,
        destination || null,
      )
      setSelected({ kind: action?.kind === 'create-folder' ? 'folder' : 'page', id: item.id })
      if (destination) setExpanded((previous) => new Set([...previous, destination]))
    })
  const rows = (parentId: string | null, depth = 0): React.ReactNode => {
    const items = [
      ...catalog.folders
        .filter((item) => item.parentId === parentId)
        .map((item) => ({ ...item, kind: 'folder' as const })),
      ...catalog.pages.filter((item) => item.parentId === parentId).map((item) => ({ ...item, kind: 'page' as const })),
    ].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
    return items.map((item) => (
      <div key={item.id}>
        <div
          className={`group flex items-center rounded-md ${selected?.id === item.id ? 'bg-secondary' : 'hover:bg-accent'}`}
          style={{ paddingLeft: depth * 12 }}
        >
          {item.kind === 'folder' && (
            <button
              type="button"
              aria-label={`${expanded.has(item.id) ? 'Recolher' : 'Expandir'} ${item.title}`}
              aria-expanded={expanded.has(item.id)}
              className="p-1"
              onClick={() =>
                setExpanded((previous) => {
                  const next = new Set(previous)
                  if (next.has(item.id)) next.delete(item.id)
                  else next.add(item.id)
                  return next
                })
              }
            >
              <HugeiconsIcon icon={expanded.has(item.id) ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
            </button>
          )}
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs"
            onClick={() => setSelected({ kind: item.kind, id: item.id })}
            aria-current={selected?.id === item.id ? 'page' : undefined}
          >
            <HugeiconsIcon
              icon={item.kind === 'folder' ? Folder01Icon : File01Icon}
              size={15}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate">{item.title}</span>
          </button>
          <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton
              label={`Ações de ${item.title}`}
              icon={MoreHorizontalIcon}
              onClick={() => openAction({ kind: 'item', ref: { kind: item.kind, id: item.id } })}
            />
          </span>
        </div>
        {item.kind === 'folder' && expanded.has(item.id) && rows(item.id, depth + 1)}
      </div>
    ))
  }
  const selectedFolder = catalog.folders.find((folder) => selected?.kind === 'folder' && folder.id === selected.id)
  return (
    <main className="flex min-h-0 min-w-0 flex-1" aria-label="Conhecimento">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card/30 p-3 max-lg:w-48" aria-label="Pastas e páginas">
        <div className="mb-3 flex items-center gap-1">
          <h2 className="flex-1 px-1 text-sm font-semibold">Conhecimento</h2>
          <IconButton label="Pesquisar conhecimento" icon={Search01Icon} onClick={() => searchInput.current?.focus()} />
          <IconButton
            label="Criar pasta"
            icon={FolderAddIcon}
            onClick={() => openAction({ kind: 'create-folder' })}
            disabled={trash}
          />
          <IconButton
            label="Criar página"
            icon={Add01Icon}
            onClick={() => openAction({ kind: 'create-page' })}
            disabled={trash}
          />
        </div>
        <Input
          ref={searchInput}
          aria-label="Pesquisar páginas e pastas"
          placeholder="Pesquisar…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            if (trash) setTrash(false)
          }}
          className="mb-3 h-8 text-xs"
        />
        <nav className="min-h-0 flex-1 overflow-auto" aria-label={trash ? 'Lixeira' : 'Árvore do conhecimento'}>
          {query.trim()
            ? searchResults.map((item) => (
                <button
                  type="button"
                  key={`${item.kind}:${item.id}`}
                  onClick={() => {
                    setSelected({ kind: item.kind, id: item.id })
                    setQuery('')
                  }}
                  className="mb-1 w-full rounded p-2 text-left hover:bg-accent"
                >
                  <p className="truncate text-xs font-medium">{item.title}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{item.breadcrumbs.join(' / ')}</p>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">{item.snippet}</p>
                </button>
              ))
            : trash
              ? [...catalog.folders, ...catalog.pages].map((item) => (
                  <div key={item.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1 truncate text-xs">{item.title}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        void run(() =>
                          knowledgeApi.restore({ kind: 'markdown' in item ? 'page' : 'folder', id: item.id }),
                        )
                      }}
                    >
                      Restaurar
                    </Button>
                  </div>
                ))
              : rows(null)}
          {!loaded && (
            <p role="status" className="p-2 text-xs text-muted-foreground">
              Carregando…
            </p>
          )}
          {loaded && !(catalog.pages.length || catalog.folders.length) && (
            <p className="p-2 text-xs text-muted-foreground">
              {trash ? 'A lixeira está vazia.' : 'Suas notas começam aqui.'}
            </p>
          )}
          {query.trim() && !searchResults.length && (
            <p className="p-2 text-xs text-muted-foreground">Nenhum resultado.</p>
          )}
        </nav>
        <button
          type="button"
          className={`mt-3 flex items-center gap-2 rounded-md px-2 py-2 text-xs ${trash ? 'bg-secondary' : 'text-muted-foreground hover:bg-accent'}`}
          onClick={() => {
            setTrash(!trash)
            setSelected(null)
            setQuery('')
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} size={15} />
          {trash ? 'Voltar às páginas' : 'Lixeira'}
        </button>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error && (
          <div role="alert" className="border-b px-5 py-2 text-xs text-destructive">
            {error}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                void reload()
              }}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        {!trash && selected?.kind === 'page' ? (
          <PageEditor
            key={selected.id}
            id={selected.id}
            folders={catalog.folders}
            onSaved={() => {
              void reload()
            }}
            onAction={() => openAction({ kind: 'item', ref: selected })}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
            <HugeiconsIcon
              icon={selectedFolder ? Folder01Icon : BookOpen01Icon}
              size={32}
              className="text-muted-foreground/50"
            />
            <h2 className="text-xl font-semibold">
              {trash ? 'Lixeira' : (selectedFolder?.title ?? 'Seu conhecimento, organizado')}
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {trash
                ? 'Restaure páginas e pastas pelo painel ao lado.'
                : 'Guarde decisões, ideias e referências. Anexe páginas às tarefas para compartilhar contexto com os agentes.'}
            </p>
            {!trash && (
              <Button variant="outline" onClick={() => openAction({ kind: 'create-page' })}>
                <HugeiconsIcon icon={Add01Icon} size={16} />
                Criar página
              </Button>
            )}
          </div>
        )}
      </div>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.kind === 'item'
                ? 'Organizar conhecimento'
                : action?.kind === 'create-folder'
                  ? 'Criar pasta'
                  : 'Criar página'}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (action?.kind !== 'item') void create()
              else if (action.ref)
                void run(async () => {
                  if (action.ref!.kind === 'folder') await knowledgeApi.renameFolder(action.ref!.id, title)
                  else {
                    const page = await knowledgeApi.read(action.ref!.id)
                    await knowledgeApi.save(page.id, title, page.markdown, page.revision)
                  }
                })
            }}
          >
            <label className="block space-y-1 text-xs">
              <span>Título</span>
              <Input autoFocus value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="block space-y-1 text-xs">
              <span>Pasta</span>
              <select
                aria-label="Pasta de destino"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2"
              >
                <option value="">Raiz do conhecimento</option>
                {catalog.folders
                  .filter((folder) => folder.id !== action?.ref?.id)
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {[...ancestors(folder.parentId, catalog.folders), folder.title].join(' / ')}
                    </option>
                  ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              {action?.kind === 'item' && action.ref && (
                <>
                  <IconButton
                    label="Mover para a lixeira"
                    icon={Delete02Icon}
                    disabled={pending}
                    onClick={() => {
                      void run(async () => {
                        await knowledgeApi.trash(action.ref!)
                        if (selected?.id === action.ref!.id) setSelected(null)
                      })
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      void run(() => knowledgeApi.move(action.ref!, destination || null))
                    }}
                  >
                    Mover
                  </Button>
                </>
              )}
              <Button disabled={pending} size="sm" type="submit">
                {action?.kind === 'item' ? 'Renomear' : 'Criar'}
              </Button>
              <IconButton label="Cancelar" icon={Cancel01Icon} onClick={() => setAction(null)} />
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  )
}
