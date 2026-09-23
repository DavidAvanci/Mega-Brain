import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Coffee02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Tip } from './Tip'
import { apiClient } from './shared/api/api-client'

const POLL_INTERVAL = 3_000

async function callCoffee(method: 'GET' | 'POST' | 'DELETE'): Promise<boolean | null> {
  try {
    const data = await apiClient().json<{ active?: boolean }>('/api/coffee', { method })
    return data.active === true
  } catch {
    return null
  }
}

export function CoffeeButton({ className }: { className?: string }) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!active) return
    let running = true
    const timer = window.setInterval(async () => {
      const state = await callCoffee('GET')
      if (running && state === false) setActive(false)
    }, POLL_INTERVAL)
    return () => {
      running = false
      window.clearInterval(timer)
    }
  }, [active])

  const toggle = async () => {
    const state = await callCoffee(active ? 'DELETE' : 'POST')
    if (state !== null) setActive(state)
  }

  return (
    <Tip
      side="bottom"
      label={
        active
          ? 'Cafézinho ativo — o PC não hiberna. Desliga sozinho quando você desbloquear'
          : 'Bloqueia o PC sem deixar ele hibernar'
      }
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Cafézinho"
        aria-pressed={active}
        className={cn(active ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground', className)}
        onClick={toggle}
      >
        <HugeiconsIcon icon={Coffee02Icon} strokeWidth={2} />
      </Button>
    </Tip>
  )
}
