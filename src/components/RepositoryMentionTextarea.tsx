import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
} from 'react'
import { Textarea } from '@/components/ui/textarea'
import { useRepositoryMentions } from '@/features/repositories/useRepositoryMentions'
import { cn } from '@/lib/utils'
import type { RepositoryMention } from '../../shared/domain/repositories'
import { mentionAtCursor, replaceMention } from './repository-mention-text'

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  popupPlacement?: 'above' | 'below'
  textareaRef?: Ref<HTMLTextAreaElement>
}

export function RepositoryMentionTextarea({
  value,
  onValueChange,
  onKeyDown,
  onClick,
  onSelect,
  onBlur,
  className,
  popupPlacement = 'below',
  textareaRef,
  ...props
}: Props) {
  const { repositories, error, loading } = useRepositoryMentions()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const listbox = useRef<HTMLDivElement>(null)
  const selection = useRef<number | null>(null)
  const listId = useId()
  const [cursor, setCursor] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const match = cursor === null || dismissed ? null : mentionAtCursor(value, cursor)
  const suggestions = match
    ? repositories
        .filter((repository) =>
          `${repository.alias} ${repository.displayName}`
            .toLocaleLowerCase('pt-BR')
            .includes(match.query.toLocaleLowerCase('pt-BR')),
        )
        .slice(0, 8)
    : []
  const open = suggestions.length > 0
  const popupClass = popupPlacement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
  const hint =
    match && !open ? (error ?? (loading ? 'Carregando repositórios…' : 'Nenhum repositório encontrado')) : null

  useLayoutEffect(() => {
    if (selection.current === null) return
    textarea.current?.focus()
    textarea.current?.setSelectionRange(selection.current, selection.current)
    selection.current = null
  }, [value])

  useEffect(() => {
    if (open) listbox.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const choose = (repository: RepositoryMention) => {
    if (!match) return
    const next = replaceMention(value, match, repository.alias)
    selection.current = next.cursor
    setCursor(next.cursor)
    setDismissed(true)
    onValueChange(next.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
      return
    }
    if (open && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      event.stopPropagation()
      choose(suggestions[active] ?? suggestions[0])
      return
    }
    if (open && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
      return
    }
    onKeyDown?.(event)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        {...props}
        ref={(element) => {
          textarea.current = element
          if (typeof textareaRef === 'function') textareaRef(element)
          else if (textareaRef) textareaRef.current = element
        }}
        value={value}
        className={cn(className)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setCursor(event.currentTarget.selectionStart)
          setDismissed(false)
          setActive(0)
          onValueChange(event.currentTarget.value)
        }}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          setCursor(event.currentTarget.selectionStart)
          setDismissed(false)
          setActive(0)
          onClick?.(event)
        }}
        onSelect={(event) => {
          setCursor(event.currentTarget.selectionStart)
          onSelect?.(event)
        }}
        onBlur={(event) => {
          setCursor(null)
          onBlur?.(event)
        }}
      />
      {hint && (
        <p
          role="status"
          className={cn(
            'absolute z-50 w-full rounded-md border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-md',
            popupClass,
          )}
        >
          {hint}
        </p>
      )}
      {open && (
        <div
          ref={listbox}
          id={listId}
          role="listbox"
          aria-label="Repositórios"
          className={cn(
            'absolute z-50 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md',
            popupClass,
          )}
        >
          {suggestions.map((repository, index) => (
            <div
              key={repository.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                'cursor-pointer rounded px-2 py-1 text-sm',
                index === active && 'bg-accent text-accent-foreground',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(repository)}
            >
              <span className="font-medium">@{repository.alias}</span>
              <span className="ml-2 text-muted-foreground">{repository.displayName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
