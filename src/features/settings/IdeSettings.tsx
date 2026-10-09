import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/ui/select'
import { Tip } from '@/Tip'
import { fetchDetectedEditors } from '@/features/cards/api/card-detail-api'
import type { EditorDiscovery, EditorPreference, GeneralSettingsInput } from '../../../shared/domain/settings'
import type { SettingsSectionProps } from './settings-form'

const EDITOR_LABELS: Record<EditorPreference, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
  windsurf: 'Windsurf',
  zed: 'Zed',
  sublime: 'Sublime Text',
  intellij: 'IntelliJ IDEA',
  webstorm: 'WebStorm',
  pycharm: 'PyCharm',
  custom: 'Outro',
}

export function IdeSettings({
  value,
  onChange,
  disabled,
  initialEditors,
}: SettingsSectionProps & { initialEditors: EditorDiscovery }) {
  const [discovery, setDiscovery] = useState(initialEditors)
  const [detecting, setDetecting] = useState(false)
  const [detectionError, setDetectionError] = useState<string | null>(null)
  const update = (patch: Partial<GeneralSettingsInput>) => onChange({ ...value, ...patch })
  const detectedEditor = discovery.editors.find((option) => option.id === value.editor)
  const editorOptions: { value: EditorPreference; label: string }[] = discovery.editors.map((option) => ({
    value: option.id,
    label: `${option.label} · disponível`,
  }))
  if (value.editor !== 'custom' && !detectedEditor)
    editorOptions.push({ value: value.editor, label: `${EDITOR_LABELS[value.editor]} · não detectado` })
  editorOptions.push({ value: 'custom', label: 'Outro' })
  const refreshEditors = async () => {
    setDetecting(true)
    setDetectionError(null)
    try {
      setDiscovery(await fetchDetectedEditors())
    } catch (cause) {
      setDetectionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDetecting(false)
    }
  }

  return (
    <section className="grid gap-3" aria-label="IDEs" data-settings-section="ides">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">IDEs</h3>
          <Tip label={detecting ? 'Verificando IDEs…' : 'Verificar IDEs novamente'}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Verificar IDEs novamente"
              disabled={disabled || detecting}
              onClick={() => void refreshEditors()}
            >
              <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
            </Button>
          </Tip>
        </div>
        <p className="text-xs text-muted-foreground">
          Escolha a IDE usada para abrir os cards. Aplicativos detectados em {discovery.scope}.
        </p>
      </div>

      <AppSelect
        value={value.editor}
        options={editorOptions}
        ariaLabel="Editor de código"
        disabled={disabled}
        onValueChange={(editor) => update({ editor })}
      />
      {detectedEditor && (
        <p className="break-all text-[11px] text-muted-foreground">Detectado: {detectedEditor.command}</p>
      )}
      {value.editor !== 'custom' && !detectedEditor && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Este editor não foi encontrado. Escolha um dos detectados ou use “Outro”.
        </p>
      )}
      {detectionError && <p className="text-[11px] text-destructive">{detectionError}</p>}
      {value.editor === 'custom' && (
        <label className="grid gap-1 text-xs font-medium">
          Executável do editor
          <Input
            value={value.editorCommand}
            disabled={disabled}
            placeholder="/caminho/para/editor ou comando"
            onChange={(event) => update({ editorCommand: event.target.value })}
          />
        </label>
      )}
    </section>
  )
}
