import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Download01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import type { ChatEntry } from '../../../shared/contracts/chat'
import { downloadChat } from './chat-download'

function fenced(text: string, language: string): string {
  const runs = text.match(/`{3,}/g) ?? []
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)))
  return `${fence}${language}\n${text}\n${fence}`
}

export function chatMarkdown(cardId: string, conversation: string, entries: ChatEntry[]): string {
  return (
    [
      `# ${conversation} — ${cardId}`,
      `Exportado em ${new Date().toISOString()}. Histórico carregado no momento da exportação.`,
      ...entries.map((entry) => {
        const title = entry.role === 'user' ? 'Você' : 'Agente'
        const content =
          entry.tool !== undefined
            ? fenced(entry.tool, 'sh')
            : entry.output !== undefined
              ? fenced(entry.output, 'text')
              : (entry.text ?? '')
        return `## ${title}${entry.source ? ` · ${entry.source}` : ''}\n\n${entry.queued ? '*Mensagem pendente.*\n\n' : ''}${content}`
      }),
    ].join('\n\n') + '\n'
  )
}

export function ChatExport({
  cardId,
  conversation,
  entries,
}: {
  cardId: string
  conversation: string
  entries: ChatEntry[]
}) {
  const [error, setError] = useState(false)
  const [exporting, setExporting] = useState(false)
  return (
    <div className="shrink-0">
      <Button
        type="button"
        variant="ghost"
        className="size-10"
        aria-label="Exportar chat"
        title="Exportar histórico carregado (.md)"
        disabled={!entries.length || exporting}
        onClick={async () => {
          setExporting(true)
          try {
            const filename = `${cardId}-${conversation}`.replace(/[^\p{L}\p{N}_-]/gu, '-').toLowerCase() + '.md'
            await downloadChat(filename, chatMarkdown(cardId, conversation, entries))
            setError(false)
          } catch {
            setError(true)
          } finally {
            setExporting(false)
          }
        }}
      >
        <HugeiconsIcon icon={Download01Icon} className="size-4" />
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Não foi possível exportar o chat.
        </p>
      )}
    </div>
  )
}
