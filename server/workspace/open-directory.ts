import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ProcessRunner } from '../process'
import { openMacApplication } from '../platform/macos'

const LAUNCH_TIMEOUT_MS = 10_000

export async function openDirectory(value: unknown, runner: ProcessRunner): Promise<void> {
  if (typeof value !== 'string' || !isAbsolute(value.trim()) || value.includes('\0')) {
    throw new Error('Informe um caminho absoluto para abrir a pasta.')
  }
  const path = resolve(value.trim())
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('A pasta não existe. Verifique o caminho informado.')
  }
  if (process.platform === 'darwin') return openMacApplication([path], runner, 'a pasta')

  const wsl = process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME)
  const command = process.platform === 'win32' || wsl ? 'explorer.exe' : 'xdg-open'
  try {
    const target = wsl
      ? String(runner.execFileSync('wslpath', ['-w', path], { encoding: 'utf8', timeout: LAUNCH_TIMEOUT_MS })).trim()
      : path
    if (command === 'explorer.exe') {
      // Explorer may exit with a nonzero code after delegating to an existing window.
      await new Promise<void>((resolve, reject) => {
        const child = runner.spawn(command, [target], { detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
      return
    }
    await new Promise<void>((resolve, reject) => {
      runner.execFile(command, [target], { encoding: 'utf8', timeout: LAUNCH_TIMEOUT_MS }, (error) => {
        if (error) return reject(error)
        resolve()
      })
    })
  } catch {
    throw new Error('Não foi possível abrir a pasta no gerenciador de arquivos.')
  }
}
