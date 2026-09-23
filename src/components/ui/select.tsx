import { Select } from '@base-ui/react/select'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export function AppSelect<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled,
  compact,
  className,
}: {
  value: T
  options: readonly SelectOption<T>[]
  onValueChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
  compact?: boolean
  className?: string
}) {
  return (
    <Select.Root
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => next !== null && onValueChange(next)}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={cn(
          'group inline-flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background text-left text-foreground shadow-xs outline-none transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
          compact ? 'h-7 px-2 font-sans text-xs' : 'h-8 px-2.5 text-sm',
          className,
        )}
      >
        <Select.Value className="min-w-0 flex-1 truncate" />
        <Select.Icon className="shrink-0 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180">
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={5} align="start" alignItemWithTrigger={false} className="z-[100] outline-none">
          <Select.Popup className="origin-[var(--transform-origin)] min-w-[var(--anchor-width)] max-w-[min(24rem,var(--available-width))] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[transform,opacity] duration-100 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Select.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="grid min-h-8 cursor-default grid-cols-[1fr_1rem] items-center gap-3 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <Select.ItemText className="truncate">{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="text-primary">
                    <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-3.5" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
