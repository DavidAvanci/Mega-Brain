import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppToaster } from './components/ui/app-toaster'
import { bootstrapWebApiClient } from './shared/api/api-client'
import { DesktopConnectionBoundary } from './DesktopConnectionBoundary'
import { startDesktopConnection } from './desktopConnection'
import { isTauriDesktop } from './desktopBootstrap'
import './index.css'
import './theme'

// The development profiler is opt-in. It is not needed to boot the app and a
// third-party diagnostic must never prevent the desktop recovery screen from
// rendering.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === 'true') {
  void import('react-scan')
    .then(({ scan }) => scan({ enabled: true }))
    .catch((error) => console.warn('React Scan was not started:', error))
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Mega Brain frontend failed to render:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex h-screen items-center justify-center p-6">
          <section className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
            <h1 className="text-base font-semibold">Mega Brain não pôde iniciar</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {this.state.error.message || 'Falha inesperada ao renderizar a interface.'}
            </p>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

// Web remains synchronous and relative. Desktop deliberately waits for the
// supervisor session before React can issue its first request.
if (isTauriDesktop()) {
  void startDesktopConnection()
  renderApp(true)
} else {
  bootstrapWebApiClient()
  renderApp(false)
}

function renderApp(desktop: boolean) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RootErrorBoundary>
        {desktop ? (
          <DesktopConnectionBoundary>
            <App />
          </DesktopConnectionBoundary>
        ) : (
          <App />
        )}
        <AppToaster />
      </RootErrorBoundary>
    </StrictMode>,
  )
}
