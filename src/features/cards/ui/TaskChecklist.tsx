import { Markdown } from '@/Markdown'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { countTasks, type TaskChecklist as Checklist, type TaskState } from '../../../../shared/domain/task-checklist'

const STATES: Record<TaskState, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'text-foreground' },
  done: { label: 'Concluída', color: 'text-emerald-700 dark:text-emerald-400' },
  failed: { label: 'Falhou', color: 'text-destructive' },
  blocked: { label: 'Bloqueada', color: 'text-amber-700 dark:text-amber-400' },
  discarded: { label: 'Descartada', color: 'text-muted-foreground' },
}

export function TaskChecklist({ checklist }: { checklist: Checklist }) {
  if (!checklist.items.length)
    return <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma task planejada.</p>
  const repos = [...new Set(checklist.items.map((item) => item.repo))]
  return (
    <div className="space-y-8">
      {repos.map((repo) => {
        const items = checklist.items.filter((item) => item.repo === repo)
        const counts = countTasks({ schemaVersion: 1, items })
        return (
          <section key={repo} aria-label={`Tasks de ${repo}`} className="min-w-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="break-all text-base font-semibold">{repo}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {counts.done}/{counts.total} concluídas
              </span>
            </div>
            <ol className="divide-y divide-border/70 border-y border-border/70">
              {items.map((item) => {
                const state = STATES[item.state]
                return (
                  <li key={item.id} className="min-w-0">
                    <details className="group/task py-3">
                      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <HugeiconsIcon
                          icon={ArrowRight01Icon}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open/task:rotate-90 motion-reduce:transition-none"
                        />
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span
                            className={cn('shrink-0 font-mono text-xs font-semibold', state.color)}
                            title={state.label}
                          >
                            {item.id}
                            <span className="sr-only"> — {state.label}</span>
                          </span>
                          <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{item.title}</span>
                        </span>
                      </summary>
                      <div className="mt-4 space-y-4 pl-5 text-sm [overflow-wrap:anywhere]">
                        {item.context && <Markdown text={item.context} />}
                        {item.completionCriteria.length > 0 && (
                          <div>
                            <h4 className="mb-1 font-medium">Critérios de conclusão</h4>
                            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                              {item.completionCriteria.map((criterion, index) => (
                                <li key={index}>{criterion}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <dl className="space-y-2 text-xs">
                          {[
                            ['Arquivos', item.files.length ? item.files.join(', ') : 'Todo o repositório'],
                            ['Dependências', item.deps.join(', ')],
                            ['Pré-condições', item.requires.join(', ')],
                            ['Arquivos novos', item.creates.join(', ')],
                            ['Limite por tentativa', item.timeoutMinutes ? `${item.timeoutMinutes} min` : ''],
                            ['Máximo de tentativas', item.maxAttempts ? String(item.maxAttempts) : ''],
                          ]
                            .filter(([, value]) => value)
                            .map(([label, value]) => (
                              <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                                <dt className="shrink-0 font-medium">{label}</dt>
                                <dd className="min-w-0 whitespace-pre-wrap text-muted-foreground">{value}</dd>
                              </div>
                            ))}
                        </dl>
                        {item.discardReason && (
                          <p className="text-muted-foreground">Motivo do descarte: {item.discardReason}</p>
                        )}
                        {item.notes.length > 0 && (
                          <div>
                            <h4 className="mb-1 font-medium">Notas da execução</h4>
                            <ul className="space-y-2 text-muted-foreground">
                              {item.notes.map((note, index) => (
                                <li key={index} className="whitespace-pre-wrap">
                                  {note}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
