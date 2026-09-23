import { readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { AgentInfo } from '../shared/domain/agents'
import { parseJsonRecord, readTail, record, summarizeAgentInput, toolUse } from './agent-log'

const STREAM_TAIL_BYTES = 128 * 1024

export interface RunningAgentProcess {
  pid: number
  provider: 'claude' | 'codex'
  cwd: string
  startedAt?: string
  /** Batch/print-mode agents are not interactive terminal sessions. */
  interactive?: boolean
}

/** Finds the agent processes visible to the backend without invoking a shell. */
export function agentProcesses(procRoot = '/proc'): RunningAgentProcess[] {
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
      const processStat = statSync(join(procRoot, pidValue))
      return [
        {
          pid: Number(pidValue),
          provider,
          cwd: readlinkSync(join(procRoot, pidValue, 'cwd')),
          interactive:
            provider === 'claude' ? !argv.includes('-p') && !argv.includes('--print') : !argv.includes('exec'),
          startedAt: new Date(processStat.birthtimeMs || processStat.ctimeMs).toISOString(),
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
        const tool = toolUse(event)
        if (tool) info.activity = [tool.name, summarizeAgentInput(record(tool.input))].filter(Boolean).join(': ')
      }
    }
    if (waiting) info.status = 'aguardando'
  } catch {}
  return info
}
