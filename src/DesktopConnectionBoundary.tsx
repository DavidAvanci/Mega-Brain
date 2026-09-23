import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { refresh } from './features/cards/model/card-commands'
import { retryDesktopConnection, useDesktopConnection } from './desktopConnection'
import {
  listDesktopWslDistributions,
  selectDesktopWslDistribution,
  setDesktopWslWorkspaceDir,
} from './desktopBootstrap'
import { DesktopWindowControls, invokeDesktopWindowCommand } from './DesktopWindowControls'

function StartupTitlebar() {
  return (
    <header
      data-tauri-drag-region
      className="flex min-h-11 shrink-0 items-center gap-2.5 border-b bg-card pl-4"
      onDoubleClick={(event) => {
        if (!(event.target as Element).closest('button')) void invokeDesktopWindowCommand('toggle_maximize_main_window')
      }}
    >
      <img src="/brain.svg" alt="" aria-hidden="true" className="size-6" />
      <span data-tauri-drag-region className="font-sans text-base font-semibold">
        Mega Brain
      </span>
      <span data-tauri-drag-region className="flex-1" />
      <DesktopWindowControls />
    </header>
  )
}

function message(phase: ReturnType<typeof useDesktopConnection>['phase']): string {
  if (phase === 'starting') return 'Iniciando o backend local…'
  if (phase === 'expired') return 'A sessão local expirou. Reconecte para continuar.'
  if (phase === 'ready') return ''
  if (phase === 'wsl-not-installed')
    return 'O WSL não está instalado. Instale o WSL, reinicie o Windows e abra o Mega Brain novamente.'
  if (phase === 'distribution-not-found')
    return 'A distribuição WSL configurada não foi encontrada. Instale-a ou selecione uma distribuição válida e tente novamente.'
  if (phase === 'runtime-unavailable')
    return 'O runtime Node.js não está disponível na distribuição WSL. Instale o Node.js 18.19 ou superior e tente novamente.'
  if (phase === 'invalid-workspace')
    return 'O workspace configurado não é válido. Verifique se o diretório existe e tente novamente.'
  if (phase === 'backend-incompatible')
    return 'O backend instalado é incompatível com esta versão do Mega Brain. Atualize ou reinstale o aplicativo e tente novamente.'
  if (phase === 'backend-failed')
    return 'O processo do backend encerrou durante a inicialização. Consulte a saída do PowerShell e tente novamente.'
  return 'O backend local está indisponível. Verifique o WSL e tente novamente.'
}

/** Keeps mounted content alive after the first successful connection. */
export function DesktopConnectionBoundary({ children }: { children: ReactNode }) {
  const connection = useDesktopConnection()
  const [distros, setDistros] = useState<string[] | undefined>()
  const [selecting, setSelecting] = useState(false)
  // No preference read on mount: this boundary must not create a second
  // bootstrap request or a StrictMode request cascade.
  const [workspaceDir, setWorkspaceDir] = useState(() => '')
  const retry = async () => {
    await retryDesktopConnection()
    if (connection.hasConnected) await refresh()
  }
  const discoverDistros = async () => {
    setSelecting(true)
    try {
      setDistros(await listDesktopWslDistributions())
    } finally {
      setSelecting(false)
    }
  }
  const chooseDistro = async (distro: string) => {
    setSelecting(true)
    try {
      await selectDesktopWslDistribution(distro)
      setDistros(undefined)
    } catch {
      // The selection is persisted before startup. A startup error is exposed
      // by the regular connection state below, not as an unhandled click error.
    } finally {
      setSelecting(false)
    }
    await retry()
  }
  const chooseWorkspace = async () => {
    setSelecting(true)
    try {
      await setDesktopWslWorkspaceDir(workspaceDir)
      await retry()
    } finally {
      setSelecting(false)
    }
  }

  if (!connection.hasConnected) {
    return (
      <div className="flex h-dvh flex-col">
        <StartupTitlebar />
        <main className="flex min-h-0 flex-1 items-center justify-center p-6" aria-live="polite">
          <section className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
            <h1 className="text-base font-semibold">Mega Brain</h1>
            <p className="mt-2 text-sm text-muted-foreground">{message(connection.phase)}</p>
            {connection.phase === 'distribution-not-found' && (
              <div className="mt-4 space-y-2">
                {distros?.map((distro) => (
                  <Button
                    key={distro}
                    variant="outline"
                    className="mr-2"
                    disabled={selecting}
                    onClick={() => void chooseDistro(distro)}
                  >
                    {distro}
                  </Button>
                ))}
                {!distros && (
                  <Button variant="outline" disabled={selecting} onClick={() => void discoverDistros()}>
                    Escolher distribuição WSL
                  </Button>
                )}
                {distros?.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma distribuição WSL foi encontrada.</p>
                )}
              </div>
            )}
            {connection.phase === 'invalid-workspace' && (
              <div className="mt-4 space-y-2">
                <label className="block text-xs text-muted-foreground" htmlFor="wsl-workspace-dir">
                  WORKSPACE_DIR no WSL
                </label>
                <input
                  id="wsl-workspace-dir"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  value={workspaceDir}
                  onChange={(event) => setWorkspaceDir(event.target.value)}
                  placeholder="/home/seu-usuario/mega-brain-files/workspace"
                  disabled={selecting}
                />
                <p className="text-xs text-muted-foreground">
                  Use um diretório absoluto existente na distribuição WSL. Credenciais e ~/.claude permanecem no WSL.
                </p>
                <Button
                  variant="outline"
                  disabled={selecting || !workspaceDir.trim()}
                  onClick={() => void chooseWorkspace()}
                >
                  Salvar workspace WSL
                </Button>
              </div>
            )}
            {connection.phase !== 'starting' && (
              <Button className="mt-5" onClick={() => void retry()}>
                Tentar novamente
              </Button>
            )}
          </section>
        </main>
      </div>
    )
  }

  return (
    <>
      {connection.phase !== 'ready' && (
        <div
          className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
          role="status"
          aria-live="polite"
        >
          <span>{message(connection.phase)}</span>
          {connection.phase !== 'starting' && (
            <Button size="xs" variant="outline" onClick={() => void retry()}>
              Reconectar
            </Button>
          )}
        </div>
      )}
      {children}
    </>
  )
}
