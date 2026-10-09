import { Input } from '@/components/ui/input'
import type { SettingsSectionProps } from './settings-form'

export function JiraSettings({ value, onChange, disabled }: SettingsSectionProps) {
  const update = (patch: Partial<typeof value>) => onChange({ ...value, ...patch })
  return (
    <section className="grid gap-3" aria-label="Jira" data-settings-section="jira">
      <div>
        <h3 className="text-sm font-medium">Jira</h3>
        <p className="text-xs text-muted-foreground">
          Sincroniza automaticamente o status dos cards que usam uma chave Jira.
        </p>
      </div>
      <label className="grid gap-1 text-xs font-medium">
        Site
        <Input
          value={value.jiraSite}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => update({ jiraSite: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        E-mail
        <Input
          type="email"
          value={value.jiraEmail}
          disabled={disabled}
          autoComplete="username"
          spellCheck={false}
          onChange={(event) => update({ jiraEmail: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Token da API
        <Input
          type="password"
          value={value.jiraApiToken}
          disabled={disabled}
          placeholder={value.jiraConfigured ? 'Configurado — deixe vazio para manter' : 'Cole o token da API'}
          autoComplete="new-password"
          onChange={(event) => update({ jiraApiToken: event.target.value })}
        />
        <span className="font-normal text-muted-foreground">
          {value.jiraConfigured
            ? 'Integração configurada. Limpe site e e-mail para desativar.'
            : 'Os três campos são obrigatórios para ativar a integração.'}
        </span>
      </label>
    </section>
  )
}
