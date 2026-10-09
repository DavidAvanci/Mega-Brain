import { KnowledgeAttachments } from '@/features/knowledge/KnowledgeAttachments'
import type { KnowledgeRef } from '../../../shared/domain/knowledge'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { abortChat, fetchChat, sendChat } from '@/features/cards/api/card-detail-api'
import type { ChatAgentSettings, ChatEntry } from '../../../shared/contracts/chat'
import { ChatTranscript } from './ChatTranscript'
import { ChatComposer } from './ChatComposer'
import { ChatExport } from './ChatExport'
import { useChatModelSelection } from './ChatModelPicker'

export function ChatTab({ cardId }: { cardId: string }) {
  const [entries, setEntries] = useState<ChatEntry[] | null>(null)
  const [session, setSession] = useState<string | null>(null)
  const [settings, setSettings] = useState<ChatAgentSettings | null>(null)
  const [input, setInput] = useState('')
  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([])
  const [streaming, setStreaming] = useState(false)
  const [executionRunning, setExecutionRunning] = useState(false)
  const [pendingMessages, setPendingMessages] = useState(0)
  const [focusRequest, setFocusRequest] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const composer = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const actionButton = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const { selection, choose, restore } = useChatModelSelection(cardId)

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
    const refresh = () =>
      fetchChat(cardId)
        .then((data) => {
          if (cancelled) return
          setEntries((previous) =>
            JSON.stringify(previous) === JSON.stringify(data.entries) ? previous : data.entries,
          )
          setSession(data.sessionId)
          setSettings(data.settings ?? null)
          setExecutionRunning(Boolean(data.executionRunning))
          setPendingMessages(data.pendingMessages ?? 0)
          restore(data.selection)
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    if (streaming) return
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [cardId, streaming, restore])

  useEffect(() => {
    const el = scroller.current
    if (el && followLatest.current) el.scrollTop = el.scrollHeight
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
      await sendChat(
        cardId,
        text,
        (event) => {
          if (event.type === 'settings') return setSettings(event.settings)
          if (event.type === 'queued') {
            setPendingMessages((count) => count + 1)
            return
          }
          if (event.type === 'tool') return append({ role: 'assistant', tool: event.tool })
          if (event.type === 'output') return append({ role: 'assistant', output: event.text })
          if (event.type === 'done') return event.error ? setError(event.error) : undefined
          setEntries((prev) => {
            const list = prev ?? []
            const last = list[list.length - 1]
            if (last?.role === 'assistant' && last.text !== undefined) {
              return [...list.slice(0, -1), { ...last, text: last.text + event.text }]
            }
            return [...list, { role: 'assistant', text: event.text }]
          })
        },
        knowledgeRefs,
        selection,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStreaming(false)
      setFocusRequest((request) => request + 1)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-1">
        <span className="text-xs text-muted-foreground">Conversa e atividade das execuções</span>
        <ChatExport cardId={cardId} conversation="Execuções" entries={entries ?? []} />
      </div>
      {(executionRunning || pendingMessages > 0) && (
        <p className="border-b px-5 py-2 text-[11px] text-muted-foreground" role="status">
          {executionRunning
            ? 'Execução em andamento · novas mensagens serão entregues na próxima chamada do agente.'
            : 'Execução encerrada · envie uma mensagem para continuar a conversa.'}
          {pendingMessages > 0 ? ` ${pendingMessages} mensagem(ns) pendente(s).` : ''}
        </p>
      )}
      {settings && (
        <p className="border-b px-5 py-2 text-[11px] text-muted-foreground" aria-label="Configuração do agente">
          {settings.model} · effort {settings.effort}
        </p>
      )}
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
      >
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
          <ChatTranscript entries={entries} busy={streaming || executionRunning} />
        )}
        {streaming && <Spinner className="text-muted-foreground" />}
      </div>
      {error && <p className="px-5 pb-2 text-xs text-destructive">{error}</p>}
      <div ref={composer} className="shrink-0 px-5 py-3">
        <ChatComposer
          input={input}
          onInput={setInput}
          onSend={() => void send()}
          onStop={() => void abortChat(cardId)}
          busy={streaming}
          loading={entries === null}
          modelLocked={executionRunning}
          selection={selection}
          onSelection={choose}
          textareaRef={textarea}
          actionRef={actionButton}
          label="Mensagem do chat"
          sendLabel="Enviar mensagem"
          stopLabel="Parar resposta"
          mentions
          placeholder={
            executionRunning
              ? 'Adicione uma orientação à execução…'
              : session || entries?.length
                ? 'Peça um ajuste ao agente…'
                : 'Comece uma sessão nessa pasta…'
          }
        >
          <KnowledgeAttachments
            value={knowledgeRefs}
            onChange={setKnowledgeRefs}
            onMention={(mention) => setInput((previous) => `${previous}${previous ? ' ' : ''}${mention} `)}
            disabled={streaming}
          />
        </ChatComposer>
      </div>
    </div>
  )
}
