import type { ProcessRunner } from '../process'
import { resolveOptionalExecutable, wslDesktopCandidates } from '../platform'
import { stderrJsonlLogger, type StructuredLogger } from '../logger'

export type LauncherLogger = Pick<StructuredLogger, 'event'>

function reportLaunchFailure(logger: LauncherLogger | undefined, target: string): void {
  ;(logger ?? stderrJsonlLogger(process.stderr)).event('workspace.launch.error', { target })
}

export function openBrowser(
  urls: string[],
  browser: string | undefined,
  runner: ProcessRunner,
  logger?: LauncherLogger,
): void {
  const command = resolveOptionalExecutable({
    configured: browser,
    candidates: wslDesktopCandidates('browser'),
    label: 'Chrome ou outro navegador',
  })
  const child = process.env.WSL_DISTRO_NAME
    ? runner.spawn(command, ['--new-window', ...urls], { detached: true, stdio: 'ignore' })
    : runner.spawn(command, ['--new-window', ...urls], { detached: true, stdio: 'ignore' })
  child.on('error', () => reportLaunchFailure(logger, 'browser'))
  child.unref()
}

export function openTerminal(
  cwd: string,
  args: string[],
  terminal: string | undefined,
  runner: ProcessRunner,
  logger?: LauncherLogger,
): void {
  const command = resolveOptionalExecutable({
    configured: terminal,
    candidates: wslDesktopCandidates('terminal'),
    label: 'Windows Terminal',
  })
  const child = process.env.WSL_DISTRO_NAME
    ? runner.spawn(command, ['wsl.exe', '--cd', cwd, '--', ...args], { detached: true, stdio: 'ignore' })
    : runner.spawn(command, ['-e', ...args], { cwd, detached: true, stdio: 'ignore' })
  child.on('error', () => reportLaunchFailure(logger, 'terminal'))
  child.unref()
}

export function openEditor(path: string, executable: string, runner: ProcessRunner, logger?: LauncherLogger): void {
  const child = runner.spawn(executable, [path], { detached: true, stdio: 'ignore' })
  child.on('error', () => reportLaunchFailure(logger, 'editor'))
  child.unref()
}
