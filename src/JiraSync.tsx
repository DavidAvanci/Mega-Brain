import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowReloadHorizontalIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { syncJiraCards } from './features/cards/model/card-commands'
import { Tip } from './Tip'

export function JiraSync() {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number>(undefined)

  const sync = async () => {
    if (pending) return
    setPending(true)
    setResult(null)
    setError(null)
    window.clearTimeout(timer.current)
    try {
      const created = await syncJiraCards()
      setResult(created ? `+${created} card${created > 1 ? 's' : ''}` : 'em dia')
      timer.current = window.setTimeout(() => setResult(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Tip label={error ?? 'Buscar no Jira os cards em "READY to do" atribuídos a mim'}>
      <Button
        variant="ghost"
        size="xs"
        className={cn('ml-auto text-muted-foreground', error && 'text-destructive')}
        disabled={pending}
        onClick={sync}
      >
        {pending ? <Spinner className="size-3" /> : <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} />}
        {pending ? 'Sincronizando…' : error ? 'Falhou' : (result ?? 'Jira sync')}
      </Button>
    </Tip>
  )
}
