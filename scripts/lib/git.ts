import { existsSync } from 'node:fs'
import { nodeProcessRunner, type ProcessRunner } from '../../server/process.ts'

export class CmdError extends Error {
  readonly raw: string
  constructor(cmd: string, output: string) {
    super(`${cmd}: ${output.trim().split('\n').slice(-3).join(' | ')}`)
    this.raw = output.trim()
  }
}

function runRaw(cwd: string, cmd: string, args: readonly string[], runner: ProcessRunner = nodeProcessRunner): string {
  try {
    return String(runner.execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch (error: unknown) {
    const detail =
      error && typeof error === 'object'
        ? (error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: unknown })
        : undefined
    const output = `${String(detail?.stdout ?? '')}\n${String(detail?.stderr ?? '')}`.trim()
    const where = detail?.code === 'ENOENT' && !existsSync(cwd) ? ` (cwd inexistente: ${cwd})` : ''
    throw new CmdError(`${cmd} ${args.slice(0, 3).join(' ')}`, `${output || String(detail?.message ?? error)}${where}`)
  }
}

export function run(cwd: string, cmd: string, ...args: string[]): string {
  return runRaw(cwd, cmd, args).trim()
}

export const git = (cwd: string, ...args: string[]): string => run(cwd, 'git', ...args)
export const gh = (cwd: string, ...args: string[]): string => run(cwd, 'gh', ...args)

export function defaultBranch(cwd: string): string {
  try {
    return git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').split('/').pop() as string
  } catch {
    git(cwd, 'remote', 'set-head', 'origin', '--auto')
    return git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').split('/').pop() as string
  }
}

export function currentBranch(cwd: string): string {
  return git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD')
}

export function changedFiles(cwd: string): string[] {
  const entries = runRaw(cwd, 'git', ['status', '--porcelain', '--untracked-files=all', '-z'])
    .split('\0')
    .filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    paths.push(entries[i].slice(3))
    // rename/copy vem como "XY novo\0antigo": pular o path de origem
    if (entries[i][0] === 'R' || entries[i][0] === 'C') i++
  }
  return paths
}

export function existingPrUrl(cwd: string, head: string, base: string): string | null {
  try {
    const out = gh(
      cwd,
      'pr',
      'list',
      '--head',
      head,
      '--base',
      base,
      '--state',
      'open',
      '--json',
      'url',
      '-q',
      '.[0].url',
    )
    return out || null
  } catch {
    return null
  }
}

export const STAGING_SUFFIX = '-staging'

export const stagingBranchOf = (branch: string): string =>
  branch.endsWith(STAGING_SUFFIX) ? branch : `${branch}${STAGING_SUFFIX}`

export function hasRef(cwd: string, ref: string): boolean {
  try {
    git(cwd, 'rev-parse', '--verify', '--quiet', ref)
    return true
  } catch {
    return false
  }
}

export function countCommits(cwd: string, ...revs: string[]): number {
  return Number(git(cwd, 'rev-list', '--count', ...revs))
}

export function featureBranch(cwd: string, label: string): string {
  const branch = currentBranch(cwd)
  if (!branch.endsWith(STAGING_SUFFIX)) return branch
  const feature = branch.slice(0, -STAGING_SUFFIX.length)
  if (!hasRef(cwd, `refs/heads/${feature}`)) {
    throw new Error(`${label}: worktree está em ${branch} (branch de staging) e ${feature} não existe localmente`)
  }
  return feature
}
