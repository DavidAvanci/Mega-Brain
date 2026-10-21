import { useState } from 'react'
import { Markdown } from '@/Markdown'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { countTasks, type ChecklistItem, type TaskChecklist as Checklist, type TaskState } from '../../../../shared/domain/task-checklist'

const STATES: Record<TaskState, { label: string; color: string; dot: string }> = {
  pending: { label: 'Pendente', color: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  done: { label: 'Concluída', color: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-600 dark:bg-emerald-400' },
  failed: { label: 'Falhou', color: 'text-destructive', dot: 'bg-destructive' },
  blocked: { label: 'Bloqueada', color: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-600 dark:bg-amber-400' },
  discarded: { label: 'Descartada', color: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
}

function ChecklistItemDetails({ item, defaultOpen }: { item: ChecklistItem; defaultOpen: boolean }) {
  const state = STATES[item.state]
  const files = [...new Set([...item.files, ...item.creates, ...item.requires])]
  const stateIconColor = item.state === 'done'
    ? 'text-emerald-600 dark:text-emerald-400'
    : item.state === 'blocked'
      ? 'text-amber-600 dark:text-amber-400'
      : item.state === 'failed'
        ? 'text-destructive'
        : 'text-muted-foreground'
  return (
    <li className="min-w-0 border-b border-border/70 last:border-b-0">
      <details defaultOpen={defaultOpen} className="group/task py-3">
        <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open/task:rotate-90 motion-reduce:transition-none" />
          <span className="flex min-w-0 flex-1 items-start gap-x-2">
            <svg viewBox="0 0 16 16" aria-label={state.label} role="img" className={cn('mt-0.5 size-4 shrink-0', stateIconColor)}>
              {item.state === 'done' ? <><circle cx="8" cy="8" r="8" fill="currentColor" /><path d="M4.6 8.2 7 10.5l4.4-4.7" fill="none" stroke="var(--background)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></>
                : item.state === 'discarded' ? <><circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
                  : item.state === 'pending' ? <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2" />
                    : item.state === 'blocked' ? <><circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
                      : item.state === 'failed' ? <><circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m5.5 5.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
                        : <><circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 3a5 5 0 0 1 0 10Z" fill="currentColor" /></>}
            </svg>
            <span className={cn('shrink-0 pt-0.5 font-mono text-xs font-semibold', state.color)} title={state.label}>
              {item.id}<span className="sr-only"> — {state.label}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className={cn('min-w-0 flex-1 break-words text-sm font-medium [overflow-wrap:anywhere]', item.state === 'discarded' && 'text-muted-foreground')} style={item.state === 'discarded' ? { textDecorationLine: 'line-through' } : undefined}>
                  {item.title}
                </span>
                <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', state.color)}>
                  <span aria-hidden="true" className={cn('size-1.5 rounded-full', state.dot)} />{state.label}
                </span>
              </span>
              {item.state === 'discarded' && item.discardReason && (
                <span className="truncate text-xs text-muted-foreground" title={item.discardReason}>{item.discardReason}</span>
              )}
            </span>
          </span>
        </summary>
        <div className="mt-4 min-w-0 gap-5 pl-5 text-sm [overflow-wrap:anywhere]" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(min(220px, 38%), 270px)', alignItems: 'start' }}>
          <div className="min-w-0 space-y-4">
            {item.discardReason && (
              <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3">
                <h4 className="text-xs font-semibold text-muted-foreground">Motivo do descarte</h4>
                <p className="text-sm leading-relaxed">{item.discardReason}</p>
              </div>
            )}
            {item.context && <div className="space-y-1.5"><h4 className="text-xs font-semibold text-muted-foreground">Contexto</h4><Markdown text={item.context} /></div>}
            {item.completionCriteria.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground">Critérios de conclusão · {item.completionCriteria.length}</h4>
                <ul className="space-y-2">
                  {item.completionCriteria.map((criterion, index) => (
                    <li key={index} className="flex items-start gap-2.5">
                      <span aria-hidden="true" className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', item.state === 'done' ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-background' : 'border-input')}>
                        {item.state === 'done' && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span className="text-[13px] leading-[1.6] text-foreground">{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <aside className="box-border flex min-w-0 flex-col gap-4 self-start rounded-lg border border-border/70 bg-muted/30 p-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">Arquivos</h4>
              {files.length ? files.map((file) => {
                const tags = [item.creates.includes(file) ? 'Cria' : item.files.includes(file) ? 'Altera' : '', item.requires.includes(file) ? 'Requer' : ''].filter(Boolean)
                const slash = file.lastIndexOf('/')
                return <div key={file} className="space-y-1.5"><p className="break-all font-mono text-xs"><span className="text-muted-foreground">{file.slice(0, slash + 1)}</span><span className="font-medium">{file.slice(slash + 1)}</span></p><div className="flex flex-wrap gap-1">{tags.map((tag) => <span key={tag} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{tag}</span>)}</div></div>
              }) : <span className="text-xs text-muted-foreground">Todo o repositório</span>}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">Dependências</h4>
              {item.deps.length ? <div className="flex flex-wrap gap-1.5">{item.deps.map((dep) => <span key={dep} className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs">{dep}</span>)}</div> : <span className="text-xs text-muted-foreground">Nenhuma</span>}
            </div>
            {(item.timeoutMinutes || item.maxAttempts) && <div className="space-y-1"><h4 className="text-xs font-semibold text-muted-foreground">Limites</h4><p className="text-xs">{[item.timeoutMinutes && `${item.timeoutMinutes} min por tentativa`, item.maxAttempts && `${item.maxAttempts} tentativas`].filter(Boolean).join(' · ')}</p></div>}
            {item.notes.length > 0 && <div className="space-y-1.5"><h4 className="text-xs font-semibold text-muted-foreground">Notas da execução</h4><ul className="space-y-1 text-xs text-muted-foreground">{item.notes.map((note, index) => <li key={index} className="whitespace-pre-wrap">{note}</li>)}</ul></div>}
          </aside>
        </div>
      </details>
    </li>
  )
}

export function TaskChecklist({ checklist }: { checklist: Checklist }) {
  const [showDiscarded, setShowDiscarded] = useState(true)
  const [expandVersion, setExpandVersion] = useState(0)
  const [allExpanded, setAllExpanded] = useState(false)
  if (!checklist.items.length)
    return <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma task planejada.</p>
  const active = checklist.items.filter((item) => item.state !== 'discarded')
  const done = active.filter((item) => item.state === 'done').length
  const discarded = checklist.items.length - active.length
  const repos = [...new Set(checklist.items.map((item) => item.repo))]
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">{checklist.issue || 'CHECKLIST'}</p>
          <p className="text-sm font-medium tabular-nums">{done} de {active.length} concluídas{discarded > 0 && <span className="font-normal text-muted-foreground"> · {discarded} descartada{discarded === 1 ? '' : 's'}</span>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button type="button" className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setAllExpanded(!allExpanded); setExpandVersion((version) => version + 1) }}>{allExpanded ? 'Recolher todas' : 'Expandir todas'}</button>
          {discarded > 0 && <button type="button" className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={showDiscarded} onClick={() => setShowDiscarded((visible) => !visible)}>{showDiscarded ? 'Ocultar' : 'Mostrar'} descartadas{!showDiscarded && ` (${discarded})`}</button>}
        </div>
      </header>
      {repos.map((repo) => {
        const items = checklist.items.filter((item) => item.repo === repo)
        const visibleItems = showDiscarded ? items : items.filter((item) => item.state !== 'discarded')
        const counts = countTasks({ schemaVersion: 1, items })
        return (
          <section key={repo} aria-label={`Tasks de ${repo}`} className="min-w-0">
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="break-all text-sm font-semibold">{repo}</h3>
              <div className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Progresso de ${repo}`} aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.done}>
                <div className="h-full rounded-full transition-[width] motion-reduce:transition-none" style={{ width: `${counts.total ? (counts.done / counts.total) * 100 : 0}%`, backgroundColor: 'var(--status-9)' }} />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">{counts.done}/{counts.total} concluídas</span>
            </div>
            {visibleItems.length ? <ol key={`${repo}-${showDiscarded}-${expandVersion}`} className="divide-y-0 border-y border-border/70">{visibleItems.map((item) => <ChecklistItemDetails key={item.id} item={item} defaultOpen={allExpanded} />)}</ol> : <p className="border-y border-border/70 py-3 text-xs text-muted-foreground">Todas as tasks deste repositório foram descartadas.</p>}
          </section>
        )
      })}
    </div>
  )
}
