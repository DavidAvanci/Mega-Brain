import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Attachment01Icon, SentIcon, StopIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea'
import { ChatModelPicker } from './ChatModelPicker'
import type { ChatModelSelection } from '../../../shared/contracts/chat'
import { Tip } from '@/Tip'

export interface ChatImageDraft {
  file: File
  preview: string
}

const IMAGE_LIMIT = 4
const IMAGE_BYTES_LIMIT = 5 * 1_048_576
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem'))
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem'))
    reader.readAsDataURL(file)
  })
}

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
  showKeyboardHint = true,
  children,
  images = [],
  onImagesChange,
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
  showKeyboardHint?: boolean
  children?: ReactNode
  images?: ChatImageDraft[]
  onImagesChange?: (images: ChatImageDraft[]) => void
}) {
  const composing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const addImages = async (files: File[]) => {
    if (!onImagesChange || !files.length) return
    const accepted = files.filter((file) => file.type.startsWith('image/'))
    const supported = accepted.filter((file) => IMAGE_TYPES.has(file.type))
    const rejection = accepted.length !== files.length
      ? 'Escolha imagens JPEG, PNG, GIF ou WebP.'
      : supported.length !== accepted.length
        ? 'Formato não suportado. Use JPEG, PNG, GIF ou WebP.'
        : null
    const totalSize = images.reduce((total, image) => total + image.file.size, 0) + supported.reduce((total, file) => total + file.size, 0)
    if (images.length + supported.length > IMAGE_LIMIT) {
      setAttachmentError('Anexe no máximo 4 imagens por mensagem.')
      return
    }
    if (totalSize > IMAGE_BYTES_LIMIT) {
      setAttachmentError('As imagens devem somar no máximo 5 MB.')
      return
    }
    try {
      const drafts = await Promise.all(supported.map(async (file) => ({ file, preview: await readImage(file) })))
      onImagesChange([...images, ...drafts])
      setAttachmentError(rejection)
    } catch (cause) {
      setAttachmentError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const dropFiles = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void addImages(Array.from(event.dataTransfer.files))
  }
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [input, textareaRef])
  const textareaProps = {
    'aria-label': label,
    placeholder,
    rows: 1,
    maxLength: 12000,
    disabled: loading,
    className:
      'min-h-0 w-full resize-none overflow-y-hidden rounded-none border-0 bg-transparent px-1 py-2 text-sm shadow-none outline-none focus-visible:ring-0 dark:bg-transparent',
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composing.current) return
      event.preventDefault()
      if (!busy && !loading && !event.repeat && (input.trim() || images.length)) onSend()
    },
  }
  return (
    <form
      className={`mx-auto w-full max-w-3xl rounded-xl border bg-muted/20 p-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 ${dragging ? 'border-primary bg-primary/5' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        if (Array.from(event.dataTransfer.types).includes('Files')) setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={dropFiles}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.items)
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file))
        if (files.length) {
          event.preventDefault()
          void addImages(files)
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && !loading && (input.trim() || images.length)) onSend()
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
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Imagens anexadas">
          {images.map((image, index) => (
            <div key={`${image.file.name}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border bg-background p-1.5">
              <img src={image.preview} alt={`Prévia de ${image.file.name}`} className="size-12 rounded-md object-cover" />
              <span className="max-w-28 truncate text-xs" title={image.file.name}>{image.file.name}</span>
              <Button type="button" variant="ghost" size="xs" aria-label={`Remover ${image.file.name}`} onClick={() => onImagesChange?.(images.filter((_, imageIndex) => imageIndex !== index))}>
                Remover
              </Button>
            </div>
          ))}
        </div>
      )}
      {attachmentError && <p className="mt-2 px-1 text-xs text-destructive" role="alert">{attachmentError}</p>}
      <div className="mt-2 flex items-end gap-2">
        <ChatModelPicker selection={selection} onChange={onSelection} disabled={busy || loading || modelLocked} />
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="sr-only"
          aria-label="Selecionar imagens para anexar"
          onChange={(event) => {
            void addImages(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ''
          }}
        />
        <Tip label="Anexar imagem">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-10"
            aria-label="Anexar imagem"
            disabled={busy || loading}
            onClick={() => fileInput.current?.click()}
          >
            <HugeiconsIcon icon={Attachment01Icon} size={16} />
          </Button>
        </Tip>
        {children}
        <Button
          ref={actionRef}
          type={busy ? 'button' : 'submit'}
          variant={busy ? 'outline' : 'default'}
          aria-label={busy ? stopLabel : sendLabel}
          title={busy ? stopLabel : `${sendLabel} (Enter)`}
          className="size-10 shrink-0"
          disabled={!busy && (loading || (!input.trim() && !images.length))}
          onClick={busy ? onStop : undefined}
        >
          <HugeiconsIcon icon={busy ? StopIcon : SentIcon} strokeWidth={2} className="size-4" />
        </Button>
      </div>
      {showKeyboardHint && (
        <p className="mt-2 px-1 text-[10px] text-muted-foreground">
          Enter envia · Shift+Enter quebra linha{busy ? ' · Você pode preparar a próxima mensagem.' : ''}
        </p>
      )}
    </form>
  )
}
