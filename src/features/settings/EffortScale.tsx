import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { cn } from '@/lib/utils'
import type { Effort } from '../../../shared/domain/settings'
import { EFFORT_DETAILS } from '../../../shared/domain/codex-models'

export function EffortScale({
  value,
  options,
  disabled,
  label,
  describedBy,
  onChange,
}: {
  value: Effort
  options: readonly Effort[]
  disabled?: boolean
  label: string
  describedBy?: string
  onChange: (effort: Effort) => void
}) {
  const selectedIndex = options.indexOf(value)

  return (
    <RadioGroup<Effort>
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      className="relative flex flex-wrap gap-1"
    >
      {options.map((effort, index) => (
        <Radio.Root<Effort>
          key={effort}
          value={effort}
          nativeButton
          render={<button type="button" />}
          title={EFFORT_DETAILS[effort].description}
          className={cn(
            'grid min-h-10 min-w-11 flex-1 cursor-pointer content-center gap-2 rounded-md px-2 py-2 text-center outline-none transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:pointer-events-none data-disabled:opacity-50',
            effort === value && 'bg-primary/10',
          )}
        >
          <span
            aria-hidden="true"
            className={cn('h-1.5 rounded-full', index <= selectedIndex ? 'bg-primary' : 'bg-muted')}
          />
          <span
            className={cn(
              'text-[11px] leading-none',
              effort === value ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {EFFORT_DETAILS[effort].label}
          </span>
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}
