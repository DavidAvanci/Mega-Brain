import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FolderOpenIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchDetectedEditors } from './features/cards/api/card-detail-api'
import { isTauriDesktop, pickDesktopWslDirectory } from './desktopBootstrap'
import type { EditorDiscovery, EditorPreference, GeneralSettings, LlmProvider } from '../shared/domain/settings'

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

const PROVIDERS: { value: LlmProvider; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude', description: 'Usa o Claude Code e os modelos configurados por etapa.' },
  { value: 'chatgpt', label: 'ChatGPT', description: 'Usa o Codex CLI e a conta autenticada no ambiente.' },
]

function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T
  options: { value: T; label: string; available?: boolean }[]
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className="flex flex-wrap rounded-lg border bg-muted p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? 'default' : 'ghost'}
          aria-pressed={value === option.value}
          className={`min-w-24 flex-1 ${value === option.value ? 'shadow-sm' : 'text-muted-foreground'}`}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.available === true && <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />}
          {option.label}
          {option.available === false ? ' · indisponível' : ''}
        </Button>
      ))}
    </div>
  )
}

export function GeneralSettingsForm({
  value,
  onChange,
  disabled,
  initialEditors,
}: {
  value: GeneralSettings
  onChange: (value: GeneralSettings) => void
  disabled?: boolean
  initialEditors: EditorDiscovery
}) {
  const [discovery, setDiscovery] = useState(initialEditors)
  const [detecting, setDetecting] = useState(false)
  const [detectionError, setDetectionError] = useState<string | null>(null)
  const [pickingDirectory, setPickingDirectory] = useState<'workspace' | 'worktrees' | null>(null)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const update = (patch: Partial<GeneralSettings>) => onChange({ ...value, ...patch })
  const detectedEditor = discovery.editors.find((option) => option.id === value.editor)
  const editorOptions: { value: EditorPreference; label: string; available?: boolean }[] = discovery.editors.map(
    (option) => ({ value: option.id, label: option.label, available: true }),
  )
  if (value.editor !== 'custom' && !detectedEditor)
    editorOptions.push({ value: value.editor, label: EDITOR_LABELS[value.editor], available: false })
  editorOptions.push({ value: 'custom', label: 'Outro' })
  const provider = PROVIDERS.find((option) => option.value === value.llmProvider)!

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

  const pickDirectory = async (kind: 'workspace' | 'worktrees') => {
    setPickingDirectory(kind)
    setDirectoryError(null)
    try {
      const selected = await pickDesktopWslDirectory(kind)
      if (selected) update(kind === 'workspace' ? { workspaceDir: selected } : { worktreesDir: selected })
    } catch (cause) {
      setDirectoryError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPickingDirectory(null)
    }
  }

  const desktop = isTauriDesktop()

  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Editor</h3>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled || detecting}
              onClick={() => void refreshEditors()}
            >
              {detecting ? 'Verificando…' : 'Verificar novamente'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Editores detectados em {discovery.scope}. O ponto verde indica que o aplicativo está disponível.
          </p>
        </div>
        <ToggleGroup
          value={value.editor}
          options={editorOptions}
          label="Editor de código"
          disabled={disabled}
          onChange={(next) => update({ editor: next })}
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

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-medium">Diretórios</h3>
          <p className="text-xs text-muted-foreground">
            Use caminhos absolutos no ambiente onde o backend está rodando.
          </p>
        </div>
        <label className="grid gap-1 text-xs font-medium">
          Workspace dos cards
          <div className="flex">
            <Input
              value={value.workspaceDir}
              disabled={disabled || pickingDirectory !== null}
              spellCheck={false}
              className={desktop ? 'rounded-r-none' : undefined}
              onChange={(event) => update({ workspaceDir: event.target.value })}
            />
            {desktop && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="-ml-px shrink-0 rounded-l-none"
                aria-label="Escolher workspace no Windows"
                disabled={disabled || pickingDirectory !== null}
                onClick={() => void pickDirectory('workspace')}
              >
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
              </Button>
            )}
          </div>
          <span className="font-normal text-muted-foreground">
            Cada card será armazenado como uma pasta neste diretório.
          </span>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Raiz das worktrees
          <div className="flex">
            <Input
              value={value.worktreesDir}
              disabled={disabled || pickingDirectory !== null}
              spellCheck={false}
              className={desktop ? 'rounded-r-none' : undefined}
              onChange={(event) => update({ worktreesDir: event.target.value })}
            />
            {desktop && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="-ml-px shrink-0 rounded-l-none"
                aria-label="Escolher raiz das worktrees no Windows"
                disabled={disabled || pickingDirectory !== null}
                onClick={() => void pickDirectory('worktrees')}
              >
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
              </Button>
            )}
          </div>
          <span className="font-normal text-muted-foreground">
            Worktrees temporárias e repositórios vinculados serão criados aqui.
          </span>
        </label>
        {directoryError && <p className="text-[11px] text-destructive">{directoryError}</p>}
      </section>

      <section className="grid gap-2">
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
            placeholder="takeat ou takeat.atlassian.net"
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
            placeholder="voce@empresa.com"
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

      <section className="grid gap-2">
        <div>
          <h3 className="text-sm font-medium">Provedor de IA</h3>
          <p className="text-xs text-muted-foreground">
            Escolha a CLI usada para executar agentes e conversar nos cards.
          </p>
        </div>
        <ToggleGroup
          value={value.llmProvider}
          options={PROVIDERS}
          label="Provedor de IA"
          disabled={disabled}
          onChange={(next) => update({ llmProvider: next })}
        />
        <p className="text-[11px] text-muted-foreground">{provider.description}</p>
      </section>
    </div>
  )
}
