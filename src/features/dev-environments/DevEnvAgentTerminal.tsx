import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { SentIcon, StopIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Markdown } from '@/Markdown'
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
  }, [cardId, streaming])
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
    <section className="overflow-hidden rounded-xl border" aria-label="Terminal integrado do agente">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
        <div>
          <h3 className="text-sm font-medium">Terminal do agente</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Peça para iniciar, investigar um erro ou ajustar o ambiente local.
          </p>
        </div>
        {busy && (
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Executando
          </span>
        )}
      </div>
      <div
        ref={scroller}
        role="log"
        aria-label="Comandos e respostas do agente"
        aria-live="polite"
        aria-relevant="additions"
        className="h-72 space-y-3 overflow-auto bg-background px-4 py-3"
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
        {entries.map((entry, index) =>
          entry.tool !== undefined || entry.output !== undefined ? (
            <pre
              key={index}
              className="rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
            >
              {entry.tool !== undefined ? `$ ${entry.tool}` : entry.output || '(sem saída)'}
            </pre>
          ) : entry.role === 'user' ? (
            <p key={index} className="ml-6 rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
              {entry.text}
            </p>
          ) : (
            <Markdown key={index} text={entry.text ?? ''} />
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <textarea
          ref={textarea}
          aria-label="Pedido ao agente do ambiente"
          placeholder="Ex.: descubra por que a API não respondeu e tente iniciar novamente"
          value={input}
          maxLength={12000}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          className="min-h-20 min-w-0 flex-1 resize-y rounded-md border bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void send(input)
            }
          }}
        />
        {busy ? (
          <Button
            type="button"
            variant="outline"
            aria-label="Interromper agente"
            title="Interromper agente"
            className="size-10"
            onClick={() => void stop()}
          >
            <HugeiconsIcon icon={StopIcon} className="size-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            aria-label="Enviar pedido ao agente"
            title="Enviar pedido ao agente (⌘/Ctrl+Enter)"
            className="size-10"
            disabled={!input.trim() || loading}
          >
            <HugeiconsIcon icon={SentIcon} className="size-4" />
          </Button>
        )}
      </form>
      <p className="px-4 pb-3 text-[11px] text-muted-foreground">
        Interromper o agente encerra sua execução. Para encerrar os projetos, use “Parar ambiente”.
      </p>
    </section>
  )
})
