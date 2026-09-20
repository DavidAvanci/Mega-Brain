import { readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentInfo } from '../shared/domain/agents'
import { parseJsonRecord, readTail, record, summarizeAgentInput, toolUse } from './agent-log'

const STREAM_TAIL_BYTES = 128 * 1024

/** Finds Claude/Codex processes running from Linux-visible working directories. */
export function agentCwds(): Set<string> {
  const cwds = new Set<string>()
  let pids: string[]
  try {
    pids = readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))
  } catch {
    return cwds
  }
  for (const pid of pids) {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0', 2)
      if (!argv.some((arg) => ['claude', 'codex'].includes(basename(arg)))) continue
      cwds.add(readlinkSync(`/proc/${pid}/cwd`))
    } catch {}
  }
  return cwds
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
      if (cwd === root || cwd.startsWith(`${root}/`)) return cwd
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
