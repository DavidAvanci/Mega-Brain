import { useRef } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AppSelect } from '@/components/ui/select'
import { Tip } from '@/Tip'
import type { BoardSettings, MegaBrainSettings, PromptSettings } from '../../../shared/domain/settings'
import {
  codexModelFor,
  defaultStageSettings,
  EFFORT_DETAILS,
  supportedEfforts,
  type CodexModelCatalog,
} from '../../../shared/domain/codex-models'
import type { SettingsSectionProps } from './settings-form'
import { CodexProfilesSettings } from './CodexProfilesSettings'
import { ProviderSettings } from './ProviderSettings'
import { EffortScale } from './EffortScale'
import { CLAUDE_MODELS } from '../../../shared/domain/chat-models'
import { PromptsSettings } from './PromptsSettings'
import { withSettingsDefaults } from '@/settings-state'
import { JEV_PLANNING_MODEL } from '../../../shared/domain/planning-selection'

export function ExecutionSettings({
  settings,
  onGeneralChange,
  onStageChange,
  onPromptsChange,
  promptTab,
  onPromptTabChange,
  disabled,
  catalog,
  loading,
  onRefresh,
}: {
  settings: MegaBrainSettings
  onGeneralChange: SettingsSectionProps['onChange']
  onStageChange: (
    key: keyof BoardSettings,
    field: keyof BoardSettings[keyof BoardSettings],
    value: string | boolean,
  ) => void
  onPromptsChange: (prompts: PromptSettings) => void
  promptTab: keyof PromptSettings
  onPromptTabChange: (tab: keyof PromptSettings) => void
  disabled?: boolean
  catalog: CodexModelCatalog
  loading: boolean
  onRefresh: () => void
}) {
  const manualPlanningModels = useRef<Record<string, string>>({})
  const normalized = withSettingsDefaults(settings, catalog)
  const codex = settings.general.llmProvider === 'chatgpt'
  const models = codex
    ? [
        {
          value: 'default',
          label: 'Automático',
        },
        ...catalog.models.map((model) => ({ value: model.id, label: model.label })),
      ]
    : [{ value: 'default', label: 'Automático' }, ...CLAUDE_MODELS]

  return (
    <div className="grid min-w-0 gap-6">
      <ProviderSettings value={settings.general} onChange={onGeneralChange} disabled={disabled} />
      <section className="grid min-w-0 gap-3" aria-label="Prompts e modelos">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Prompts e modelos</h3>
            <p className="text-xs text-muted-foreground">
              Escolha o agente para editar seu prompt, modelo e esforço de raciocínio.
            </p>
          </div>
          {codex && (
            <Tip label="Atualizar modelos do Codex">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Atualizar modelos do Codex"
                onClick={onRefresh}
                disabled={loading || disabled}
              >
                <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
              </Button>
            </Tip>
          )}
        </div>
        {codex && (
          <p className="text-xs text-muted-foreground" role="status">
            {loading
              ? 'Consultando modelos do Codex…'
              : catalog.source === 'codex'
                ? `Modelos e efforts informados pelo Codex${catalog.profileName ? ` · ${catalog.profileName}` : ''}.`
                : 'Catálogo de referência: não foi possível consultar o Codex. A disponibilidade depende da conta e da versão instalada.'}
          </p>
        )}
        <PromptsSettings
          value={normalized.prompts}
          onChange={onPromptsChange}
          tab={promptTab}
          onTabChange={onPromptTabChange}
          disabled={disabled}
          renderModel={({ stage: key, title }) => {
            const stage = normalized.stages[key]
            const jevSelected = key === 'task-planning' && stage.model === JEV_PLANNING_MODEL
            const useJev = jevSelected && settings.general.jevEnabled
            const model = jevSelected
              ? defaultStageSettings(settings.general.llmProvider, catalog)['task-planning'].model
              : stage.model
            const modelOptions = models.some((option) => option.value === model)
              ? models
              : [{ value: model, label: `${model} · salvo fora do catálogo` }, ...models]
            const efforts = supportedEfforts(settings.general.llmProvider, model, catalog)
            return (
              <fieldset
                disabled={disabled || (codex && loading)}
                className="mb-4 grid min-w-0 gap-4 border-y py-4"
                data-settings-section={key}
              >
                <legend className="sr-only">{title}</legend>
                {key === 'task-planning' && settings.general.jevEnabled && (
                  <div className="grid gap-2">
                    <label className="flex w-fit items-center gap-2 text-xs font-medium">
                      <Checkbox
                        checked={useJev}
                        disabled={disabled || (codex && loading)}
                        aria-describedby={`jev-help-${key}`}
                        onCheckedChange={(checked) => {
                          const provider = settings.general.llmProvider
                          if (checked) manualPlanningModels.current[provider] = model
                          onStageChange(
                            key,
                            'model',
                            checked ? JEV_PLANNING_MODEL : (manualPlanningModels.current[provider] ?? model),
                          )
                        }}
                      />
                      Usar o Jev
                    </label>
                    <p id={`jev-help-${key}`} className="text-xs leading-relaxed text-muted-foreground">
                      O Jev escolhe o modelo e o effort com duas perguntas independentes antes de cada planejamento.
                      Título e descrição são enviados à TypeSafe.
                    </p>
                  </div>
                )}
                {jevSelected && !settings.general.jevEnabled && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    O Jev está desabilitado. O planejamento usará o modelo padrão da etapa e o effort salvo.
                  </p>
                )}
                {!useJev && (
                  <div className="grid gap-4">
                    <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-3">
                      <label htmlFor={`model-${key}`} className="text-xs font-medium sm:pt-2.5">
                        Modelo
                      </label>
                      <div className="grid min-w-0 gap-2">
                        <AppSelect
                          id={`model-${key}`}
                          value={model}
                          options={modelOptions}
                          ariaLabel={`Modelo para ${title}`}
                          describedBy={codex ? `model-help-${key}` : undefined}
                          className="h-9 rounded-md bg-muted/30 px-3 text-xs font-medium shadow-none"
                          disabled={disabled || (codex && loading)}
                          onValueChange={(model) => onStageChange(key, 'model', model)}
                        />
                        {codex && (
                          <p id={`model-help-${key}`} className="text-xs leading-relaxed text-muted-foreground">
                            {model === 'default'
                              ? 'Usa o modelo padrão configurado no Codex para este perfil.'
                              : (codexModelFor(model, catalog)?.description ??
                                'Modelo salvo fora do catálogo atual. Verifique se ele está disponível neste perfil.')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-3">
                      <span className="text-xs font-medium sm:pt-3">Esforço</span>
                      <div className="grid min-w-0 gap-2">
                        <EffortScale
                          value={stage.effort}
                          options={efforts}
                          label={`Effort para ${title}`}
                          describedBy={`effort-help-${key}`}
                          disabled={disabled || (codex && loading)}
                          onChange={(effort) => onStageChange(key, 'effort', effort)}
                        />
                        <p id={`effort-help-${key}`} className="text-xs leading-relaxed text-muted-foreground">
                          {efforts.includes(stage.effort)
                            ? EFFORT_DETAILS[stage.effort].description
                            : 'O effort salvo não é suportado pelo modelo. Selecione uma das opções disponíveis.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </fieldset>
            )
          }}
        />
      </section>
      {codex && <CodexProfilesSettings />}
    </div>
  )
}
