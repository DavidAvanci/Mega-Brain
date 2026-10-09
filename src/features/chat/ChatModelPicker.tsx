import { useCallback, useEffect, useRef, useState } from 'react'
import { AppSelect } from '@/components/ui/select'
import { useCodexModels } from '@/features/settings/useCodexModels'
import { CLAUDE_MODELS } from '../../../shared/domain/chat-models'
import type { ChatModelSelection } from '../../../shared/contracts/chat'
import type { LlmProvider } from '../../../shared/domain/settings'

const DEFAULT_SELECTION: ChatModelSelection = { provider: 'claude', model: 'default' }
const PROVIDERS: { value: LlmProvider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'chatgpt', label: 'Codex' },
]

export function useChatModelSelection(cardId: string) {
  const [selection, setSelection] = useState<ChatModelSelection>()
  const edited = useRef(false)
  useEffect(() => {
    edited.current = false
    setSelection(undefined)
  }, [cardId])
  const choose = (value: ChatModelSelection) => {
    edited.current = true
    setSelection(value)
  }
  const restore = useCallback((value?: ChatModelSelection) => {
    if (!edited.current) setSelection(value ?? DEFAULT_SELECTION)
  }, [])
  return { selection, choose, restore }
}

export function ChatModelPicker({
  selection,
  onChange,
  disabled,
}: {
  selection?: ChatModelSelection
  onChange: (selection: ChatModelSelection) => void
  disabled?: boolean
}) {
  const { catalog, loading } = useCodexModels()
  const current = selection ?? DEFAULT_SELECTION
  const codex = current.provider === 'chatgpt'
  const models = [
    { value: 'default', label: 'Automático', description: 'Usa o modelo padrão da CLI.' },
    ...(codex ? catalog.models.map((model) => ({ value: model.id, label: model.label })) : CLAUDE_MODELS),
  ]
  if (!models.some((model) => model.value === current.model))
    models.unshift({ value: current.model, label: current.model, description: 'Modelo salvo fora do catálogo atual.' })
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap gap-1.5">
        <AppSelect
          ariaLabel="Provedor do chat"
          value={current.provider}
          options={PROVIDERS}
          disabled={disabled || !selection}
          onValueChange={(provider) => onChange({ provider, model: 'default' })}
          className="h-10 w-auto max-w-full border-transparent bg-transparent px-2 text-xs shadow-none"
        />
        <AppSelect
          ariaLabel="Modelo do chat"
          value={current.model}
          options={models}
          disabled={disabled || !selection || (codex && loading)}
          onValueChange={(model) => onChange({ ...current, model })}
          className="h-10 w-auto max-w-full border-transparent bg-transparent px-2 text-xs shadow-none"
        />
      </div>
      {codex && (
        <p className="px-2 text-[10px] text-muted-foreground">
          {loading
            ? 'Consultando modelos…'
            : catalog.source === 'fallback'
              ? 'Catálogo de referência · disponibilidade depende da sua conta.'
              : `Modelos do Codex${catalog.profileName ? ` · ${catalog.profileName}` : ''}`}
        </p>
      )}
    </div>
  )
}
