import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { DEFAULT_PROMPTS, type BoardSettings, type PromptSettings } from '../../../shared/domain/settings'
import { PromptMarkdownEditor } from './PromptMarkdownEditor'

export const PROMPT_FIELDS: {
  key: keyof PromptSettings
  stage: keyof BoardSettings
  label: string
  title: string
  help: string
}[] = [
  {
    key: 'taskPlanning',
    stage: 'task-planning',
    label: 'Planejamento',
    title: 'Planejamento',
    help: 'Instruções usadas ao criar o plano e os checklists da task.',
  },
  {
    key: 'taskItem',
    stage: 'run-task-checklist',
    label: 'Tarefas',
    title: 'Execução de tarefas',
    help: 'Instruções usadas para implementar cada item do checklist.',
  },
  {
    key: 'taskVerification',
    stage: 'task-verification',
    label: 'Verificador',
    title: 'Verificador',
    help: 'Verifica os arquivos alterados pelos executores e indica tarefas de correção quando necessário.',
  },
  {
    key: 'testEnvironment',
    stage: 'test-environment',
    label: 'Ambiente',
    title: 'Ambiente de testes',
    help: 'Instruções do agente aberto para preparar o ambiente local.',
  },
  {
    key: 'smartDiffReview',
    stage: 'smart-diff-review',
    label: 'Smart Diff',
    title: 'Revisão Smart Diff',
    help: 'Instruções usadas ao gerar uma revisão Smart Diff.',
  },
]

export function PromptsSettings({
  value,
  onChange,
  tab,
  onTabChange,
  disabled,
  renderModel,
}: {
  value: PromptSettings
  onChange: (value: PromptSettings) => void
  tab: keyof PromptSettings
  onTabChange: (tab: keyof PromptSettings) => void
  disabled?: boolean
  renderModel?: (field: (typeof PROMPT_FIELDS)[number]) => ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          const field = PROMPT_FIELDS.find((field) => field.key === next)
          if (field) onTabChange(field.key)
        }}
        className="min-w-0 gap-4"
      >
        <TabsList
          aria-label="Prompts de execução"
          className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg p-1 group-data-horizontal/tabs:h-auto group-data-vertical/tabs:h-auto group-data-vertical/tabs:flex-row"
        >
          {PROMPT_FIELDS.map(({ key, label, title }) => (
            <TabsTrigger
              key={key}
              value={key}
              title={title}
              disabled={disabled}
              className="h-8 flex-none px-3 text-xs group-data-vertical/tabs:w-auto group-data-vertical/tabs:justify-center"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {PROMPT_FIELDS.map((field) => {
          const { key, title, help } = field
          return (
            <TabsContent key={key} value={key} keepMounted data-settings-section={`prompt-${key}`}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="grid min-w-0 flex-1 basis-48 gap-1">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="text-xs text-muted-foreground">{help}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={disabled || value[key].trim() === DEFAULT_PROMPTS[key].trim()}
                  onClick={() => onChange({ ...value, [key]: DEFAULT_PROMPTS[key] })}
                >
                  Restaurar padrão
                </Button>
              </div>
              {renderModel?.(field)}
              <PromptMarkdownEditor
                title={title}
                value={value?.[key] ?? ''}
                onChange={(next) => onChange({ ...value, [key]: next })}
                disabled={disabled}
              />
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
