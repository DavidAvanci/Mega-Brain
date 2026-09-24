import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RepositoryEnvironmentKey } from '../../shared/domain/repositories'

export function parseEnvironmentVariables(
  content: string,
  allowedKeys?: ReadonlySet<string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || (allowedKeys && !allowedKeys.has(match[1]))) continue
    let value = match[2]
    if (value.startsWith('\"') && value.endsWith('\"')) {
      try { value = JSON.parse(value) as string } catch { value = value.slice(1, -1) }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    result[match[1]] = value
  }
  return result
}

export function readRepositoryEnvironmentVariables(
  repositoryPath: string,
  environment: RepositoryEnvironmentKey,
  allowedKeys?: readonly string[],
): Record<string, string> {
  const filename = environment === 'local' ? '.env.local' : environment === 'staging' ? '.env.staging' : '.env.prod'
  let content: string
  try {
    content = readFileSync(join(repositoryPath, filename), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  return parseEnvironmentVariables(content, allowedKeys ? new Set(allowedKeys) : undefined)
}
