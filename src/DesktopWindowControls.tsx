import { isTauriDesktop, type DesktopWindow } from './desktopBootstrap'

export type DesktopWindowCommand = 'minimize_main_window' | 'toggle_maximize_main_window' | 'close_main_window'

export function invokeDesktopWindowCommand(command: DesktopWindowCommand): Promise<unknown> {
  const desktopWindow = window as unknown as DesktopWindow
  if (!isTauriDesktop(desktopWindow))
    return Promise.reject(new Error('A ponte do aplicativo desktop não está disponível.'))
  return desktopWindow.__TAURI__.core.invoke(command)
}

export function DesktopWindowControls({ onError }: { onError?: (message: string) => void }) {
  const run = (command: DesktopWindowCommand) => {
    void invokeDesktopWindowCommand(command).catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause)
      console.error(`desktop window control failed: ${command}`, cause)
      onError?.(`Não foi possível controlar a janela: ${detail}`)
    })
  }

  return (
    <div className="ml-1 flex self-stretch border-l">
      <button
        type="button"
        className="grid min-w-11 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Minimizar"
        onClick={() => run('minimize_main_window')}
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 fill-none stroke-current" strokeWidth="1.25">
          <path d="M2 6h8" />
        </svg>
      </button>
      <button
        type="button"
        className="grid min-w-11 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Maximizar ou restaurar"
        onClick={() => run('toggle_maximize_main_window')}
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 fill-none stroke-current" strokeWidth="1.1">
          <rect x="3" y="1" width="7" height="7" />
          <path d="M1 4v7h7" />
        </svg>
      </button>
      <button
        type="button"
        className="grid min-w-11 place-items-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        aria-label="Fechar"
        onClick={() => run('close_main_window')}
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 fill-none stroke-current" strokeWidth="1.25">
          <path d="m2 2 8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  )
}
