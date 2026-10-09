import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { SentIcon, StopIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea'
import { ChatModelPicker } from './ChatModelPicker'
import type { ChatModelSelection } from '../../../shared/contracts/chat'

export function ChatComposer({
  input,
  onInput,
  onSend,
  onStop,
  busy,
  loading,
  modelLocked,
  selection,
  onSelection,
  textareaRef,
  actionRef,
  label,
  placeholder,
  sendLabel,
  stopLabel,
  mentions = false,
  children,
}: {
  input: string
  onInput: (input: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  loading?: boolean
  modelLocked?: boolean
  selection?: ChatModelSelection
  onSelection: (selection: ChatModelSelection) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  actionRef?: RefObject<HTMLButtonElement | null>
  label: string
  placeholder: string
  sendLabel: string
  stopLabel: string
  mentions?: boolean
  children?: ReactNode
}) {
  const composing = useRef(false)
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 176)}px`
  }, [input, textareaRef])
  const textareaProps = {
    'aria-label': label,
    placeholder,
    rows: 2,
    maxLength: 12000,
    disabled: loading,
    className:
      'min-h-16 max-h-44 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-1 py-2 text-sm shadow-none outline-none focus-visible:ring-0 dark:bg-transparent',
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composing.current) return
      event.preventDefault()
      if (!busy && !loading && !event.repeat && input.trim()) onSend()
    },
  }
  return (
    <form
      className="mx-auto w-full max-w-3xl rounded-xl border bg-muted/20 p-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && !loading && input.trim()) onSend()
      }}
    >
      {mentions ? (
        <RepositoryMentionTextarea
          {...textareaProps}
          textareaRef={textareaRef}
          popupPlacement="above"
          value={input}
          onValueChange={onInput}
        />
      ) : (
        <textarea
          {...textareaProps}
          ref={textareaRef}
          value={input}
          onChange={(event) => onInput(event.target.value)}
        />
      )}
      {children}
      <div className="mt-2 flex items-end gap-2">
        <ChatModelPicker selection={selection} onChange={onSelection} disabled={busy || loading || modelLocked} />
        <Button
          ref={actionRef}
          type={busy ? 'button' : 'submit'}
          variant={busy ? 'outline' : 'default'}
          aria-label={busy ? stopLabel : sendLabel}
          title={busy ? stopLabel : `${sendLabel} (Enter)`}
          className="size-10 shrink-0"
          disabled={!busy && (loading || !input.trim())}
          onClick={busy ? onStop : undefined}
        >
          <HugeiconsIcon icon={busy ? StopIcon : SentIcon} strokeWidth={2} className="size-4" />
        </Button>
      </div>
      <p className="mt-2 px-1 text-[10px] text-muted-foreground">
        Enter envia · Shift+Enter quebra linha{busy ? ' · Você pode preparar a próxima mensagem.' : ''}
      </p>
    </form>
  )
}
