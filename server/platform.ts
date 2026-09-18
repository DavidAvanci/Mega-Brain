import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/**
 * Resolve optional desktop programs without invoking a shell.  In particular,
 * never turn a card path or URL into a command string: callers always receive
 * an executable and pass their arguments separately to ProcessRunner.
 */
export interface OptionalExecutableOptions {
  configured?: string
  candidates: readonly string[]
  label: string
  path?: string
  exists?: (path: string) => boolean
}

function onPath(command: string, path: string, exists: (path: string) => boolean): string | undefined {
  if (isAbsolute(command)) return exists(command) ? command : undefined
  for (const directory of path.split(delimiter)) {
    const candidate = join(directory, command)
    if (directory && exists(candidate)) return candidate
  }
  return undefined
}

export function resolveOptionalExecutable(options: OptionalExecutableOptions): string {
  const exists = options.exists ?? existsSync
  const path = options.path ?? process.env.PATH ?? ''
  const choices = options.configured ? [options.configured] : options.candidates
  for (const choice of choices) {
    const found = onPath(choice, path, exists)
    if (found) return found
  }
  const requested = options.configured ? ` configurado em ${options.configured}` : ''
  throw new Error(`${options.label} não está disponível${requested}. Instale-o ou defina o executável em Configurações.`)
}

export function wslDesktopCandidates(kind: 'cursor' | 'terminal' | 'browser' | 'powershell'): readonly string[] {
  const wsl = Boolean(process.env.WSL_DISTRO_NAME)
  if (kind === 'cursor') return ['cursor', 'cursor.exe']
  if (kind === 'terminal') return wsl ? ['wt.exe', '/mnt/c/Windows/System32/wt.exe'] : ['x-terminal-emulator']
  if (kind === 'browser') return wsl
    ? ['/mnt/c/Program Files/Google/Chrome/Application/chrome.exe', 'chrome.exe']
    : ['google-chrome', 'chromium', 'chromium-browser']
  return wsl
    ? ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 'powershell.exe']
    : ['powershell.exe', 'powershell']
}
