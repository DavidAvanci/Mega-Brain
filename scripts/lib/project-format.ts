import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { runProjectCommand, type ProjectCommandResult } from './project-command.ts'

export type FormatCommandResult = ProjectCommandResult | { status: 'skipped'; code: null; stdout: string; stderr: string; durationMs: number }

export async function formatProjectFiles(options: {
  cwd: string
  files: string[]
  formatter: 'prettier' | 'biome'
  node: { execPath: string; version: string }
  timeoutMs?: number
  allowWholeFile?: boolean
  recordFile?: string
}): Promise<FormatCommandResult> {
  if (!options.allowWholeFile)
    return { status: 'skipped', code: null, stdout: '', stderr: 'Formatação de arquivo inteiro não foi autorizada pelo perfil.', durationMs: 0 }
  const files = [...new Set(options.files)]
    .filter(
      (file) => !isAbsolute(file) && !file.split(/[\\/]/).includes('..') && existsSync(resolve(options.cwd, file)),
    )
    .sort()
  if (!files.length) return { status: 'passed', code: 0, stdout: '', stderr: '', durationMs: 0, runtime: options.node }
  const args =
    options.formatter === 'biome' ? ['biome', 'format', '--write', ...files] : ['prettier', '--write', ...files]
  return runProjectCommand(
    { id: 'format', argv: args, cwd: options.cwd, timeoutMs: options.timeoutMs ?? 120_000, recordFile: options.recordFile },
    options.node,
  )
}
