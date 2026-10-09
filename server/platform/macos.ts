import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { desktopCandidates, resolveOptionalExecutable } from '../platform'
import type { ProcessRunner } from '../process'

const LAUNCH_TIMEOUT_MS = 10_000
const UNUSED_SCRIPT_TIMEOUT_MS = 5 * 60_000
const pendingScripts = new Set<string>()

function cleanupPendingScripts(): void {
  for (const directory of pendingScripts) rmSync(directory, { recursive: true, force: true })
  pendingScripts.clear()
}

/** Launch Services opens files/URLs without Apple Events or automation permissions. */
export function openMacApplication(args: string[], runner: ProcessRunner, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failure = () => reject(new Error(`Não foi possível abrir ${label}. Verifique o aplicativo configurado.`))
    try {
      runner.execFile('/usr/bin/open', args, { timeout: LAUNCH_TIMEOUT_MS, encoding: 'utf8' }, (error) => {
        if (error) return failure()
        resolve()
      })
    } catch {
      failure()
    }
  })
}

function shellArgument(value: string): string {
  if (value.includes('\0')) throw new Error('O comando do terminal contém um caractere inválido')
  return `'${value.replaceAll("'", "'\\''")}'`
}

function terminalApplication(configured: string | undefined): string | undefined {
  const requested = configured?.trim()
  const name = requested?.toLowerCase()
  const iterm = ['iterm', 'iterm2', 'iterm.app', 'iterm2.app'].includes(name ?? '')
  if (!requested || name === 'terminal' || name === 'terminal.app' || iterm) {
    const candidates = iterm
      ? [join(homedir(), 'Applications/iTerm.app'), '/Applications/iTerm.app', '/Applications/iTerm2.app']
      : desktopCandidates('terminal', 'darwin')
    return resolveOptionalExecutable({ candidates, label: iterm ? 'iTerm2' : 'Terminal do macOS' })
  }

  // Accept both an application bundle and its executable from the existing BIN override.
  const application = /^(.+\.app)(?:\/Contents\/MacOS\/[^/]+)?$/i.exec(requested)?.[1]
  if (!application) return undefined
  if (!isAbsolute(application)) throw new Error('Informe um caminho absoluto para o aplicativo de terminal')
  if (!['terminal.app', 'iterm.app', 'iterm2.app'].includes(basename(application).toLowerCase())) {
    throw new Error('Use Terminal.app, iTerm.app ou o executável de um terminal compatível com -e')
  }
  return resolveOptionalExecutable({ configured: application, candidates: [], label: 'Terminal do macOS' })
}

/** Returns false for custom terminal CLIs, which retain their direct argv launch. */
export async function openMacTerminal(
  cwd: string,
  args: string[],
  configured: string | undefined,
  runner: ProcessRunner,
): Promise<boolean> {
  const application = terminalApplication(configured)
  if (!application) return false
  if (!args.length) throw new Error('Informe o comando a executar no terminal')
  const command = args.map(shellArgument).join(' ')
  const directory = shellArgument(cwd)
  const path = shellArgument(process.env.PATH ?? '')
  const temporary = mkdtempSync(join(tmpdir(), 'mega-brain-terminal-'))
  const script = join(temporary, 'agent.command')
  if (!pendingScripts.size) process.once('exit', cleanupPendingScripts)
  pendingScripts.add(temporary)
  const cleanup = () => {
    rmSync(temporary, { recursive: true, force: true })
    pendingScripts.delete(temporary)
    if (!pendingScripts.size) process.removeListener('exit', cleanupPendingScripts)
  }
  try {
    // The private script removes itself before running the interactive agent.
    // Quoted argv preserves prompts, whitespace and shell metacharacters as data.
    writeFileSync(
      script,
      `#!/bin/sh\n/bin/rm -f ${shellArgument(script)}\n/bin/rmdir ${shellArgument(temporary)}\ncd ${directory} || exit 1\nexport PATH=${path}:"$PATH"\nexec ${command}\n`,
      { mode: 0o700, flag: 'wx' },
    )
    await openMacApplication(['-a', application, script], runner, 'o terminal')
    // Cover an app accepting the file without executing it. Never keep a prompt indefinitely.
    setTimeout(cleanup, UNUSED_SCRIPT_TIMEOUT_MS).unref()
    return true
  } catch (error) {
    cleanup()
    throw error
  }
}
