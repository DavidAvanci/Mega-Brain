import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ToolAdapter {
  id: 'eslint' | 'prettier' | 'biome'
  executable: string
  version?: string
  supportsStdin: boolean
}

export function detectVerificationAdapters(dir: string): ToolAdapter[] {
  const packageFile = join(dir, 'package.json')
  if (!existsSync(packageFile)) return []
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const scripts = Object.values(
    (JSON.parse(readFileSync(packageFile, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? [],
  ).join('\n')
  const result: ToolAdapter[] = []
  if (deps.eslint && /\beslint\b/.test(scripts))
    result.push({
      id: 'eslint',
      executable: 'eslint',
      version: installedVersion(dir, 'eslint') ?? deps.eslint,
      supportsStdin: true,
    })
  if (deps.prettier && /\bprettier\b/.test(scripts))
    result.push({
      id: 'prettier',
      executable: 'prettier',
      version: installedVersion(dir, 'prettier') ?? deps.prettier,
      supportsStdin: true,
    })
  if (deps['@biomejs/biome'] && /\bbiome\b/.test(scripts))
    result.push({
      id: 'biome',
      executable: 'biome',
      version: installedVersion(dir, '@biomejs/biome') ?? deps['@biomejs/biome'],
      supportsStdin: true,
    })
  return result
}

function installedVersion(dir: string, packageName: string): string | undefined {
  try {
    return (
      JSON.parse(readFileSync(join(dir, 'node_modules', packageName, 'package.json'), 'utf8')) as { version?: string }
    ).version
  } catch {
    return undefined
  }
}

export function majorVersion(version: string | undefined): number {
  return Number(/^\D*(\d+)/.exec(version ?? '')?.[1] ?? 0)
}
