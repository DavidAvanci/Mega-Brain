import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { ChatTranscript } from '@/features/chat/ChatTranscript'
import { ChatComposer } from '@/features/chat/ChatComposer'
import { ChatExport } from '@/features/chat/ChatExport'
import { useChatModelSelection } from '@/features/chat/ChatModelPicker'
import type { ChatEntry } from '../../../shared/contracts/chat'
import type { DevEnvStartOptions } from '../../../shared/domain/dev-environments'
import { abortDevEnvAgent, fetchDevEnvAgent, sendDevEnvAgent } from './dev-env-api'

export type DevEnvTerminalHandle = {
  send: (text: string, configuration?: DevEnvStartOptions) => Promise<void>
  focus: () => void
}

export const DevEnvAgentTerminal = forwardRef<
  DevEnvTerminalHandle,
  { cardId: string; onRunningChange: (running: boolean) => void }
>(function DevEnvAgentTerminal({ cardId, onRunningChange }, ref) {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const busy = streaming || running
  const { selection, choose, restore } = useChatModelSelection(cardId)

  useEffect(() => {
    onRunningChange(busy)
  }, [busy, onRunningChange])
  useEffect(() => {
    if (streaming) return
    let cancelled = false
    const load = async () => {
      try {
        const history = await fetchDevEnvAgent(cardId)
        if (cancelled) return
        setEntries(history.entries)
        setRunning(Boolean(history.executionRunning))
        restore(history.selection)
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [cardId, streaming, restore])
  useEffect(() => {
    if (scroller.current && followLatest.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [entries])

  const send = async (text: string, configuration?: DevEnvStartOptions) => {
    if (!text.trim() || busy || active.current) return
    active.current = true
    setStreaming(true)
    setError(null)
    setInput('')
    followLatest.current = true
    setEntries((previous) => [...previous, { role: 'user', text }])
    try {
      await sendDevEnvAgent(
        cardId,
        text,
        (event) => {
          if (event.type === 'text')
            setEntries((previous) => {
              const last = previous.at(-1)
              if (last?.role === 'assistant' && last.text !== undefined)
                return [...previous.slice(0, -1), { ...last, text: last.text + event.text }]
              return [...previous, { role: 'assistant', text: event.text }]
            })
          if (event.type === 'tool') setEntries((previous) => [...previous, { role: 'assistant', tool: event.tool }])
          if (event.type === 'output')
            setEntries((previous) => [...previous, { role: 'assistant', output: event.text }])
          if (event.type === 'done' && event.error) setError(event.error)
        },
        configuration,
        selection,
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      active.current = false
      setStreaming(false)
    }
  }
  useImperativeHandle(ref, () => ({ send, focus: () => textarea.current?.focus() }))
  const stop = async () => {
    try {
      await abortDevEnvAgent(cardId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="Terminal integrado do agente">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
        <div>
          <h3 className="text-sm font-medium">Agente de ambiente</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Peça para iniciar, investigar um erro ou ajustar o ambiente local.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              Executando
            </span>
          )}
          <ChatExport cardId={cardId} conversation="Ambiente" entries={entries} />
        </div>
      </div>
      <div
        ref={scroller}
        role="log"
        aria-label="Comandos e respostas do agente"
        aria-live="polite"
        aria-relevant="additions"
        className="min-h-0 flex-1 space-y-3 overflow-auto bg-background px-4 py-3"
        onScroll={() => {
          const el = scroller.current
          if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {loading && <p className="text-xs text-muted-foreground">Carregando histórico…</p>}
        {!loading && !entries.length && (
          <p className="text-sm text-muted-foreground">
            Os comandos, as saídas e as respostas aparecerão aqui. Use “Iniciar com agente” na configuração ou escreva
            um pedido abaixo.
          </p>
        )}
        <ChatTranscript entries={entries} busy={busy} />
      </div>
      {error && (
        <p role="alert" className="shrink-0 px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="shrink-0 px-4 pt-3 pb-2">
        <ChatComposer
          input={input}
          onInput={setInput}
          onSend={() => void send(input)}
          onStop={() => void stop()}
          busy={busy}
          loading={loading}
          selection={selection}
          onSelection={choose}
          textareaRef={textarea}
          label="Pedido ao agente do ambiente"
          placeholder="Peça para iniciar o ambiente ou investigar uma falha…"
          sendLabel="Enviar pedido ao agente"
          stopLabel="Interromper agente"
        />
      </div>
      <p className="shrink-0 px-4 pb-3 text-[11px] text-muted-foreground">
        Interromper o agente encerra sua execução. Para encerrar os projetos, use “Parar ambiente”.
      </p>
    </section>
  )
})
