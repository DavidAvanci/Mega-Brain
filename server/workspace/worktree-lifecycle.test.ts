import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { nodeProcessRunner } from '../process'
import { deleteCard } from './worktree-lifecycle'

const root = mkdtempSync(join(tmpdir(), 'mega-brain-worktree-lifecycle-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()

test('apagar card MB remove as worktrees e a pasta da task em minúsculas', () => {
  const mainRepo = join(root, 'repo')
  mkdirSync(mainRepo)
  git(mainRepo, 'init', '-q', '-b', 'main')
  git(mainRepo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')

  const worktreesRoot = join(root, 'worktrees')
  const taskRoot = join(worktreesRoot, 'mb-7')
  git(mainRepo, 'worktree', 'add', '-q', '-b', 'feature/mb-7', join(taskRoot, 'repos', 'repo'))
  git(mainRepo, 'worktree', 'add', '-q', '-b', 'wip/mb-7/T1', join(taskRoot, 'items', 'T1', 'repo'))
  mkdirSync(join(taskRoot, 'baselines'))
  writeFileSync(join(taskRoot, 'baselines', 'snapshot.json'), '{}')

  const cardPath = join(root, 'workspace', 'MB-7')
  mkdirSync(cardPath, { recursive: true })
  writeFileSync(join(cardPath, 'card.json'), '{}')

  deleteCard(cardPath, worktreesRoot, undefined, nodeProcessRunner)

  expect(existsSync(taskRoot)).toBe(false)
  expect(existsSync(cardPath)).toBe(false)
  expect(git(mainRepo, 'worktree', 'list', '--porcelain')).not.toContain('mb-7')
})
