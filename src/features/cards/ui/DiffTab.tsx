import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffFile, DiffModeEnum, DiffView, highlighter } from '@git-diff-view/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fetchDiff, startDiff, type CardDiffDocument, type SmartDiffFile } from '../api/card-detail-api'
import { fileLang, parseDiff, type FileDiff, type FileStatus } from '@/diff'
import { useTheme, type Theme } from '@/theme'
import '@git-diff-view/react/styles/diff-view.css'

const STATUS_BADGE: Partial<Record<FileStatus, { label: string; className: string }>> = {
  added: { label: 'novo', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  deleted: { label: 'removido', className: 'bg-destructive/10 text-destructive' },
  renamed: { label: 'renomeado', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
}

const AUTO_COLLAPSE_LINES = 500
const LOCK_FILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock)$/

const rowKey = (repo: string, file: FileDiff) => `${repo}:${file.oldName}→${file.newName}`

const autoCollapse = (file: FileDiff) =>
  file.raw.split('\n').length > AUTO_COLLAPSE_LINES || LOCK_FILE.test(file.newName || file.oldName)

const shouldHighlight = (file: FileDiff) => file.maxLine <= highlighter.maxLineToIgnoreSyntax

const parsedPatches = new WeakMap<SmartDiffFile, FileDiff[]>()

function parsedFiles(entry: SmartDiffFile): FileDiff[] {
  const cached = parsedPatches.get(entry)
  if (cached) return cached
  const files = parseDiff(entry.patch)
  parsedPatches.set(entry, files)
  return files
}

type ReviewRow =
  | { kind: 'repo'; key: string; name: string; readingGuide?: string }
  | { kind: 'section'; key: string; title: string; summary: string }
  | {
      kind: 'file'
      key: string
      fileKey: string
      file: FileDiff
      explanation: SmartDiffFile['explanation']
      lines: number
    }
  | { kind: 'note'; key: string; path: string; explanation: SmartDiffFile['explanation'] }
  | { kind: 'empty'; key: string }
  | { kind: 'noise'; key: string; items: CardDiffDocument['repositories'][number]['review']['noise'] }
  | { kind: 'warning'; key: string; text: string }

function prepareReview(document: CardDiffDocument | null) {
  const rows: ReviewRow[] = []
  let fileCount = 0
  let additions = 0
  let deletions = 0
  document?.repositories.forEach((repo, repoIndex) => {
    const prefix = `repo:${repoIndex}`
    rows.push({ kind: 'repo', key: prefix, name: repo.name, readingGuide: repo.review.readingGuide })
    repo.review.sections.forEach((section, sectionIndex) => {
      const sectionKey = `${prefix}:section:${sectionIndex}`
      rows.push({ kind: 'section', key: sectionKey, title: section.title, summary: section.summary })
      section.files.forEach((entry, entryIndex) => {
        const parsed = parsedFiles(entry)
        if (!parsed.length) {
          rows.push({
            kind: 'note',
            key: `${sectionKey}:note:${entryIndex}`,
            path: entry.path,
            explanation: entry.explanation,
          })
        }
        parsed.forEach((file, fileIndex) => {
          fileCount++
          additions += file.additions
          deletions += file.deletions
          rows.push({
            kind: 'file',
            key: `${sectionKey}:file:${entryIndex}:${fileIndex}`,
            fileKey: rowKey(repo.name, file),
            file,
            explanation: entry.explanation,
            lines: file.raw.split('\n').length,
          })
        })
      })
    })
    if (!repo.review.sections.length) rows.push({ kind: 'empty', key: `${prefix}:empty` })
    if (repo.review.noise.length) rows.push({ kind: 'noise', key: `${prefix}:noise`, items: repo.review.noise })
    repo.review.warnings?.forEach((warning, index) =>
      rows.push({ kind: 'warning', key: `${prefix}:warning:${index}`, text: warning }),
    )
  })
  return { rows, fileCount, additions, deletions }
}

// Preserva parse+highlight entre desmontagens da virtualização
const diffFiles = new WeakMap<FileDiff, DiffFile>()

// Sobrevive ao fechar/reabrir o modal; seen limita o auto-colapso a arquivos novos
const collapseState = new Map<string, { collapsed: Set<string>; seen: Set<string> }>()

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
  explanation,
}: {
  rowKey: string
  file: FileDiff
  mode: DiffModeEnum
  open: boolean
  onToggle: (key: string) => void
  explanation: SmartDiffFile['explanation']
}) {
  const theme = useTheme()
  return (
    <div className="overflow-clip rounded-md border">
      <FileHeader rowKey={rowKey} file={file} open={open} onToggle={onToggle} />
      <div className="space-y-1 border-t bg-muted/30 px-3 py-2 text-xs">
        {explanation.before && (
          <p>
            <span className="font-semibold">Antes:</span> {explanation.before}
          </p>
        )}
        {explanation.after && (
          <p>
            <span className="font-semibold">Depois:</span> {explanation.after}
          </p>
        )}
        {explanation.tests && (
          <p>
            <span className="font-semibold">Testes:</span> {explanation.tests}
          </p>
        )}
      </div>
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
  const [document, setDocument] = useState<CardDiffDocument | null>(null)
  const [status, setStatus] = useState<'checking' | 'idle' | 'running' | 'ready' | 'error'>('checking')
  const [error, setError] = useState<string | null>(null)
  const [split, setSplit] = useState(true)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [openNoise, setOpenNoise] = useState<ReadonlySet<string>>(new Set())
  const [tick, setTick] = useState(0)
  const generationRequest = useRef<{ cardId: string; regenerate: boolean } | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const [started, setStarted] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const state = await fetchDiff(cardId)
        if (cancelled) return
        setStatus(state.status === 'error' && !state.started ? 'idle' : state.status)
        setSteps(state.steps ?? [])
        setStarted(state.started)
        if (state.status === 'running') {
          timer = setTimeout(poll, 1500)
          return
        }
        setError(state.started ? (state.error ?? null) : null)
        if (state.result) {
          setDocument(state.result)
          const saved = collapseState.get(cardId) ?? { collapsed: new Set<string>(), seen: new Set<string>() }
          const next = new Set(saved.collapsed)
          for (const repo of state.result.repositories)
            for (const section of repo.review.sections)
              for (const entry of section.files)
                for (const file of parsedFiles(entry)) {
                  const key = rowKey(repo.name, file)
                  if (!saved.seen.has(key)) {
                    saved.seen.add(key)
                    if (autoCollapse(file)) next.add(key)
                  }
                }
          saved.collapsed = next
          collapseState.set(cardId, saved)
          setCollapsed(next)
        }
      } catch (reason) {
        if (!cancelled) {
          setStatus('error')
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }
    }
    setDocument(null)
    const request = generationRequest.current?.cardId === cardId ? generationRequest.current : null
    generationRequest.current = null
    setStatus(request ? 'running' : 'checking')
    setError(null)
    setSteps([])
    const begin = async () => {
      if (request) await startDiff(cardId, request.regenerate)
      if (!cancelled) await poll()
    }
    begin().catch((reason) => {
      if (!cancelled) {
        setStatus('error')
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [cardId, tick])

  const toggle = useCallback(
    (key: string) =>
      setCollapsed((previous) => {
        const next = new Set(previous)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        const saved = collapseState.get(cardId)
        if (saved) saved.collapsed = next
        return next
      }),
    [cardId],
  )

  const prepared = useMemo(() => prepareReview(document), [document])
  const rows = prepared.rows
  const scroll = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: status === 'ready' ? rows.length : 0,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => `${cardId}:${document?.generatedAt ?? ''}:${rows[index].key}`,
    estimateSize: (index) => {
      const row = rows[index]
      if (row.kind === 'file') return collapsed.has(row.fileKey) ? 110 : 110 + Math.min(row.lines * 19, 1200)
      if (row.kind === 'repo') return row.readingGuide ? 90 : 42
      if (row.kind === 'section') return 72
      if (row.kind === 'noise') return 56
      return 48
    },
    overscan: 3,
  })
  const loading = status === 'running'
  const checking = status === 'checking'
  const visibleSteps = steps.length ? steps : ['Iniciando revisão Smart Diff']

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3 text-xs text-muted-foreground">
        {checking
          ? 'Carregando Smart Diff…'
          : loading
            ? 'Gerando revisão com Smart Diff…'
            : status === 'idle'
              ? 'Smart Diff ainda não gerado'
              : status === 'error'
                ? 'Falha na revisão Smart Diff'
                : `${prepared.fileCount} ${prepared.fileCount === 1 ? 'arquivo alterado' : 'arquivos alterados'}`}
        {status === 'ready' && <Counts additions={prepared.additions} deletions={prepared.deletions} />}
        <div className="ml-auto flex items-center gap-1.5">
          {!checking && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                generationRequest.current = { cardId, regenerate: started }
                setStatus('running')
                setTick((value) => value + 1)
              }}
              disabled={loading}
            >
              {started ? 'Gerar novo Smart Diff' : 'Gerar Smart Diff'}
            </Button>
          )}
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
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {checking && <p className="py-10 text-center text-xs text-muted-foreground">Consultando revisão salva…</p>}
        {status === 'idle' && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Clique em Gerar Smart Diff para criar a revisão deste card.
          </p>
        )}
        {(loading || (status === 'error' && steps.length > 0)) && (
          <ol className="space-y-2 text-xs" aria-label="Etapas da revisão Smart Diff" aria-live="polite">
            {visibleSteps.map((step, index) => (
              <li
                key={`${index}-${step}`}
                className={cn(
                  'flex items-center gap-2',
                  index === visibleSteps.length - 1
                    ? status === 'error'
                      ? 'text-destructive'
                      : 'text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                <span aria-hidden="true">
                  {index === visibleSteps.length - 1 ? (status === 'error' ? '✕' : '●') : '✓'}
                </span>
                {step}
                {index === visibleSteps.length - 1 && loading ? '…' : ''}
              </li>
            ))}
          </ol>
        )}
        {status === 'ready' && !document?.repositories.length && (
          <p className="py-10 text-center text-xs text-muted-foreground">Sem repositórios vinculados à task.</p>
        )}
        {status === 'ready' && (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 w-full pb-4"
                  style={{ top: item.start }}
                >
                  {row.kind === 'repo' && (
                    <section className="space-y-2 pt-1">
                      <h3 className="border-b pb-1 text-xs font-semibold tracking-wider uppercase">{row.name}</h3>
                      {row.readingGuide && <p className="text-xs text-muted-foreground">{row.readingGuide}</p>}
                    </section>
                  )}
                  {row.kind === 'section' && (
                    <div className="pt-1">
                      <h4 className="text-sm font-semibold">{row.title}</h4>
                      <p className="text-xs text-muted-foreground">{row.summary}</p>
                    </div>
                  )}
                  {row.kind === 'file' && (
                    <FileCard
                      rowKey={row.fileKey}
                      file={row.file}
                      explanation={row.explanation}
                      mode={split ? DiffModeEnum.Split : DiffModeEnum.Unified}
                      open={!collapsed.has(row.fileKey)}
                      onToggle={toggle}
                    />
                  )}
                  {row.kind === 'note' && (
                    <div className="rounded-md border p-3 text-xs">
                      <strong>{row.path}</strong>
                      <p>{row.explanation.after ?? row.explanation.tests ?? row.explanation.before}</p>
                    </div>
                  )}
                  {row.kind === 'empty' && (
                    <p className="text-xs text-muted-foreground">Sem alterações para revisar.</p>
                  )}
                  {row.kind === 'noise' && (
                    <details
                      className="rounded-md border p-3 text-xs"
                      open={openNoise.has(`${cardId}:${row.key}`)}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open
                        setOpenNoise((previous) => {
                          if (previous.has(`${cardId}:${row.key}`) === isOpen) return previous
                          const next = new Set(previous)
                          if (isOpen) next.add(`${cardId}:${row.key}`)
                          else next.delete(`${cardId}:${row.key}`)
                          return next
                        })
                      }}
                    >
                      <summary className="cursor-pointer font-medium">Ruído recolhido ({row.items.length})</summary>
                      <ul className="mt-2 space-y-1">
                        {row.items.map((noise) => (
                          <li key={noise.path}>
                            <strong>{noise.path}</strong>: {noise.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {row.kind === 'warning' && <p className="text-xs text-amber-600">{row.text}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
