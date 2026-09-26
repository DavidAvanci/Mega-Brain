import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { SentIcon, StopIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea'
import { cn } from '@/lib/utils'
import { abortChat, fetchChat, sendChat } from '@/features/cards/api/card-detail-api'
import { Markdown } from '@/Markdown'
import type { ChatAgentSettings, ChatEntry } from '../../../shared/contracts/chat'

function Entry({ entry }: { entry: ChatEntry }) {
  if (entry.tool) {
    return (
      <p className="shrink-0 truncate pl-3 font-mono text-[11px] text-muted-foreground" title={entry.tool}>
        {entry.tool}
      </p>
    )
  }
  if (entry.role === 'user') {
    return <p className="ml-auto max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{entry.text}</p>
  }
  return (
    <div className="min-w-0">
      <Markdown text={entry.text ?? ''} />
    </div>
  )
}

export function ChatTab({ cardId }: { cardId: string }) {
  const [entries, setEntries] = useState<ChatEntry[] | null>(null)
  const [session, setSession] = useState<string | null>(null)
  const [settings, setSettings] = useState<ChatAgentSettings | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const actionButton = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<string | null>(null)

  useEffect(() => {
    const cancelOnFocus = (event: FocusEvent) => {
      if (pendingFocus.current && event.target !== textarea.current && event.target !== actionButton.current) {
        pendingFocus.current = null
      }
    }
    const cancelOnPointer = (event: PointerEvent) => {
      if (pendingFocus.current && !composer.current?.contains(event.target as Node)) {
        pendingFocus.current = null
      }
    }
    document.addEventListener('focusin', cancelOnFocus, true)
    document.addEventListener('pointerdown', cancelOnPointer, true)
    return () => {
      pendingFocus.current = null
      document.removeEventListener('focusin', cancelOnFocus, true)
      document.removeEventListener('pointerdown', cancelOnPointer, true)
    }
  }, [])

  useEffect(() => {
    pendingFocus.current = null
  }, [cardId])

  useLayoutEffect(() => {
    if (streaming || pendingFocus.current !== cardId) return
    pendingFocus.current = null
    if (textarea.current?.isConnected && !textarea.current.disabled) textarea.current.focus()
  }, [streaming, cardId, focusRequest])

  useEffect(() => {
    let cancelled = false
    fetchChat(cardId)
      .then((data) => {
        if (cancelled) return
        setEntries(data.entries)
        setSession(data.sessionId)
        setSettings(data.settings ?? null)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [cardId])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  const append = (entry: ChatEntry) => setEntries((prev) => [...(prev ?? []), entry])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    pendingFocus.current = cardId
    setInput('')
    setError(null)
    setStreaming(true)
    append({ role: 'user', text })
    try {
      await sendChat(cardId, text, (event) => {
        if (event.type === 'settings') return setSettings(event.settings)
        if (event.type === 'tool') return append({ role: 'assistant', tool: event.tool })
        if (event.type === 'done') return event.error ? setError(event.error) : undefined
        setEntries((prev) => {
          const list = prev ?? []
          const last = list[list.length - 1]
          if (last?.role === 'assistant' && last.text !== undefined) {
            return [...list.slice(0, -1), { ...last, text: last.text + event.text }]
          }
          return [...list, { role: 'assistant', text: event.text }]
        })
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStreaming(false)
      setFocusRequest((request) => request + 1)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {settings && (
        <p className="border-b px-5 py-2 text-[11px] text-muted-foreground" aria-label="Configuração do agente">
          {settings.model} · effort {settings.effort}
        </p>
      )}
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {entries === null ? (
          <>
            <Skeleton className="ml-auto h-8 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </>
        ) : entries.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {session ? 'Sessão sem mensagens ainda.' : 'Nenhuma sessão do agente ainda — a primeira mensagem abre uma.'}
          </p>
        ) : (
          entries.map((entry, index) => <Entry key={index} entry={entry} />)
        )}
        {streaming && <Spinner className="text-muted-foreground" />}
      </div>
      {error && <p className="px-5 pb-2 text-xs text-destructive">{error}</p>}
      <div ref={composer} className="flex items-end gap-2 border-t px-5 py-3">
        <RepositoryMentionTextarea
          textareaRef={textarea}
          popupPlacement="above"
          aria-label="Mensagem do chat"
          rows={1}
          value={input}
          onValueChange={setInput}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return
            e.preventDefault()
            send()
          }}
          placeholder={session ? 'Peça um ajuste ao agente…' : 'Comece uma sessão nessa pasta…'}
          className={cn('max-h-40 min-h-10 resize-none', streaming && 'opacity-60')}
          disabled={streaming}
        />
        {streaming ? (
          <Button
            ref={actionButton}
            aria-label="Parar resposta"
            className="h-10 w-10 px-0"
            variant="outline"
            size="sm"
            onClick={() => abortChat(cardId)}
          >
            <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
          </Button>
        ) : (
          <Button
            ref={actionButton}
            aria-label="Enviar mensagem"
            className="h-10 w-10 px-0"
            size="sm"
            onClick={send}
            disabled={!input.trim()}
          >
            <HugeiconsIcon icon={SentIcon} strokeWidth={2} />
          </Button>
        )}
      </div>
    </div>
  )
}
