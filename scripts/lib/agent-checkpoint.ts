import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProvider } from '../../shared/domain/agents.ts'

type ItemCheckpoint = { provider: AgentProvider; args: string[]; sessionId?: string }

/** Separate files allow parallel items to save sessions without overwriting each other. */
export function itemCheckpoint(cardPath: string | undefined, cwd: string, prompt: string) {
  const runId = process.env.MEGA_BRAIN_STAGE_RUN_ID
  const key = createHash('sha256').update(`${cwd}\0${prompt}`).digest('hex')
  const directory = cardPath && runId ? join(cardPath, '.agent-checkpoints', runId) : undefined
  const file = directory ? join(directory, `${key}.json`) : undefined
  const read = (): ItemCheckpoint | undefined => {
    if (!file) return undefined
    try {
      const value: ItemCheckpoint = JSON.parse(readFileSync(file, 'utf8'))
      if (
        (value.provider !== 'claude' && value.provider !== 'codex') ||
        !Array.isArray(value.args) ||
        !value.args.every((arg) => typeof arg === 'string')
      )
        return undefined
      return value
    } catch {
      return undefined
    }
  }
  return {
    read,
    save(value: ItemCheckpoint) {
      if (!file || !directory) return
      mkdirSync(directory, { recursive: true })
      writeFileSync(`${file}.tmp`, `${JSON.stringify(value)}\n`)
      renameSync(`${file}.tmp`, file)
    },
    clear() {
      if (file) rmSync(file, { force: true })
    },
  }
}
