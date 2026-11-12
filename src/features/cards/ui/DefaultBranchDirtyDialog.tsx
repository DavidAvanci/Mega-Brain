import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { requestJson } from '@/shared/api/request-json'
import { retryCardStage } from '../model/card-commands'
import type { DefaultBranchDirtyChange } from '../../../../shared/domain/agents'
import type { RepositoryDirtyAction } from '../../../../shared/domain/repositories'

export function DefaultBranchDirtyDialog({ cardId, changes }: { cardId: string; changes: DefaultBranchDirtyChange[] }) {
  const [action, setAction] = useState<RepositoryDirtyAction | null>(null)
  const [commitMessage, setCommitMessage] = useState('chore: salvar alterações antes de atualizar a branch')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolve = async () => {
    if (
      !action ||
      pending ||
      (action === 'commit' && !commitMessage.trim()) ||
      (action === 'discard' && !confirmDiscard)
    )
      return
    setPending(true)
    setError(null)
    try {
      for (const change of changes) {
        await requestJson('/api/repositories/resolve-dirty', 'Falha ao tratar alterações locais', {
          method: 'POST',
          body: {
            id: change.repositoryId,
            dirtyAction: action,
            commitMessage: action === 'commit' ? commitMessage.trim() : undefined,
            worktreePath: change.worktreePath,
            expectedBranch: change.branch,
            expectedFiles: change.files,
          },
        })
      }
      await retryCardStage(cardId, 'run-task-checklist')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="grid gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div>
        <h3 className="text-sm font-semibold">Resolver alterações na branch default</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          O Mega Brain pausou antes de iniciar os agentes. Revise a lista e escolha como tratar os arquivos; depois ele
          atualizará a branch e tentará novamente a etapa.
        </p>
      </div>
      <div className="grid gap-4">
        {changes.map((change) => (
          <section key={`${change.repositoryId}-${change.branch}`} className="grid gap-2">
            <h3 className="text-sm font-medium">
              {change.repository} · {change.branch}
            </h3>
            <ol className="grid max-h-32 list-decimal gap-1 overflow-y-auto pl-6 text-xs">
              {change.files.map((file, index) => (
                <li key={`${file.path}-${index}`} className="break-all pl-1">
                  <span className="mr-2 text-muted-foreground">{file.change}</span>
                  <code>{file.path}</code>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <div className="grid gap-2" role="radiogroup" aria-label="Como tratar as alterações locais">
        {(
          [
            ['stash', 'Guardar no stash', 'Guarda as alterações rastreadas e arquivos novos para restaurar depois.'],
            ['commit', 'Criar commit', 'Atualiza a branch e registra as alterações em um novo commit.'],
            ['discard', 'Descartar alterações', 'Remove as alterações locais e arquivos novos deste checkout.'],
          ] as const
        ).map(([value, label, description]) => (
          <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
            <input
              type="radio"
              name="default-branch-dirty-action"
              value={value}
              checked={action === value}
              onChange={() => {
                setAction(value)
                setConfirmDiscard(false)
              }}
            />
            <span>
              <span className="block font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </span>
          </label>
        ))}
      </div>

      {action === 'commit' && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Mensagem do commit
          <Input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
        </label>
      )}
      {action === 'discard' && (
        <label className="flex items-center gap-2 text-sm text-destructive">
          <Checkbox checked={confirmDiscard} onCheckedChange={setConfirmDiscard} />
          Confirmo que quero descartar as alterações listadas
        </label>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={
            !action ||
            pending ||
            (action === 'commit' && !commitMessage.trim()) ||
            (action === 'discard' && !confirmDiscard)
          }
          onClick={() => void resolve()}
        >
          {pending ? 'Tratando alterações…' : 'Tratar e tentar novamente'}
        </Button>
      </div>
    </section>
  )
}
