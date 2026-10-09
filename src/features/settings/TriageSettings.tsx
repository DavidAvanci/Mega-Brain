import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import type { SettingsSectionProps } from './settings-form'

export function TriageSettings({ value, onChange, disabled }: SettingsSectionProps) {
  const update = (patch: Partial<typeof value>) => onChange({ ...value, ...patch })
  return (
    <section className="grid gap-3" aria-label="Triagem de cards" data-settings-section="triage">
      <h3 className="text-sm font-medium">Triagem de cards (experimental)</h3>
      <p className="text-xs text-muted-foreground">
        Ao solicitar uma análise com Jev, título e descrição são enviados à API da TypeSafe por HTTPS.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={value.jevEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => update({ jevEnabled: checked })}
        />
        Habilitar Jev
      </label>
      <label className="grid gap-1 text-xs font-medium">
        URL da API TypeSafe
        <Input
          type="url"
          value={value.jevBaseUrl}
          disabled={disabled}
          spellCheck={false}
          placeholder="https://api.typesafe.ai"
          onChange={(event) => update({ jevBaseUrl: event.target.value })}
        />
        <span className="font-normal text-muted-foreground">
          Deixe vazio para usar https://api.typesafe.ai. Informe apenas a origem HTTPS, sem /v1/systemone.
        </span>
      </label>
      {value.jevUrlSource === 'environment' && (
        <p className="text-[11px] text-muted-foreground">
          {value.jevActiveBaseUrl
            ? `TYPESAFE_BASE_URL tem precedência: ${value.jevActiveBaseUrl}`
            : 'TYPESAFE_BASE_URL inválida; corrija a variável no backend.'}
        </p>
      )}
      <label className="grid gap-1 text-xs font-medium">
        Chave da API TypeSafe
        <Input
          type="password"
          value={value.jevApiKey ?? ''}
          disabled={disabled}
          autoComplete="new-password"
          placeholder={
            value.jevCredentialSource !== 'none' ? 'Chave cadastrada — deixe vazio para manter' : 'Cole sua chave'
          }
          onChange={(event) => update({ jevApiKey: event.target.value, jevRemoveSavedKey: false })}
        />
      </label>
      <p className="text-[11px] text-muted-foreground">
        {value.jevCredentialSource === 'environment'
          ? 'Configurada por TYPESAFE_API_KEY (tem precedência).'
          : value.jevCredentialSource !== 'none'
            ? 'Chave cadastrada; conexão ainda não validada.'
            : 'Nenhuma chave cadastrada.'}
      </p>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={value.jevRemoveSavedKey ?? false}
          disabled={disabled}
          onCheckedChange={(checked) => update({ jevRemoveSavedKey: checked, jevApiKey: '' })}
        />
        Remover chave salva ao salvar
      </label>
    </section>
  )
}
