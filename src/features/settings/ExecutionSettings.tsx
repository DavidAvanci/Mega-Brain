import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { Tip } from '@/Tip'
import type { BoardSettings, MegaBrainSettings } from '../../../shared/domain/settings'
import {
  codexModelFor,
  EFFORT_DETAILS,
  supportedEfforts,
  type CodexModelCatalog,
} from '../../../shared/domain/codex-models'
import type { SettingsSectionProps } from './settings-form'
import { CodexProfilesSettings } from './CodexProfilesSettings'
import { ProviderSettings } from './ProviderSettings'
import { EffortScale } from './EffortScale'
import { CLAUDE_MODELS } from '../../../shared/domain/chat-models'

const STAGES: { key: keyof BoardSettings; title: string; description: string }[] = [
  { key: 'task-planning', title: 'Planejamento', description: 'Criação do plano e checklists.' },
  { key: 'run-task-checklist', title: 'Desenvolvimento', description: 'Execução dos itens de desenvolvimento.' },
  { key: 'run-test-checklist', title: 'Testes automáticos', description: 'Execução dos cenários de teste.' },
]

export function ExecutionSettings({
  settings,
  onGeneralChange,
  onStageChange,
  disabled,
  catalog,
  loading,
  onRefresh,
}: {
  settings: MegaBrainSettings
  onGeneralChange: SettingsSectionProps['onChange']
  onStageChange: (key: keyof BoardSettings, field: 'model' | 'effort', value: string) => void
  disabled?: boolean
  catalog: CodexModelCatalog
  loading: boolean
  onRefresh: () => void
}) {
  const codex = settings.general.llmProvider === 'chatgpt'
  const models = codex
    ? [
        {
          value: 'default',
          label: 'Automático',
        },
        ...catalog.models.map((model) => ({ value: model.id, label: model.label })),
      ]
    : CLAUDE_MODELS

  return (
    <div className="grid gap-6">
      <ProviderSettings value={settings.general} onChange={onGeneralChange} disabled={disabled} />
      <section className="grid gap-3" aria-label="Modelos de execução">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Modelos de execução</h3>
            <p className="text-xs text-muted-foreground">
              Modelo e intensidade de raciocínio usados em cada parte do fluxo.
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
        <div className="divide-y overflow-hidden rounded-lg border">
          {STAGES.map(({ key, title, description }) => {
            const stage = settings.stages[key]
            const modelOptions = models.some((model) => model.value === stage.model)
              ? models
              : [{ value: stage.model, label: `${stage.model} · salvo fora do catálogo` }, ...models]
            const efforts = supportedEfforts(settings.general.llmProvider, stage.model, catalog)
            return (
              <fieldset
                key={key}
                disabled={disabled || (codex && loading)}
                className="grid min-w-0 gap-4 p-4"
                data-settings-section={key}
              >
                <legend className="sr-only">{title}</legend>
                <div>
                  <h4 className="text-xs font-semibold">{title}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                </div>
                <div className="grid gap-4">
                  <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-3">
                    <label htmlFor={`model-${key}`} className="text-xs font-medium sm:pt-2.5">
                      Modelo
                    </label>
                    <div className="grid min-w-0 gap-2">
                      <AppSelect
                        id={`model-${key}`}
                        value={stage.model}
                        options={modelOptions}
                        ariaLabel={`Modelo para ${title}`}
                        describedBy={codex ? `model-help-${key}` : undefined}
                        className="h-9 rounded-md bg-muted/30 px-3 text-xs font-medium shadow-none"
                        disabled={disabled || (codex && loading)}
                        onValueChange={(model) => onStageChange(key, 'model', model)}
                      />
                      {codex && (
                        <p id={`model-help-${key}`} className="text-xs leading-relaxed text-muted-foreground">
                          {stage.model === 'default'
                            ? 'Usa o modelo padrão configurado no Codex para este perfil.'
                            : (codexModelFor(stage.model, catalog)?.description ??
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
              </fieldset>
            )
          })}
        </div>
      </section>
      <CodexProfilesSettings />
    </div>
  )
}
