import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MEGA_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const MEGA_BRAIN_FILES = join(MEGA_ROOT, 'mega-brain-files')
export const WORKTREES = process.env.MEGA_BRAIN_WORKTREES_DIR?.trim() || join(MEGA_BRAIN_FILES, 'worktrees')

export const EMBEDDED_STAGE = 'MEGA_BRAIN_EMBEDDED_STAGE'

// O bundle de produção achata `import.meta.url` de todos os módulos no do próprio
// bundle, então comparar com argv[1] não basta para saber quem foi invocado.
export function runsAsCommand(moduleUrl: string): boolean {
  if (process.env[EMBEDDED_STAGE]) return false
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === moduleUrl
}

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
