import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { advanceCherryPick, resolveCherryPickConflict } from './conflictResolver'
import { git, hasRef } from './git'

function run(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commit(cwd: string, content: string, message: string): string {
  writeFileSync(join(cwd, 'file.txt'), content)
  run(cwd, 'add', 'file.txt')
  run(cwd, 'commit', '-qm', message)
  return run(cwd, 'rev-parse', 'HEAD')
}

test('empty cherry-pick is skipped and the remaining sequence continues without an agent', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'empty-cherry-pick-'))
  run(cwd, 'init', '-q', '-b', 'master')
  run(cwd, 'config', 'user.email', 'test@example.com')
  run(cwd, 'config', 'user.name', 'Test')
  commit(cwd, 'base\n', 'base')

  run(cwd, 'checkout', '-qb', 'feature')
  const redundant = commit(cwd, 'already applied\n', 'redundant')
  const remaining = commit(cwd, 'remaining change\n', 'remaining')

  run(cwd, 'checkout', '-qb', 'staging', 'master')
  commit(cwd, 'already applied\n', 'equivalent staging change')
  expect(() => git(cwd, 'cherry-pick', redundant, remaining)).toThrow()
  expect(hasRef(cwd, 'CHERRY_PICK_HEAD')).toBe(true)

  await resolveCherryPickConflict(cwd, 'repo', 'master', 2)

  expect(hasRef(cwd, 'CHERRY_PICK_HEAD')).toBe(false)
  expect(run(cwd, 'show', 'HEAD:file.txt')).toBe('remaining change')
  expect(run(cwd, 'log', '-1', '--format=%s')).toBe('remaining')
})

test('empty commits are counted before a real conflict is handed to the agent', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'empty-before-conflict-'))
  run(cwd, 'init', '-q', '-b', 'master')
  run(cwd, 'config', 'user.email', 'test@example.com')
  run(cwd, 'config', 'user.name', 'Test')
  writeFileSync(join(cwd, 'a.txt'), 'base\n')
  writeFileSync(join(cwd, 'b.txt'), 'base\n')
  run(cwd, 'add', '-A')
  run(cwd, 'commit', '-qm', 'base')

  run(cwd, 'checkout', '-qb', 'feature')
  writeFileSync(join(cwd, 'a.txt'), 'already applied\n')
  run(cwd, 'add', 'a.txt')
  run(cwd, 'commit', '-qm', 'redundant')
  const redundant = run(cwd, 'rev-parse', 'HEAD')
  writeFileSync(join(cwd, 'b.txt'), 'feature\n')
  run(cwd, 'add', 'b.txt')
  run(cwd, 'commit', '-qm', 'conflicting')
  const conflicting = run(cwd, 'rev-parse', 'HEAD')

  run(cwd, 'checkout', '-qb', 'staging', 'master')
  writeFileSync(join(cwd, 'a.txt'), 'already applied\n')
  writeFileSync(join(cwd, 'b.txt'), 'staging\n')
  run(cwd, 'add', '-A')
  run(cwd, 'commit', '-qm', 'staging changes')
  expect(() => git(cwd, 'cherry-pick', redundant, conflicting)).toThrow()

  expect(advanceCherryPick(cwd)).toEqual({ complete: false, skipped: 1 })
  expect(hasRef(cwd, 'CHERRY_PICK_HEAD')).toBe(true)
  expect(run(cwd, 'diff', '--name-only', '--diff-filter=U')).toBe('b.txt')
  run(cwd, 'cherry-pick', '--abort')
})

test('a resolution replayed by rerere advances the cherry-pick without an agent', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rerere-cherry-pick-'))
  run(cwd, 'init', '-q', '-b', 'master')
  run(cwd, 'config', 'user.email', 'test@example.com')
  run(cwd, 'config', 'user.name', 'Test')
  run(cwd, 'config', 'rerere.enabled', 'true')
  run(cwd, 'config', 'rerere.autoUpdate', 'true')
  commit(cwd, 'base\n', 'base')

  run(cwd, 'checkout', '-qb', 'feature')
  const conflicting = commit(cwd, 'feature\n', 'conflicting')

  run(cwd, 'checkout', '-qb', 'staging', 'master')
  commit(cwd, 'staging\n', 'staging change')
  expect(() => git(cwd, 'cherry-pick', conflicting)).toThrow()
  writeFileSync(join(cwd, 'file.txt'), 'staging + feature\n')
  run(cwd, 'add', 'file.txt')
  run(cwd, '-c', 'core.editor=true', 'cherry-pick', '--continue')

  run(cwd, 'reset', '-q', '--hard', 'HEAD~1')
  expect(() => git(cwd, 'cherry-pick', conflicting)).toThrow()

  expect(advanceCherryPick(cwd)).toEqual({ complete: true, skipped: 0 })
  expect(hasRef(cwd, 'CHERRY_PICK_HEAD')).toBe(false)
  expect(run(cwd, 'show', 'HEAD:file.txt')).toBe('staging + feature')
})
