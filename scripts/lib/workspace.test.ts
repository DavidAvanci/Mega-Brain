import { mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  addDetachedWorktree,
  assertFeatureBranch,
  checkoutTaskBranch,
  dropItemWorktree,
  ensureItemWorktree,
  integrateItemBranch,
  itemBranch,
  linkProjectRuntimeFiles,
  mergeCardPrs,
  orphanItemBranches,
  registeredWorktreePaths,
  stageItemChanges,
  taskInfo,
} from './workspace'
import { currentBranch } from './git'
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

test('taskInfo card mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-'))
  const ws = join(dir, 'TAT1C0-85')
  writeFileSync(join(dir, 'x'), '')
  const { mkdirSync } = require('node:fs')
  mkdirSync(ws)
  writeFileSync(join(ws, 'card.json'), JSON.stringify({ title: 'Corrigir divisão de pagamentos' }))
  writeFileSync(join(ws, 'PLAN.md'), 'issue: TAT1C0-85\ntype: bug\n')
  const info = taskInfo(ws)
  expect(info).toMatchObject({ id: 'TAT1C0-85', jiraKey: 'TAT1C0-85', type: 'fix' })
  expect(info.branch).toBe('fix/TAT1C0-85-corrigir-divisao-de-pagamentos')
})

test('taskInfo prompt mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-'))
  const ws = join(dir, 'qr-code-generator')
  const { mkdirSync } = require('node:fs')
  mkdirSync(ws)
  const info = taskInfo(ws)
  expect(info).toMatchObject({ id: 'qr-code-generator', jiraKey: undefined, type: 'feature' })
  expect(info.branch).toBe('feature/qr-code-generator')
})

test('registeredWorktreePaths considera somente worktrees declaradas pelo Git', () => {
  const paths = registeredWorktreePaths(
    [
      'worktree /tmp/repo',
      'HEAD 0123456789012345678901234567890123456789',
      'branch refs/heads/master',
      '',
      'worktree /tmp/repo-feature',
      'HEAD 1234567890123456789012345678901234567890',
      'branch refs/heads/feature/x',
    ].join('\n'),
  )

  expect(paths).toEqual(['/tmp/repo', '/tmp/repo-feature'])
})

test('mergeCardPrs preserves the other environment', () => {
  const ws = mkdtempSync(join(tmpdir(), 'ws-'))
  writeFileSync(
    join(ws, 'card.json'),
    JSON.stringify({ title: 'x', status: 'staging', prs: { master: { 'repo-a': 'https://pr/9' } } }),
  )
  mergeCardPrs(ws, 'staging', { 'repo-a': 'https://pr/1' })
  const card = JSON.parse(readFileSync(join(ws, 'card.json'), 'utf8'))
  expect(card.prs).toEqual({ master: { 'repo-a': 'https://pr/9' }, staging: { 'repo-a': 'https://pr/1' } })
})

test('linkProjectRuntimeFiles aponta node_modules e .env para o checkout original', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-links-'))
  const original = join(root, 'master')
  const worktree = join(root, 'feature')
  mkdirSync(join(original, 'node_modules'), { recursive: true })
  mkdirSync(worktree)
  writeFileSync(join(original, 'node_modules', 'dep.js'), 'x')
  writeFileSync(join(original, '.env'), 'TOKEN=secret\n')

  linkProjectRuntimeFiles(original, worktree)

  expect(lstatSync(join(worktree, 'node_modules')).isSymbolicLink()).toBe(true)
  expect(lstatSync(join(worktree, '.env')).isSymbolicLink()).toBe(true)
  expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe('TOKEN=secret\n')
})

function repoWithOrigin(at?: string): string {
  const { mkdtempSync: mk, mkdirSync } = require('node:fs')
  const { execFileSync } = require('node:child_process')
  const bare = mk(join(tmpdir(), 'origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'master', bare], { cwd: bare })
  const cwd = at ?? mk(join(tmpdir(), 'repo-'))
  if (at) mkdirSync(at, { recursive: true })
  const run = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  run('init', '-q', '-b', 'master')
  run('config', 'user.email', 't@t.t')
  run('config', 'user.name', 't')
  writeFileSync(join(cwd, 'a'), 'a')
  run('add', '-A')
  run('commit', '-qm', 'init')
  run('remote', 'add', 'origin', bare)
  run('push', '-q', '-u', 'origin', 'master')
  run('remote', 'set-head', 'origin', '--auto')
  return cwd
}

test('assertFeatureBranch rejects the default branch', () => {
  const cwd = repoWithOrigin()
  expect(() => assertFeatureBranch(cwd, 'api-core')).toThrow(/não numa feature branch/)
})

test('assertFeatureBranch accepts a feature branch', () => {
  const cwd = repoWithOrigin()
  require('node:child_process').execFileSync('git', ['checkout', '-qb', 'fix/x'], { cwd })
  expect(() => assertFeatureBranch(cwd, 'api-core')).not.toThrow()
})

function featureRepo(): string {
  const cwd = repoWithOrigin(join(mkdtempSync(join(tmpdir(), 'task-')), 'repo'))
  execFileSync('git', ['checkout', '-qb', 'feature/x'], { cwd })
  return cwd
}

function commitIn(cwd: string, name: string, content: string): void {
  writeFileSync(join(cwd, name), content)
  execFileSync('git', ['add', '-A'], { cwd })
  execFileSync('git', ['commit', '-qm', `add ${name}`], { cwd })
}

test('ensureItemWorktree isola o item numa worktree e branch próprios', () => {
  const main = featureRepo()
  const cwd = ensureItemWorktree(main, 'TAT-1', 'repo', 'T13')
  expect(existsSync(cwd)).toBe(true)
  expect(currentBranch(cwd)).toBe('wip/TAT-1/T13')
  expect(currentBranch(main)).toBe('feature/x')
})

test('ensureItemWorktree retoma a worktree preservada sem apagar arquivo novo', () => {
  const main = featureRepo()
  const first = ensureItemWorktree(main, 'TAT-1', 'repo', 'T13')
  writeFileSync(join(first, 'novo-sem-commit.txt'), 'preservado')
  const resumed = ensureItemWorktree(main, 'TAT-1', 'repo', 'T13')
  expect(resumed).toBe(first)
  expect(readFileSync(join(resumed, 'novo-sem-commit.txt'), 'utf8')).toBe('preservado')
})

test('integrateItemBranch traz o commit do item para a branch da task', () => {
  const main = featureRepo()
  const cwd = ensureItemWorktree(main, 'TAT-1', 'repo', 'T13')
  commitIn(cwd, 'novo.txt', 'do item')
  expect(integrateItemBranch(main, itemBranch('TAT-1', 'T13'))).toEqual({ ok: true, commits: 1 })
  expect(readFileSync(join(main, 'novo.txt'), 'utf8')).toBe('do item')
})

test('conflito no cherry-pick preserva o trabalho e deixa a worktree principal limpa', () => {
  const main = featureRepo()
  const first = ensureItemWorktree(main, 'TAT-1', 'repo', 'T1')
  const second = ensureItemWorktree(main, 'TAT-1', 'repo', 'T2')
  commitIn(first, 'a', 'versao do T1')
  commitIn(second, 'a', 'versao do T2')
  expect(integrateItemBranch(main, itemBranch('TAT-1', 'T1')).ok).toBe(true)

  const conflicted = integrateItemBranch(main, itemBranch('TAT-1', 'T2'))
  expect(conflicted).toMatchObject({ ok: false, commits: 1, conflict: 'a' })
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: main, encoding: 'utf8' })).toBe('')
  expect(readFileSync(join(main, 'a'), 'utf8')).toBe('versao do T1')
  expect(readFileSync(join(second, 'a'), 'utf8')).toBe('versao do T2')
})

test('orphanItemBranches lista só o que não foi integrado, e drop limpa o par', () => {
  const main = featureRepo()
  const integrated = ensureItemWorktree(main, 'TAT-1', 'repo', 'T1')
  const orphan = ensureItemWorktree(main, 'TAT-1', 'repo', 'T2')
  commitIn(integrated, 'a', 'um')
  commitIn(orphan, 'b', 'dois')
  integrateItemBranch(main, itemBranch('TAT-1', 'T1'))

  expect(orphanItemBranches(main, 'TAT-1')).toEqual([{ itemId: 'T2', branch: 'wip/TAT-1/T2' }])

  integrateItemBranch(main, itemBranch('TAT-1', 'T2'))
  dropItemWorktree(main, 'TAT-1', 'repo', 'T2')
  expect(orphanItemBranches(main, 'TAT-1')).toEqual([])
  expect(existsSync(orphan)).toBe(false)
})

test('o node_modules symlinkado não entra no commit do item', () => {
  const main = featureRepo()
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n')
  mkdirSync(join(main, 'node_modules'))
  writeFileSync(join(main, 'node_modules', 'dep.js'), 'x')
  execFileSync('git', ['add', '-A'], { cwd: main })
  execFileSync('git', ['commit', '-qm', 'gitignore'], { cwd: main })

  const cwd = ensureItemWorktree(main, 'TAT-1', 'repo', 'T1')
  expect(lstatSync(join(cwd, 'node_modules')).isSymbolicLink()).toBe(true)
  writeFileSync(join(cwd, 'a'), 'mudou')
  stageItemChanges(cwd)
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' })
  expect(staged.split('\n').filter(Boolean)).toEqual(['a'])
})

test('o .env symlinkado não entra no commit do item', () => {
  const main = featureRepo()
  writeFileSync(join(main, '.env'), 'TOKEN=secret\n')
  const cwd = ensureItemWorktree(main, 'TAT-1', 'repo', 'T1')
  unlinkSync(join(cwd, '.env'))
  symlinkSync(join(main, '.env'), join(cwd, '.env'))
  writeFileSync(join(cwd, 'a'), 'mudou')

  stageItemChanges(cwd)

  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' })
  expect(staged.split('\n').filter(Boolean)).toEqual(['a'])
})

test('um node_modules real na worktree do item não quebra o stage', () => {
  const main = featureRepo()
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n')
  execFileSync('git', ['add', '-A'], { cwd: main })
  execFileSync('git', ['commit', '-qm', 'gitignore'], { cwd: main })

  const cwd = ensureItemWorktree(main, 'TAT-1', 'repo', 'T1')
  mkdirSync(join(cwd, 'node_modules'))
  writeFileSync(join(cwd, 'node_modules', 'dep.js'), 'x')
  writeFileSync(join(cwd, 'a'), 'mudou')
  stageItemChanges(cwd)
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' })
  expect(staged.split('\n').filter(Boolean)).toEqual(['a'])
})

test('addDetachedWorktree cria um checkout detached em origin/master com node_modules linkado', () => {
  const real = repoWithOrigin()
  mkdirSync(join(real, 'node_modules'))
  const path = join(mkdtempSync(join(tmpdir(), 'companion-')), 'repos', 'api-core')

  addDetachedWorktree(real, path)

  expect(currentBranch(path)).toBe('HEAD')
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' })).toBe(
    execFileSync('git', ['rev-parse', 'origin/master'], { cwd: real, encoding: 'utf8' }),
  )
  expect(lstatSync(join(path, 'node_modules')).isSymbolicLink()).toBe(true)
})

test('checkoutTaskBranch promove a companion detached para a branch da task', () => {
  const real = repoWithOrigin()
  const path = join(mkdtempSync(join(tmpdir(), 'companion-')), 'repos', 'api-core')
  addDetachedWorktree(real, path)

  checkoutTaskBranch(path, 'feature/x')
  expect(currentBranch(path)).toBe('feature/x')

  checkoutTaskBranch(path, 'feature/y')
  expect(currentBranch(path)).toBe('feature/x')
})
