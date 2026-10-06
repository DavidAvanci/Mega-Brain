import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  label: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  contentClassName?: string
  arrowClassName?: string
  children: ReactElement<Record<string, unknown>>
}

export function Tip({ label, side, contentClassName, arrowClassName, children }: Props) {
  if (!label) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className={contentClassName} arrowClassName={arrowClassName}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
