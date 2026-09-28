import { Toaster } from 'sonner'
import { useTheme } from '@/theme'

export function AppToaster() {
  const theme = useTheme()

  return (
    <Toaster
      className="mega-brain-toaster"
      theme={theme}
      position="top-right"
      closeButton
      toastOptions={{
        style: {
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
