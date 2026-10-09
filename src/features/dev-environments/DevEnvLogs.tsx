import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import type { DevEnvLogs as Logs } from '../../../shared/domain/dev-environments'
import { fetchDevEnvLogs } from './dev-env-api'

export function DevEnvLogs({ cardId, failedRepo }: { cardId: string; failedRepo?: string }) {
  const [logs, setLogs] = useState<Logs | null>(null)
  const [file, setFile] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        let result = await fetchDevEnvLogs(cardId, file)
        const preferred = failedRepo && `${failedRepo}.log`
        if (!file && preferred && result.files.includes(preferred) && result.file !== preferred)
          result = await fetchDevEnvLogs(cardId, preferred)
        if (!cancelled) {
          setLogs(result)
          setError(null)
        }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [cardId, file, failedRepo, revision])
  return (
    <section className="overflow-hidden rounded-xl border" aria-label="Logs dos projetos">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <h3 className="mr-auto text-sm font-medium">Logs dos projetos</h3>
        {Boolean(logs?.files.length) && (
          <select
            aria-label="Arquivo de log"
            className="h-10 min-w-0 max-w-[65%] rounded-md border bg-background px-2 text-xs"
            value={logs?.file ?? ''}
            onChange={(event) => setFile(event.target.value)}
          >
            {logs?.files.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <Button
          variant="ghost"
          aria-label="Atualizar logs"
          title="Atualizar logs"
          className="size-10 shrink-0"
          onClick={() => setRevision((previous) => previous + 1)}
        >
          <HugeiconsIcon icon={Refresh01Icon} className="size-4" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-4 py-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <pre className="max-h-52 overflow-auto p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        {logs?.content ||
          (logs ? 'Os logs aparecerão após a primeira tentativa de iniciar o ambiente.' : 'Carregando logs…')}
      </pre>
      {logs?.truncated && (
        <p className="px-4 pb-3 text-[11px] text-muted-foreground">Exibindo os últimos 64 KB deste arquivo.</p>
      )}
    </section>
  )
}
