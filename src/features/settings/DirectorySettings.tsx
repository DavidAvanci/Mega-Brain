import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FolderOpenIcon, LinkSquare01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isTauriDesktop, pickDesktopWslDirectory } from '@/desktopBootstrap'
import { Tip } from '@/Tip'
import { requestJson } from '@/shared/api/request-json'
import type { GeneralSettingsInput } from '../../../shared/domain/settings'
import type { SettingsSectionProps } from './settings-form'

export function DirectorySettings({ value, onChange, disabled }: SettingsSectionProps) {
  const [pickingDirectory, setPickingDirectory] = useState<'workspace' | 'worktrees' | null>(null)
  const [openingDirectory, setOpeningDirectory] = useState<'workspace' | 'worktrees' | 'knowledge' | null>(null)
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
  const busy = disabled || pickingDirectory !== null || openingDirectory !== null
  const directoryPaths = {
    workspace: value.workspaceDir,
    worktrees: value.worktreesDir,
    knowledge: value.knowledgeDir ?? '',
  }
  const openDirectory = async (kind: keyof typeof directoryPaths) => {
    setOpeningDirectory(kind)
    setDirectoryError(null)
    try {
      await requestJson('/api/workspace/settings/open-directory', 'Falha ao abrir a pasta', {
        method: 'POST',
        body: { path: directoryPaths[kind] },
      })
    } catch (cause) {
      setDirectoryError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpeningDirectory(null)
    }
  }

  return (
    <section className="grid min-w-0 gap-3" aria-label="Diretórios" data-settings-section="directories">
      <div>
        <h3 className="text-sm font-medium">Diretórios</h3>
        <p className="text-xs text-muted-foreground">Use caminhos absolutos no ambiente onde o backend está rodando.</p>
      </div>
      <div className="grid min-w-0 gap-1 text-xs font-medium">
        <label htmlFor="settings-workspace-directory">Workspace dos cards</label>
        <div className="flex min-w-0 gap-2">
          <div className="flex min-w-0 flex-1">
            <Input
              id="settings-workspace-directory"
              value={value.workspaceDir}
              disabled={busy}
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
                disabled={busy}
                onClick={() => void pickDirectory('workspace')}
              >
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
              </Button>
            )}
          </div>
          <Tip label={openingDirectory === 'workspace' ? 'Abrindo pasta…' : 'Abrir workspace dos cards'}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Abrir workspace dos cards"
              disabled={busy || !value.workspaceDir.trim()}
              onClick={() => void openDirectory('workspace')}
            >
              <HugeiconsIcon icon={LinkSquare01Icon} strokeWidth={2} />
            </Button>
          </Tip>
        </div>
        <span className="font-normal text-muted-foreground">
          Cada card será armazenado como uma pasta neste diretório.
        </span>
      </div>
      <div className="grid min-w-0 gap-1 text-xs font-medium">
        <label htmlFor="settings-worktrees-directory">Raiz das worktrees</label>
        <div className="flex min-w-0 gap-2">
          <div className="flex min-w-0 flex-1">
            <Input
              id="settings-worktrees-directory"
              value={value.worktreesDir}
              disabled={busy}
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
                disabled={busy}
                onClick={() => void pickDirectory('worktrees')}
              >
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
              </Button>
            )}
          </div>
          <Tip label={openingDirectory === 'worktrees' ? 'Abrindo pasta…' : 'Abrir raiz das worktrees'}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Abrir raiz das worktrees"
              disabled={busy || !value.worktreesDir.trim()}
              onClick={() => void openDirectory('worktrees')}
            >
              <HugeiconsIcon icon={LinkSquare01Icon} strokeWidth={2} />
            </Button>
          </Tip>
        </div>
        <span className="font-normal text-muted-foreground">
          Worktrees temporárias e repositórios vinculados serão criados aqui.
        </span>
      </div>
      <div className="grid min-w-0 gap-1 text-xs font-medium">
        <label htmlFor="settings-knowledge-directory">Workspace do conhecimento</label>
        <div className="flex min-w-0 gap-2">
          <Input
            id="settings-knowledge-directory"
            value={directoryPaths.knowledge}
            readOnly
            disabled={busy}
            spellCheck={false}
            className="min-w-0 flex-1"
            placeholder="Local de armazenamento indisponível"
            aria-describedby="settings-knowledge-directory-description"
          />
          <Tip label={openingDirectory === 'knowledge' ? 'Abrindo pasta…' : 'Abrir workspace do conhecimento'}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Abrir workspace do conhecimento"
              disabled={busy || !directoryPaths.knowledge.trim()}
              onClick={() => void openDirectory('knowledge')}
            >
              <HugeiconsIcon icon={LinkSquare01Icon} strokeWidth={2} />
            </Button>
          </Tip>
        </div>
        <span id="settings-knowledge-directory-description" className="font-normal text-muted-foreground">
          Páginas, pastas e histórico de revisões são salvos em catalog.json neste diretório, ao lado da pasta dos
          cards.
        </span>
      </div>
      {directoryError && (
        <p role="alert" className="break-words text-[11px] text-destructive">
          {directoryError}
        </p>
      )}
    </section>
  )
}
