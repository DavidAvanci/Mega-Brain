import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DevEnvLogs as Logs } from '../../../shared/domain/dev-environments'
import { fetchDevEnvLogs } from './dev-env-api'

export function DevEnvLogs({ cardId, failedRepo }: { cardId: string; failedRepo?: string }) {
  const [logs, setLogs] = useState<Logs | null>(null)
  const [file, setFile] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const preferred = failedRepo && `${failedRepo}.log`
  const selected =
    file && logs?.files.includes(file)
      ? file
      : preferred && logs?.files.includes(preferred)
        ? preferred
        : logs?.files[0]
  const content = logs?.file === selected ? (logs?.content ?? '') : ''
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        let result = await fetchDevEnvLogs(cardId)
        const requested =
          file && result.files.includes(file)
            ? file
            : preferred && result.files.includes(preferred)
              ? preferred
              : result.file
        if (requested && requested !== result.file) result = await fetchDevEnvLogs(cardId, requested)
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
  }, [cardId, file, preferred, revision])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopyError(null)
    } catch {
      setCopyError('Não foi possível copiar os logs.')
    }
  }
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border"
      aria-label="Logs dos projetos"
    >
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-medium">Logs dos projetos</h3>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={selected}>
            {selected ?? 'Aguardando a primeira inicialização'}
          </p>
        </div>
        <Button
          variant="ghost"
          aria-label="Copiar logs"
          title="Copiar logs"
          className="size-10 shrink-0"
          disabled={!content}
          onClick={() => void copy()}
        >
          <HugeiconsIcon icon={Copy01Icon} className="size-4" />
        </Button>
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
      {(error || copyError) && (
        <p role="alert" className="shrink-0 px-4 py-3 text-xs text-destructive">
          {error || copyError}
        </p>
      )}
      {selected ? (
        <Tabs
          orientation="vertical"
          value={selected}
          onValueChange={(value) => {
            setFile(value)
            setCopyError(null)
          }}
          className="min-h-0 min-w-0 flex-1 gap-0"
        >
          <TabsList
            aria-label="Arquivos de log"
            className="min-h-0 w-40 max-w-[35%] shrink-0 items-stretch justify-start overflow-y-auto rounded-none border-r bg-muted/30 p-2 group-data-vertical/tabs:h-auto"
          >
            {logs?.files.map((name) => (
              <TabsTrigger
                key={name}
                value={name}
                title={name}
                aria-label={`Log de ${name.replace(/\.log$/, '')}`}
                className="h-auto min-h-10 flex-none justify-start px-2 py-2 text-left text-xs whitespace-normal break-all"
              >
                {name.replace(/\.log$/, '')}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent key={selected} value={selected} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <pre
              aria-label={`Conteúdo de ${selected}`}
              className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap break-words"
            >
              {logs?.file !== selected ? 'Carregando logs…' : content || 'Este arquivo ainda não contém saída.'}
            </pre>
            {logs?.file === selected && logs.truncated && (
              <p className="shrink-0 px-4 pb-3 text-[11px] text-muted-foreground">
                Exibindo os últimos 64 KB deste arquivo.
              </p>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {logs ? 'Os logs aparecerão após a primeira tentativa de iniciar o ambiente.' : 'Carregando logs…'}
        </p>
      )}
    </section>
  )
}
