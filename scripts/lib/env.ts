import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MEGA_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const TAKEAT = join(homedir(), 'takeat')
export const MEGA_BRAIN_FILES = join(MEGA_ROOT, 'mega-brain-files')
export const WORKTREES = process.env.MEGA_BRAIN_WORKTREES_DIR?.trim() || join(MEGA_BRAIN_FILES, 'worktrees')

export function loadEnv(root = MEGA_ROOT): Record<string, string> {
  let raw = ''
  try {
    raw = readFileSync(join(root, '.env.local'), 'utf8')
  } catch {
    return {}
  }
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return env
}
