import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, CommandIcon } from '@hugeicons/core-free-icons'
import { Markdown } from '@/Markdown'
import type { ChatEntry } from '../../../shared/contracts/chat'

type ChatBlock = { index: number; entries: ChatEntry[]; activity: boolean; source?: string }

function blocks(entries: ChatEntry[]): ChatBlock[] {
  const result: ChatBlock[] = []
  entries.forEach((entry, index) => {
    const activity = entry.tool !== undefined || entry.output !== undefined
    const previous = result.at(-1)
    const source = previous?.source
    if (activity && previous?.activity && (!entry.source || !source || entry.source === source)) {
      previous.entries.push(entry)
      previous.source ??= entry.source
      return
    }
    result.push({ index, entries: [entry], activity, source: entry.source })
  })
  return result
}

export function ChatTranscript({ entries, busy = false }: { entries: ChatEntry[]; busy?: boolean }) {
  const grouped = blocks(entries)
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5">
      {grouped.map((block, index) => {
        const entry = block.entries[0]
        if (block.activity) {
          const commands = block.entries.filter((item) => item.tool !== undefined)
          const lastCommand = commands.at(-1)?.tool
          const source = block.source
          return (
            <details key={block.index} className="group/activity min-w-0 rounded-lg border bg-muted/20">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground select-none hover:text-foreground focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="size-3.5 shrink-0 transition-transform group-open/activity:rotate-90"
                />
                <HugeiconsIcon icon={CommandIcon} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate tabular-nums">
                    {commands.length
                      ? `${commands.length} ${commands.length === 1 ? 'comando' : 'comandos'}`
                      : 'Saída do agente'}
                    {source ? ` · ${source}` : ''}
                  </span>
                  {lastCommand && (
                    <span className="mt-1 block truncate font-mono text-[11px]" title={lastCommand}>
                      {lastCommand.split('\n')[0]}
                    </span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-[11px]">
                  {busy && index === grouped.length - 1 ? 'Em andamento' : 'Ver detalhes'}
                </span>
              </summary>
              <div className="divide-y border-t">
                {block.entries.map((item, offset) => (
                  <div key={offset} className="min-w-0 px-3 py-2">
                    <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      {item.tool !== undefined ? 'Comando / ferramenta' : 'Saída'}
                    </p>
                    <pre className="max-h-72 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap break-words">
                      {item.tool !== undefined ? item.tool : item.output || '(sem saída)'}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )
        }
        if (entry.role === 'user')
          return (
            <div
              key={block.index}
              className="ml-auto max-w-[85%] rounded-xl bg-muted px-4 py-3 text-sm whitespace-pre-wrap break-words"
            >
              <p>{entry.text}</p>
              {entry.queued && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Pendente · será entregue na próxima chamada do agente
                </p>
              )}
            </div>
          )
        return (
          <div key={block.index} className="min-w-0 text-sm leading-relaxed">
            {entry.source && <p className="mb-2 text-[11px] text-muted-foreground">{entry.source}</p>}
            <Markdown text={entry.text ?? ''} />
          </div>
        )
      })}
    </div>
  )
}
