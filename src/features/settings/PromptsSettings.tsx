import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { PromptSettings } from '../../../shared/domain/settings'
import { PromptMarkdownEditor } from './PromptMarkdownEditor'

export const PROMPT_FIELDS: { key: keyof PromptSettings; label: string; title: string; help: string }[] = [
  {
    key: 'taskPlanning',
    label: 'Planejamento',
    title: 'Planejamento',
    help: 'Instruções usadas ao criar o plano e os checklists da task.',
  },
  {
    key: 'taskItem',
    label: 'Tarefas',
    title: 'Execução de tarefas',
    help: 'Instruções usadas para implementar cada item do checklist.',
  },
  {
    key: 'testEnvironment',
    label: 'Ambiente',
    title: 'Ambiente de testes',
    help: 'Instruções do agente aberto para preparar o ambiente local.',
  },
  {
    key: 'smartDiffReview',
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
}: {
  value: PromptSettings
  onChange: (value: PromptSettings) => void
  tab: keyof PromptSettings
  onTabChange: (tab: keyof PromptSettings) => void
  disabled?: boolean
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <p className="text-xs text-muted-foreground">
        Prompts enviados em cada etapa do Mega Brain, salvos aqui e compartilhados entre Claude e Codex.
      </p>
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
        {PROMPT_FIELDS.map(({ key, title, help }) => (
          <TabsContent key={key} value={key} keepMounted data-settings-section={`prompt-${key}`}>
            <div className="mb-3 grid gap-1">
              <h3 className="text-sm font-medium">{title}</h3>
              <p className="text-xs text-muted-foreground">{help}</p>
            </div>
            <PromptMarkdownEditor
              title={title}
              value={value?.[key] ?? ''}
              onChange={(next) => onChange({ ...value, [key]: next })}
              disabled={disabled}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
