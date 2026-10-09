import { useId, useLayoutEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  TextBoldIcon,
  TextItalicIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  CheckListIcon,
  QuoteUpIcon,
  Link01Icon,
  CodeIcon,
  CodeSquareIcon,
  Undo02Icon,
  Redo01Icon,
  MaximizeScreenIcon,
  MinimizeScreenIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/Markdown'
import { Tip } from '@/Tip'
import { cn } from '@/lib/utils'
import { formatPrompt, type MarkdownAction, type PromptSelection } from './prompt-markdown'

const MAX_LENGTH = 50_000
const HISTORY_LIMIT = 60
const TYPING_GROUP_MS = 700
const FORMAT_ACTIONS = [
  { action: 'heading', label: 'Título de seção', text: 'H2' },
  { action: 'bold', label: 'Negrito (⌘/Ctrl B)', icon: TextBoldIcon },
  { action: 'italic', label: 'Itálico (⌘/Ctrl I)', icon: TextItalicIcon },
  { action: 'bullet', label: 'Lista com marcadores', icon: LeftToRightListBulletIcon },
  { action: 'numbered', label: 'Lista numerada', icon: LeftToRightListNumberIcon },
  { action: 'checklist', label: 'Lista de tarefas', icon: CheckListIcon },
  { action: 'quote', label: 'Citação', icon: QuoteUpIcon },
  { action: 'link', label: 'Inserir link (⌘/Ctrl K)', icon: Link01Icon },
  { action: 'code', label: 'Código em linha', icon: CodeIcon },
  { action: 'codeBlock', label: 'Bloco de código', icon: CodeSquareIcon },
] satisfies { action: MarkdownAction; label: string; text?: string; icon?: typeof TextBoldIcon }[]

type History = { past: PromptSelection[]; future: PromptSelection[]; lastTypedAt: number; cursor: number }

export function PromptMarkdownEditor({
  value,
  onChange,
  title,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  title: string
  disabled?: boolean
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const selection = useRef({ start: 0, end: 0 })
  const pendingSelection = useRef<PromptSelection | null>(null)
  const history = useRef<History>({ past: [], future: [], lastTypedAt: 0, cursor: -1 })
  const [historyVersion, setHistoryVersion] = useState(0)
  const [preview, setPreview] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const helpId = useId()

  useLayoutEffect(() => {
    const pending = pendingSelection.current
    if (!pending || preview || !textarea.current) return
    textarea.current.focus({ preventScroll: true })
    textarea.current.setSelectionRange(pending.start, pending.end)
    selection.current = { start: pending.start, end: pending.end }
    pendingSelection.current = null
  }, [value, preview, historyVersion])

  const rememberSelection = () => {
    if (textarea.current)
      selection.current = { start: textarea.current.selectionStart, end: textarea.current.selectionEnd }
  }
  const snapshot = (): PromptSelection => ({ value, ...selection.current })
  const notifyHistory = () => setHistoryVersion((version) => version + 1)
  const edit = (next: PromptSelection, typing = false) => {
    if (disabled || next.value === value) return
    if (next.value.length > MAX_LENGTH) {
      setLimitReached(true)
      return
    }
    const current = history.current
    const now = Date.now()
    const group =
      typing &&
      now - current.lastTypedAt < TYPING_GROUP_MS &&
      selection.current.start === selection.current.end &&
      selection.current.start === current.cursor
    if (!group) current.past = [...current.past, snapshot()].slice(-HISTORY_LIMIT)
    current.future = []
    current.lastTypedAt = typing ? now : 0
    current.cursor = next.end
    selection.current = { start: next.start, end: next.end }
    if (!typing) pendingSelection.current = next
    setLimitReached(false)
    onChange(next.value)
    notifyHistory()
  }
  const apply = (action: MarkdownAction) => {
    rememberSelection()
    edit(formatPrompt(snapshot(), action))
  }
  const travelHistory = (direction: 'undo' | 'redo') => {
    if (disabled) return
    rememberSelection()
    const current = history.current
    const from = direction === 'undo' ? current.past : current.future
    const to = direction === 'undo' ? current.future : current.past
    const next = from.pop()
    if (!next) return
    to.push(snapshot())
    current.lastTypedAt = 0
    pendingSelection.current = next
    setLimitReached(false)
    onChange(next.value)
    notifyHistory()
  }
  const height = expanded ? 'h-[min(60dvh,36rem)]' : 'h-72 sm:h-80'
  return (
    <div className="overflow-clip rounded-lg border bg-background focus-within:border-ring">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/35 px-2 py-1.5">
        <div className="flex gap-1" role="group" aria-label={`Visualização do prompt: ${title}`}>
          <Button
            type="button"
            size="xs"
            variant={preview ? 'ghost' : 'secondary'}
            aria-pressed={!preview}
            onClick={() => {
              if (!preview) return
              pendingSelection.current = snapshot()
              setPreview(false)
            }}
          >
            Editar
          </Button>
          <Button
            type="button"
            size="xs"
            variant={preview ? 'secondary' : 'ghost'}
            aria-pressed={preview}
            onClick={() => {
              rememberSelection()
              setPreview(true)
            }}
          >
            Prévia
          </Button>
        </div>
        <Tip label={expanded ? 'Reduzir editor' : 'Ampliar editor'}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? 'Reduzir editor' : 'Ampliar editor'}
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <HugeiconsIcon icon={expanded ? MinimizeScreenIcon : MaximizeScreenIcon} strokeWidth={1.5} />
          </Button>
        </Tip>
      </div>
      {!preview && (
        <div
          className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
          role="group"
          aria-label={`Formatação Markdown: ${title}`}
        >
          <Tip label="Desfazer (⌘/Ctrl Z)">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Desfazer"
              disabled={disabled || !history.current.past.length}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => travelHistory('undo')}
            >
              <HugeiconsIcon icon={Undo02Icon} strokeWidth={1.5} />
            </Button>
          </Tip>
          <Tip label="Refazer (⌘/Ctrl Shift Z)">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refazer"
              disabled={disabled || !history.current.future.length}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => travelHistory('redo')}
            >
              <HugeiconsIcon icon={Redo01Icon} strokeWidth={1.5} />
            </Button>
          </Tip>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          {FORMAT_ACTIONS.map((item) => (
            <Tip key={item.action} label={item.label}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={item.label}
                disabled={disabled}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => apply(item.action)}
              >
                {item.icon ? (
                  <HugeiconsIcon icon={item.icon} strokeWidth={1.5} />
                ) : (
                  <span className="font-mono text-[11px] font-semibold">{item.text}</span>
                )}
              </Button>
            </Tip>
          ))}
        </div>
      )}
      <Textarea
        ref={textarea}
        aria-label={`Prompt: ${title}`}
        aria-describedby={helpId}
        value={value}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        spellCheck={false}
        placeholder="Escreva as instruções do agente em Markdown…"
        className={cn(
          height,
          'field-sizing-fixed resize-none rounded-none border-0 bg-muted/10 p-4 font-mono text-xs leading-7 shadow-none focus-visible:ring-0 md:text-xs dark:bg-muted/10',
          preview && 'hidden',
        )}
        onSelect={rememberSelection}
        onBeforeInput={rememberSelection}
        onChange={(event) =>
          edit(
            {
              value: event.currentTarget.value,
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            },
            true,
          )
        }
        onKeyDown={(event) => {
          rememberSelection()
          if (event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return
          const key = event.key.toLowerCase()
          if (key === 'z' || (key === 'y' && event.ctrlKey)) {
            event.preventDefault()
            travelHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
            return
          }
          const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : null
          if (!action) return
          event.preventDefault()
          apply(action)
        }}
      />
      {preview && (
        <div
          role="region"
          aria-label={`Prévia do prompt: ${title}`}
          className={cn(
            height,
            'overflow-auto p-4 [&_.markdown]:break-words [&_.markdown_h2]:static [&_.markdown_h2]:bg-transparent [&_.markdown_pre]:max-w-full',
          )}
        >
          {value.trim() ? (
            <Markdown text={value} />
          ) : (
            <p className="text-xs text-muted-foreground">O Markdown aparecerá aqui quando você escrever o prompt.</p>
          )}
        </div>
      )}
      <div
        id={helpId}
        className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground"
      >
        <span role={limitReached ? 'status' : undefined}>
          {limitReached ? 'Limite de 50.000 caracteres atingido.' : 'Markdown · selecione um trecho para formatar'}
        </span>
        <span className="tabular-nums">
          {value.length.toLocaleString('pt-BR')} / 50.000 caracteres · {value.split('\n').length} linhas
        </span>
      </div>
    </div>
  )
}
