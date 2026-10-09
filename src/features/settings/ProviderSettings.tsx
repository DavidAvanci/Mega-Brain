import { Button } from '@/components/ui/button'
import type { LlmProvider } from '../../../shared/domain/settings'
import type { SettingsSectionProps } from './settings-form'

const PROVIDERS: { value: LlmProvider; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude Code', description: 'Usa o Claude Code e os modelos configurados por etapa.' },
  { value: 'chatgpt', label: 'Codex', description: 'Usa o Codex CLI e a conta autenticada no ambiente.' },
]

export function ProviderSettings({ value, onChange, disabled }: SettingsSectionProps) {
  return (
    <section className="grid gap-3" aria-label="Provedor de IA" data-settings-section="provider">
      <div>
        <h3 className="text-sm font-medium">Provedor de IA</h3>
        <p className="text-xs text-muted-foreground">
          Escolha a CLI usada para executar agentes e conversar nos cards.
        </p>
      </div>
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1" role="group" aria-label="Provedor de IA">
        {PROVIDERS.map((provider) => (
          <Button
            key={provider.value}
            type="button"
            variant={value.llmProvider === provider.value ? 'outline' : 'ghost'}
            size="sm"
            className="flex-1"
            aria-pressed={value.llmProvider === provider.value}
            disabled={disabled}
            onClick={() => onChange({ ...value, llmProvider: provider.value })}
          >
            {provider.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {PROVIDERS.find((provider) => provider.value === value.llmProvider)?.description}
      </p>
    </section>
  )
}
