import { Toaster } from 'sonner'
import { useTheme } from '@/theme'

export function AppToaster() {
  const theme = useTheme()

  return (
    <Toaster
      className="mega-brain-toaster"
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        style: {
          background: 'var(--card)',
          color: 'var(--card-foreground)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          fontFamily: 'var(--font-ui)',
          fontSize: '0.875rem',
          lineHeight: 'var(--text-line-height)',
          letterSpacing: 'var(--text-tracking)',
        },
      }}
    />
  )
}
