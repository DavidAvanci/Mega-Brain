import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FolderOpenIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isTauriDesktop, pickDesktopWslDirectory } from '@/desktopBootstrap'
import type { GeneralSettingsInput } from '../../../shared/domain/settings'
import type { SettingsSectionProps } from './settings-form'

export function DirectorySettings({ value, onChange, disabled }: SettingsSectionProps) {
  const [pickingDirectory, setPickingDirectory] = useState<'workspace' | 'worktrees' | null>(null)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const update = (patch: Partial<GeneralSettingsInput>) => onChange({ ...value, ...patch })
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
    <section className="grid gap-3" aria-label="Diretórios" data-settings-section="directories">
      <div>
        <h3 className="text-sm font-medium">Diretórios</h3>
        <p className="text-xs text-muted-foreground">Use caminhos absolutos no ambiente onde o backend está rodando.</p>
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
              aria-label="Escolher workspace"
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
              aria-label="Escolher raiz das worktrees"
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
  )
}
