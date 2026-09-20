import type { ChildProcess } from 'node:child_process'
import { nodeProcessRunner, type ProcessOwner, type ProcessRunner } from '../process'
import { resolveOptionalExecutable, wslDesktopCandidates } from '../platform'

const script = `
$sig = @'
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
[DllImport("user32.dll")] public static extern bool LockWorkStation();
'@
$api = Add-Type -MemberDefinition $sig -Name Coffee -Namespace MegaBrain -PassThru
$esContinuous = [uint32]2147483648
$esSystemRequired = [uint32]1
$api::SetThreadExecutionState($esContinuous -bor $esSystemRequired) | Out-Null
try {
  $api::LockWorkStation() | Out-Null
  $locked = $false
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) { if (Get-Process LogonUI -ErrorAction SilentlyContinue) { $locked = $true; break }; Start-Sleep -Milliseconds 250 }
  while ($locked -and (Get-Process LogonUI -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 1 }
} finally {
  # Also runs for a PowerShell terminating error after the energy request.
  $api::SetThreadExecutionState($esContinuous) | Out-Null
}
`

export const COFFEE_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(script, 'utf16le').toString('base64'),
]
export type SpawnProcess = (command: string, args: string[]) => ChildProcess

export interface CoffeeService {
  start(): void
  stop(): void
  active(): boolean
}
export function createCoffeeService(
  runner: ProcessRunner | SpawnProcess = nodeProcessRunner,
  powershell?: string,
  owner?: ProcessOwner,
): CoffeeService {
  let session: ChildProcess | null = null
  const spawnProcess: SpawnProcess =
    typeof runner === 'function' ? runner : (command, args) => runner.spawn(command, args, { stdio: 'ignore' })
  return {
    stop() {
      const child = session
      session = null
      try {
        child?.kill()
      } catch {
        /* It may have exited already. */
      }
    },
    start() {
      if (session) return
      const command = resolveOptionalExecutable({
        configured: powershell,
        candidates: wslDesktopCandidates('powershell'),
        label: 'PowerShell',
      })
      let child: ChildProcess
      try {
        child = spawnProcess(command, COFFEE_ARGS)
      } catch (error) {
        session = null
        throw error
      }
      owner?.own(child, { label: 'coffee' })
      session = child
      const release = () => {
        if (session === child) session = null
      }
      child.on('exit', release)
      child.on('error', release)
    },
    active: () => session !== null,
  }
}
