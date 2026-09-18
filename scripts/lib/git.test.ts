import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { countCommits, featureBranch, stagingBranchOf } from './git'

function repoWith(branches: string[]): string {
  const cwd = mkdtempSync(join(tmpdir(), 'git-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  run('init', '-q', '-b', 'master')
  run('config', 'user.email', 't@t.t')
  run('config', 'user.name', 't')
  writeFileSync(join(cwd, 'a'), 'a')
  run('add', '-A')
  run('commit', '-qm', 'init')
  for (const branch of branches) run('branch', branch)
  return cwd
}

test('stagingBranchOf is idempotent', () => {
  expect(stagingBranchOf('feat/x')).toBe('feat/x-staging')
  expect(stagingBranchOf('feat/x-staging')).toBe('feat/x-staging')
})

test('featureBranch keeps a normal branch', () => {
  const cwd = repoWith(['feat/x'])
  execFileSync('git', ['checkout', '-q', 'feat/x'], { cwd })
  expect(featureBranch(cwd, 'repo')).toBe('feat/x')
})

test('featureBranch resolves the feature branch when the worktree is on the staging one', () => {
  const cwd = repoWith(['feat/x', 'feat/x-staging'])
  execFileSync('git', ['checkout', '-q', 'feat/x-staging'], { cwd })
  expect(featureBranch(cwd, 'repo')).toBe('feat/x')
})

test('featureBranch fails when only the staging branch exists', () => {
  const cwd = repoWith(['feat/x-staging'])
  execFileSync('git', ['checkout', '-q', 'feat/x-staging'], { cwd })
  expect(() => featureBranch(cwd, 'repo')).toThrow(/feat\/x não existe localmente/)
})

test('countCommits separates a master-based branch from a staging-based one', () => {
  const cwd = repoWith(['staging'])
  const run = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  const commit = (name: string) => {
    writeFileSync(join(cwd, name), name)
    run('add', '-A')
    run('commit', '-qm', name)
  }
  run('checkout', '-q', 'staging')
  commit('outra-task')
  run('checkout', '-q', '-b', 'feat/x', 'master')
  commit('nossa')
  run('checkout', '-q', '-b', 'feat/x-staging', 'staging')
  run('cherry-pick', 'feat/x')

  expect(countCommits(cwd, 'master..feat/x')).toBe(1)
  expect(countCommits(cwd, 'master..feat/x', '--not', 'staging')).toBe(1)
  expect(countCommits(cwd, 'master..feat/x-staging')).toBe(2)
  expect(countCommits(cwd, 'master..feat/x-staging', '--not', 'staging')).toBe(1)
})
