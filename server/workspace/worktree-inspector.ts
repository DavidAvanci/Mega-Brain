import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProcessRunner } from '../process'
import { nodeProcessRunner } from '../process'
import type { WorktreeOrigin } from './card-record'

export interface WorktreeRepo {
  name: string
  path: string
}

export function cardRepos(path: string): WorktreeRepo[] {
  const linksRoot = existsSync(join(path, 'repos')) ? join(path, 'repos') : path
  return readdirSync(linksRoot, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .flatMap((entry) => {
      try {
        const real = realpathSync(join(linksRoot, entry.name))
        return existsSync(join(real, '.git')) ? [{ name: entry.name, path: real }] : []
      } catch {
        return []
      }
    })
}

export interface WorktreeRepoInfo {
  name: string
  path: string
  repository: string
  remote?: string
  branch: string
  head: { hash: string; shortHash: string; subject: string; committedAt: string }
  base?: { ref: string; hash: string; shortHash: string; inferred: boolean; createdAt?: string }
  dirty: boolean
  error?: string
}

export function gitOut(cwd: string, git: string | undefined, runner: ProcessRunner, ...args: string[]): string {
  return String(
    runner.execFileSync(git ?? 'git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
}

function optionalGitOut(
  cwd: string,
  git: string | undefined,
  runner: ProcessRunner,
  ...args: string[]
): string | undefined {
  try {
    return gitOut(cwd, git, runner, ...args).trim() || undefined
  } catch {
    return undefined
  }
}

function worktreeBaseRef(cwd: string, git: string | undefined, runner: ProcessRunner): string | undefined {
  const remoteHead = optionalGitOut(cwd, git, runner, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  if (remoteHead) return remoteHead
  return ['origin/master', 'origin/main'].find((ref) =>
    Boolean(optionalGitOut(cwd, git, runner, 'rev-parse', '--verify', '--quiet', ref)),
  )
}

/** Git metadata shown in the card so a checkout can be traced back to its base version. */
export function worktreeRepoInfo(
  repo: WorktreeRepo,
  git?: string,
  runner: ProcessRunner = nodeProcessRunner,
  recordedOrigin?: WorktreeOrigin,
): WorktreeRepoInfo {
  try {
    const [hash, shortHash, subject, committedAt] = gitOut(
      repo.path,
      git,
      runner,
      'show',
      '-s',
      '--format=%H%x00%h%x00%s%x00%cI',
      'HEAD',
    )
      .trim()
      .split('\0')
    const commonGitDir = gitOut(
      repo.path,
      git,
      runner,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ).trim()
    const baseRef = recordedOrigin?.ref ?? worktreeBaseRef(repo.path, git, runner)
    const baseHash =
      recordedOrigin?.hash ??
      (baseRef ? optionalGitOut(repo.path, git, runner, 'merge-base', baseRef, 'HEAD') : undefined)
    return {
      name: repo.name,
      path: repo.path,
      repository: recordedOrigin?.repository ?? dirname(commonGitDir),
      remote: optionalGitOut(repo.path, git, runner, 'remote', 'get-url', 'origin'),
      branch: gitOut(repo.path, git, runner, 'rev-parse', '--abbrev-ref', 'HEAD').trim(),
      head: { hash, shortHash, subject, committedAt },
      base:
        baseRef && baseHash
          ? {
              ref: baseRef,
              hash: baseHash,
              shortHash: baseHash.slice(0, 7),
              inferred: !recordedOrigin,
              createdAt: recordedOrigin?.createdAt,
            }
          : undefined,
      dirty: Boolean(gitOut(repo.path, git, runner, 'status', '--porcelain').trim()),
    }
  } catch (error) {
    return {
      name: repo.name,
      path: repo.path,
      repository: repo.path,
      branch: 'desconhecida',
      head: { hash: '', shortHash: '', subject: '', committedAt: '' },
      dirty: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function diffBase(cwd: string, git: string | undefined, runner: ProcessRunner): string {
  const heads = ['origin/master', 'origin/main']
  try {
    heads.unshift(gitOut(cwd, git, runner, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim())
  } catch {}
  for (const head of heads) {
    try {
      return gitOut(cwd, git, runner, 'merge-base', head, 'HEAD').trim()
    } catch {}
  }
  return 'HEAD'
}

function untrackedDiff(cwd: string, file: string, git: string | undefined, runner: ProcessRunner): string {
  try {
    return gitOut(cwd, git, runner, 'diff', '--no-color', '--no-index', '/dev/null', file)
  } catch (error: unknown) {
    const output = error && typeof error === 'object' ? (error as { stdout?: unknown }).stdout : undefined
    return typeof output === 'string' ? output : ''
  }
}

export function repoDiff(cwd: string, git?: string, runner: ProcessRunner = nodeProcessRunner): string {
  const tracked = gitOut(cwd, git, runner, 'diff', '--no-color', diffBase(cwd, git, runner))
  const untracked = gitOut(cwd, git, runner, 'ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter(Boolean)
    .map((file) => untrackedDiff(cwd, file, git, runner))
  return [tracked, ...untracked].filter(Boolean).join('')
}
