import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffFile, DiffModeEnum, DiffView, highlighter } from '@git-diff-view/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowRight01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { fetchDiff } from '../api/card-detail-api'
import { fileLang, parseDiff, type FileDiff, type FileStatus } from '@/diff'
import { useTheme, type Theme } from '@/theme'
import '@git-diff-view/react/styles/diff-view.css'

const STATUS_BADGE: Partial<Record<FileStatus, { label: string; className: string }>> = {
  added: { label: 'novo', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  deleted: { label: 'removido', className: 'bg-destructive/10 text-destructive' },
  renamed: { label: 'renomeado', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
}

const HEADER_HEIGHT = 32
const REPO_HEADER_HEIGHT = 24
const LINE_HEIGHT = 19
const AUTO_COLLAPSE_LINES = 500
const LOCK_FILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock)$/

type ParsedRepo = { name: string; files: FileDiff[]; error?: string }

type Row =
  | { type: 'repo'; key: string; name: string; error?: string }
  | { type: 'file'; key: string; repo: string; file: FileDiff; lines: number }

const rowKey = (repo: string, file: FileDiff) => `${repo}:${file.oldName}→${file.newName}`

const autoCollapse = (file: FileDiff) =>
  file.raw.split('\n').length > AUTO_COLLAPSE_LINES || LOCK_FILE.test(file.newName || file.oldName)

const shouldHighlight = (file: FileDiff) => file.maxLine <= highlighter.maxLineToIgnoreSyntax

// Preserva parse+highlight entre desmontagens da virtualização
const diffFiles = new WeakMap<FileDiff, DiffFile>()

// Sobrevive ao fechar/reabrir o modal; seen limita o auto-colapso a arquivos novos
const collapseState = new Map<
  string,
  { collapsed: ReadonlySet<string>; collapsedRepos: ReadonlySet<string>; seen: Set<string> }
>()

function getDiffFile(file: FileDiff, theme: Theme): DiffFile {
  const cached = diffFiles.get(file)
  if (cached) return cached
  const lang = fileLang(file)
  const diffFile = DiffFile.createInstance({
    oldFile: { fileName: file.oldName || null, fileLang: lang },
    newFile: { fileName: file.newName || null, fileLang: lang },
    hunks: [file.raw],
  })
  diffFile.initTheme(theme)
  diffFile.initRaw()
  if (shouldHighlight(file)) diffFile.initSyntax()
  diffFile.buildSplitDiffLines()
  diffFile.buildUnifiedDiffLines()
  diffFiles.set(file, diffFile)
  return diffFile
}

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="flex shrink-0 gap-1.5 font-medium tabular-nums">
      {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
      {deletions > 0 && <span className="text-red-600 dark:text-red-400">−{deletions}</span>}
    </span>
  )
}

function FileNote({ children }: { children: string }) {
  return <p className="px-3 py-4 text-center text-xs text-muted-foreground">{children}</p>
}

function FileHeader({
  rowKey,
  file,
  open,
  onToggle,
  floating = false,
}: {
  rowKey: string
  file: FileDiff
  open: boolean
  onToggle: (key: string) => void
  floating?: boolean
}) {
  const badge = STATUS_BADGE[file.status]
  const name = file.status === 'renamed' ? `${file.oldName} → ${file.newName}` : file.newName || file.oldName
  return (
    <button
      type="button"
      onClick={() => onToggle(rowKey)}
      className={cn(
        'flex w-full items-center gap-2 bg-background px-3 py-1.5 text-left text-xs hover:bg-muted',
        floating && 'rounded-md border shadow-sm',
        !floating && open && 'border-b',
      )}
    >
      <HugeiconsIcon
        icon={open ? ArrowDown01Icon : ArrowRight01Icon}
        strokeWidth={2}
        className="size-3.5 shrink-0 opacity-60"
      />
      <span className="min-w-0 truncate font-mono font-medium">{name}</span>
      {badge && (
        <span className={cn('shrink-0 rounded-sm px-1 py-px text-[10px]', badge.className)}>{badge.label}</span>
      )}
      <span className="ml-auto" />
      <Counts additions={file.additions} deletions={file.deletions} />
    </button>
  )
}

const FileCard = memo(function FileCard({
  rowKey,
  file,
  mode,
  open,
  onToggle,
}: {
  rowKey: string
  file: FileDiff
  mode: DiffModeEnum
  open: boolean
  onToggle: (key: string) => void
}) {
  const theme = useTheme()
  return (
    <div className="overflow-clip rounded-md border">
      <FileHeader rowKey={rowKey} file={file} open={open} onToggle={onToggle} />
      {open &&
        (file.binary ? (
          <FileNote>Arquivo binário, sem preview.</FileNote>
        ) : !file.hasHunks ? (
          <FileNote>Sem alterações de conteúdo.</FileNote>
        ) : (
          <DiffView
            diffFile={getDiffFile(file, theme)}
            diffViewMode={mode}
            diffViewTheme={theme}
            diffViewHighlight={shouldHighlight(file)}
            diffViewFontSize={12}
          />
        ))}
    </div>
  )
})

export function DiffTab({ cardId }: { cardId: string }) {
  const [repos, setRepos] = useState<ParsedRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [split, setSplit] = useState(true)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [collapsedRepos, setCollapsedRepos] = useState<ReadonlySet<string>>(new Set())
  const [tick, setTick] = useState(0)
  const scroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchDiff(cardId)
      .then((data) => {
        if (cancelled) return
        const parsed = data.map((repo) => ({ name: repo.name, error: repo.error, files: parseDiff(repo.diff) }))
        const state = collapseState.get(cardId) ?? {
          collapsed: new Set<string>(),
          collapsedRepos: new Set<string>(),
          seen: new Set<string>(),
        }
        const nextCollapsed = new Set(state.collapsed)
        for (const repo of parsed)
          for (const file of repo.files) {
            const key = rowKey(repo.name, file)
            if (!state.seen.has(key)) {
              state.seen.add(key)
              if (autoCollapse(file)) nextCollapsed.add(key)
            }
          }
        state.collapsed = nextCollapsed
        collapseState.set(cardId, state)
        setRepos(parsed)
        setCollapsed(nextCollapsed)
        setCollapsedRepos(state.collapsedRepos)
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [cardId, tick])

  const rows = useMemo<Row[]>(() => {
    const list = repos ?? []
    return list.flatMap((repo) => [
      { type: 'repo' as const, key: repo.name, name: repo.name, error: repo.error },
      ...(collapsedRepos.has(repo.name)
        ? []
        : repo.files.map((file) => ({
            type: 'file' as const,
            key: rowKey(repo.name, file),
            repo: repo.name,
            file,
            lines: file.raw.split('\n').length,
          }))),
    ])
  }, [collapsedRepos, repos])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => {
      const row = rows[index]
      if (row.type === 'repo') return REPO_HEADER_HEIGHT
      return collapsed.has(row.key) ? HEADER_HEIGHT : HEADER_HEIGHT + row.lines * LINE_HEIGHT
    },
    overscan: 3,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const [scrollTop, setScrollTop] = useState(0)
  const firstVisible = useMemo(
    () => virtualItems.find((item) => item.start + item.size > scrollTop)?.index ?? 0,
    [scrollTop, virtualItems],
  )
  const activeRepo = useMemo(() => {
    for (let index = firstVisible; index >= 0; index--) {
      const row = rows[index]
      if (row?.type === 'repo') return row.name
    }
    return rows[firstVisible]?.type === 'file' ? rows[firstVisible].repo : repos?.[0]?.name
  }, [firstVisible, repos, rows])
  const activeRepoIndex = useMemo(() => {
    for (let index = firstVisible; index >= 0; index--) if (rows[index]?.type === 'repo') return index
    return 0
  }, [firstVisible, rows])
  const activeRepoOffset = virtualizer.getOffsetForIndex(activeRepoIndex, 'start')?.[0] ?? 0
  const showStickyHeaders = Boolean(activeRepo) && scrollTop > activeRepoOffset + REPO_HEADER_HEIGHT
  const activeFile = useMemo(() => {
    if (!activeRepo || collapsedRepos.has(activeRepo)) return undefined
    for (let index = firstVisible; index < rows.length; index++) {
      const row = rows[index]
      if (row?.type === 'file' && row.repo === activeRepo) return row
    }
    return undefined
  }, [activeRepo, collapsedRepos, firstVisible, rows])

  const toggle = useCallback(
    (key: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev)
        next.has(key) ? next.delete(key) : next.add(key)
        const state = collapseState.get(cardId)
        if (state) state.collapsed = next
        return next
      }),
    [cardId],
  )
  const toggleRepo = useCallback(
    (repo: string) => {
      setCollapsedRepos((prev) => {
        const next = new Set(prev)
        next.has(repo) ? next.delete(repo) : next.add(repo)
        const state = collapseState.get(cardId)
        if (state) state.collapsedRepos = next
        return next
      })
    },
    [cardId],
  )

  const files = (repos ?? []).flatMap((repo) => repo.files)
  const empty =
    error ??
    (repos === null
      ? null
      : !repos.length
        ? 'Sem repositórios vinculados à task.'
        : !files.length && repos.every((repo) => !repo.error)
          ? 'Sem alterações nos repositórios.'
          : null)

  const controls = repos !== null && !empty && (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        {files.length} {files.length === 1 ? 'arquivo alterado' : 'arquivos alterados'}
      </span>
      <Counts
        additions={files.reduce((sum, file) => sum + file.additions, 0)}
        deletions={files.reduce((sum, file) => sum + file.deletions, 0)}
      />
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="icon-xs" onClick={() => setTick(tick + 1)} aria-label="Atualizar diff">
          <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
        </Button>
        <div className="flex rounded-md border p-0.5">
          <Button variant={split ? 'ghost' : 'secondary'} size="xs" onClick={() => setSplit(false)}>
            Unificado
          </Button>
          <Button variant={split ? 'secondary' : 'ghost'} size="xs" onClick={() => setSplit(true)}>
            Dividido
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {controls && <div className="shrink-0 border-b px-5 py-3">{controls}</div>}
      <div
        ref={scroll}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        {empty ? (
          <p className={cn('py-10 text-center text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
            {empty}
          </p>
        ) : repos === null ? (
          <div className="flex flex-col gap-2.5 py-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {showStickyHeaders && (
              <div className="sticky -top-4 z-100 h-0 -mx-5 overflow-visible" style={{ zIndex: 100 }}>
                <button
                  type="button"
                  onClick={() => activeRepo && toggleRepo(activeRepo)}
                  aria-expanded={activeRepo ? !collapsedRepos.has(activeRepo) : undefined}
                  className="flex w-full items-center gap-1.5 border-y bg-background px-5 py-2 text-left text-[10px] font-medium tracking-wider text-muted-foreground uppercase shadow-sm hover:bg-muted"
                >
                  <HugeiconsIcon
                    icon={activeRepo && !collapsedRepos.has(activeRepo) ? ArrowDown01Icon : ArrowRight01Icon}
                    strokeWidth={2}
                    className="size-3"
                  />
                  Projeto: {activeRepo ?? '—'}
                </button>
                {activeFile && (
                  <div className="px-5 pt-0 shadow-sm">
                    <FileHeader
                      rowKey={activeFile.key}
                      file={activeFile.file}
                      open={!collapsed.has(activeFile.key)}
                      onToggle={toggle}
                      floating
                    />
                  </div>
                )}
              </div>
            )}
            <div className="relative isolate z-0" style={{ height: virtualizer.getTotalSize(), zIndex: 0 }}>
              {virtualItems.map((item) => {
                const row = rows[item.index]
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    // top em vez de transform: transform quebraria o sticky dos headers
                    className="absolute left-0 w-full pb-2"
                    style={{ top: item.start }}
                  >
                    {row.type === 'repo' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleRepo(row.name)}
                          aria-expanded={!collapsedRepos.has(row.name)}
                          className="flex items-center gap-1 pt-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase hover:text-foreground"
                        >
                          <HugeiconsIcon
                            icon={collapsedRepos.has(row.name) ? ArrowRight01Icon : ArrowDown01Icon}
                            strokeWidth={2}
                            className="size-3"
                          />
                          {row.name}
                        </button>
                        {row.error && <p className="text-xs text-destructive">{row.error}</p>}
                      </>
                    ) : (
                      <FileCard
                        rowKey={row.key}
                        file={row.file}
                        mode={split ? DiffModeEnum.Split : DiffModeEnum.Unified}
                        open={!collapsed.has(row.key)}
                        onToggle={toggle}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
