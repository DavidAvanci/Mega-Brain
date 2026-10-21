import { git, defaultBranch } from './git.ts'

export interface CardChangeScope {
  base: string
  added: string[]
  modified: string[]
  renamed: { from: string; to: string }[]
  deleted: string[]
}

export function cardChangeScope(repoPath: string, baseRef?: string): CardChangeScope {
  const base = baseRef
    ? git(repoPath, 'rev-parse', '--verify', `${baseRef}^{commit}`)
    : git(repoPath, 'merge-base', 'HEAD', `origin/${defaultBranch(repoPath)}`)
  const raw = git(repoPath, 'diff', '--name-status', '-M', `${base}...HEAD`)
  const added: string[] = [],
    modified: string[] = [],
    deleted: string[] = [],
    renamed: { from: string; to: string }[] = []
  for (const line of raw.split('\n').map((entry) => entry.replace(/\r$/, '')).filter(Boolean)) {
    const [status, first, second] = line.split('\t')
    if (status === 'A') added.push(first)
    else if (status === 'D') deleted.push(first)
    else if (status?.startsWith('R') && second) renamed.push({ from: first, to: second })
    else if (first) modified.push(first)
  }
  return { base, added, modified, renamed, deleted }
}
