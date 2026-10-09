import { readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { AgentInfo } from '../shared/domain/agents'
import { assistantText, parseJsonRecord, readTail, record } from './agent-log'

const STREAM_TAIL_BYTES = 128 * 1024

export interface RunningAgentProcess {
  pid: number
  provider: 'claude' | 'codex'
  cwd: string
  startedAt?: string
  /** Batch/print-mode agents are not interactive terminal sessions. */
  interactive?: boolean
  /** Proven process environment metadata; never inferred from its repository cwd. */
  codexHome?: string
  codexProfileId?: string
}

function codexProcessEnvironment(
  environment: string,
  separator: string,
): Pick<RunningAgentProcess, 'codexHome' | 'codexProfileId'> {
  const values = new Map(
    environment.split(separator).flatMap((entry) => {
      const equal = entry.indexOf('=')
      return equal < 0 ? [] : [[entry.slice(0, equal), entry.slice(equal + 1)] as const]
    }),
  )
  const codexHome = values.get('CODEX_HOME')
  const home = values.get('HOME')
  const codexProfileId = values.get('MEGA_BRAIN_CODEX_PROFILE_ID')
  return {
    ...(codexHome && isAbsolute(codexHome)
      ? { codexHome }
      : !codexHome && home && isAbsolute(home)
        ? { codexHome: join(home, '.codex') }
        : {}),
    ...(codexProfileId && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(codexProfileId) ? { codexProfileId } : {}),
  }
}

export type ProcessCommand = (command: string, args: readonly string[]) => string
const processCommand: ProcessCommand = (command, args) =>
  execFileSync(command, [...args], {
    encoding: 'utf8',
    timeout: 1500,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

/** Read only the environment suffix of ps output and retain profile routing fields. */
export function macAgentProcesses(run: ProcessCommand = processCommand): RunningAgentProcess[] {
  let listing: string
  try {
    listing = run('/bin/ps', ['-axo', 'pid=,comm='])
  } catch {
    return []
  }
  return listing.split('\n').flatMap((line) => {
    const entry = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!entry) return []
    if (/\.app\/Contents\/MacOS\//.test(entry[2])) return []
    const executable = basename(entry[2]).toLowerCase()
    const provider = executable === 'claude' ? 'claude' : executable === 'codex' ? 'codex' : undefined
    if (!provider) return []
    const pid = Number(entry[1])
    try {
      const cwd = run('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
        .split('\n')
        .find((value) => value.startsWith('n'))
        ?.slice(1)
      if (!cwd || !isAbsolute(cwd)) return []
      const command = run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command=']).trim()
      // App-server daemons serve the desktop or usage probes; their work is in session logs.
      if (provider === 'codex' && /^(?:"[^"]+"|'[^']+'|\S+)\s+app-server(?:\s|$)/.test(command)) return []
      let routing: Pick<RunningAgentProcess, 'codexHome' | 'codexProfileId'> = {}
      if (provider === 'codex') {
        try {
          const extended = run('/bin/ps', ['eww', '-p', String(pid), '-o', 'command=']).trim()
          // Shell arguments can mention CODEX_HOME. They are never treated as environment.
          if (extended.startsWith(command)) {
            const suffix = extended.slice(command.length)
            const environment = [
              ...suffix.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*?)(?=\s[A-Za-z_][A-Za-z0-9_]*=|$)/g),
            ]
              .filter((match) => ['CODEX_HOME', 'HOME', 'MEGA_BRAIN_CODEX_PROFILE_ID'].includes(match[1]))
              .map((match) => `${match[1]}=${match[2]}`)
              .join('\0')
            routing = codexProcessEnvironment(environment, '\0')
          }
        } catch {
          /* Process environments can be unreadable for another user. */
        }
      }
      return [
        {
          pid,
          provider,
          cwd,
          interactive:
            provider === 'codex' ? !/\bcodex\s+exec\b/.test(command) : !/\s(?:-p|--print)(?:\s|$)/.test(command),
          ...routing,
        },
      ]
    } catch {
      return []
    }
  })
}

let cachedMacProcesses: RunningAgentProcess[] = []
let macScannedAt = 0

/** Finds the agent processes visible to the backend without invoking a shell. */
export function agentProcesses(procRoot = '/proc', refresh = false): RunningAgentProcess[] {
  if (procRoot === '/proc' && process.platform === 'darwin') {
    if (refresh || Date.now() - macScannedAt >= 3000) {
      cachedMacProcesses = macAgentProcesses()
      macScannedAt = Date.now()
    }
    return cachedMacProcesses
  }
  let pids: string[]
  try {
    pids = readdirSync(procRoot).filter((entry) => /^\d+$/.test(entry))
  } catch {
    return []
  }
  return pids.flatMap((pidValue) => {
    try {
      const argv = readFileSync(join(procRoot, pidValue, 'cmdline'), 'utf8')
        .split('\0')
        .filter(Boolean)
      const commands = argv.slice(0, 3).map((arg) => basename(arg).toLowerCase())
      const provider = commands.includes('claude') ? 'claude' : commands.includes('codex') ? 'codex' : undefined
      if (!provider) return []
      const codexCommand = commands.indexOf('codex')
      if (provider === 'codex' && argv[codexCommand + 1] === 'app-server') return []
      const processStat = statSync(join(procRoot, pidValue))
      let routing: Pick<RunningAgentProcess, 'codexHome' | 'codexProfileId'> = {}
      if (provider === 'codex') {
        try {
          routing = codexProcessEnvironment(readFileSync(join(procRoot, pidValue, 'environ'), 'utf8'), '\0')
        } catch {
          /* Process environments may not be readable. */
        }
      }
      return [
        {
          pid: Number(pidValue),
          provider,
          cwd: readlinkSync(join(procRoot, pidValue, 'cwd')),
          interactive:
            provider === 'claude' ? !argv.includes('-p') && !argv.includes('--print') : !argv.includes('exec'),
          startedAt: new Date(processStat.birthtimeMs || processStat.ctimeMs).toISOString(),
          ...routing,
        } satisfies RunningAgentProcess,
      ]
    } catch {
      return []
    }
  })
}

/** Finds interactive Claude/Codex terminal sessions in Linux-visible working directories. */
export function agentCwds(procRoot = '/proc'): Set<string> {
  return new Set(
    agentProcesses(procRoot)
      .filter((process) => process.interactive !== false)
      .map((process) => process.cwd),
  )
}

export function externalAgentCwd(path: string, activeCwds: Set<string>): string | undefined {
  const roots: string[] = []
  try {
    roots.push(realpathSync(path))
  } catch {
    return undefined
  }
  for (const linksRoot of [path, join(path, 'repos')]) {
    try {
      for (const entry of readdirSync(linksRoot, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) continue
        try {
          roots.push(realpathSync(join(linksRoot, entry.name)))
        } catch {}
      }
    } catch {}
  }
  for (const root of roots) {
    for (const cwd of activeCwds) {
      const pathFromRoot = relative(root, cwd)
      if (!pathFromRoot || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))) return cwd
    }
  }
}

export function readExternalAgent(cwd: string, projectsRoot = join(homedir(), '.claude', 'projects')): AgentInfo {
  const info: AgentInfo = { status: 'rodando' }
  const projectDir = join(projectsRoot, cwd.replace(/[/.]/g, '-'))
  try {
    const sessions = readdirSync(projectDir)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => ({ path: join(projectDir, file), stat: statSync(join(projectDir, file)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    const latest = sessions[0]
    if (!latest) return info
    info.startedAt = new Date(latest.stat.birthtimeMs || latest.stat.mtimeMs).toISOString()
    let waiting = false
    for (const line of readTail(latest.path, STREAM_TAIL_BYTES).split('\n')) {
      const event = parseJsonRecord(line)
      if (!event) continue
      if (event?.isSidechain) continue
      if (event?.type === 'user') waiting = false
      if (event?.type === 'assistant') {
        waiting = record(event.message)?.stop_reason === 'end_turn'
        const narration = assistantText(event)
        if (narration) info.activity = narration
      }
    }
    if (waiting) info.status = 'aguardando'
  } catch {}
  return info
}
