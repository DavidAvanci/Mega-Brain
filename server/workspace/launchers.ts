import type { ProcessRunner } from '../process'
import { resolveOptionalExecutable, desktopCandidates } from '../platform'
import { openMacApplication, openMacTerminal } from '../platform/macos'
import { stderrJsonlLogger, type StructuredLogger } from '../logger'
import { terminalCommand } from './terminal-command'

export type LauncherLogger = Pick<StructuredLogger, 'event'>

interface BrowserLaunchOptions {
  newWindow?: boolean
  logger?: LauncherLogger
}

interface TerminalLaunchOptions {
  shell?: string
  logger?: LauncherLogger
}

function reportLaunchFailure(logger: LauncherLogger | undefined, target: string): void {
  ;(logger ?? stderrJsonlLogger(process.stderr)).event('workspace.launch.error', { target })
}

export function openBrowser(
  urls: string[],
  browser: string | undefined,
  runner: ProcessRunner,
  options: BrowserLaunchOptions = {},
): void | Promise<void> {
  if (process.platform === 'darwin' && (!browser || browser.endsWith('.app') || browser === '/usr/bin/open')) {
    const application = browser?.endsWith('.app')
      ? resolveOptionalExecutable({ configured: browser, candidates: [], label: 'Navegador' })
      : undefined
    return openMacApplication(application ? ['-a', application, ...urls] : urls, runner, 'o navegador').catch(
      (error) => {
        reportLaunchFailure(options.logger, 'browser')
        throw error
      },
    )
  }
  const command = resolveOptionalExecutable({
    configured: browser,
    candidates: desktopCandidates('browser'),
    label: 'Chrome ou outro navegador',
  })
  const args = options.newWindow ? ['--new-window', ...urls] : urls
  const child = runner.spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => reportLaunchFailure(options.logger, 'browser'))
  child.unref()
}

export async function openTerminal(
  cwd: string,
  args: string[],
  terminal: string | undefined,
  runner: ProcessRunner,
  options: TerminalLaunchOptions = {},
): Promise<void> {
  const commandArgs = terminalCommand(args, options.shell)
  if (process.platform === 'darwin') {
    try {
      if (await openMacTerminal(cwd, commandArgs, terminal, runner)) return
    } catch (error) {
      reportLaunchFailure(options.logger, 'terminal')
      throw error
    }
  }
  const wsl = process.platform === 'linux' ? process.env.WSL_DISTRO_NAME : undefined
  const command = resolveOptionalExecutable({
    configured: terminal,
    candidates: desktopCandidates('terminal'),
    label: wsl || process.platform === 'win32' ? 'Windows Terminal' : 'Terminal',
  })
  const child = wsl
    ? runner.spawn(command, ['wsl.exe', '-d', wsl, '--cd', cwd, '--', ...commandArgs], {
        detached: true,
        stdio: 'ignore',
      })
    : runner.spawn(command, ['-e', ...commandArgs], { cwd, detached: true, stdio: 'ignore' })
  child.on('error', () => reportLaunchFailure(options.logger, 'terminal'))
  child.unref()
}

export function openEditor(path: string, executable: string, runner: ProcessRunner, logger?: LauncherLogger): void {
  const child = runner.spawn(executable, [path], { detached: true, stdio: 'ignore' })
  child.on('error', () => reportLaunchFailure(logger, 'editor'))
  child.unref()
}
