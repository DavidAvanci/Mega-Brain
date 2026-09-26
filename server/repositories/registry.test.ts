import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeProcessRunner, type ProcessRunner } from '../process'
import { RepositoryRegistry } from './registry'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 }).trim()
}
async function fixture(runner: ProcessRunner = nodeProcessRunner) {
  const root = await mkdtemp(join(tmpdir(), 'mb-repository-test-'))
  dirs.push(root)
  const remote = join(root, 'remote.git')
  git(root, 'init', '--bare', remote)
  const path = join(root, 'checkout')
  git(root, 'clone', remote, path)
  git(path, 'config', 'user.email', 'test@example.com')
  git(path, 'config', 'user.name', 'Test')
  await writeFile(join(path, 'file.txt'), 'initial\n')
  git(path, 'add', '.')
  git(path, 'commit', '-m', 'initial')
  git(path, 'push', '-u', 'origin', 'HEAD')
  const file = join(root, 'repositories.json')
  await writeFile(file, JSON.stringify({ version: 1, repositories: [{ id: 'one', alias: 'one', displayName: 'One', path, active: true, tags: [], environments: { local: { enabled: true }, staging: { enabled: false }, prod: { enabled: false } } }] }))
  return { root, remote, path, file, registry: new RepositoryRegistry(file, runner) }
}
async function remoteCommit(root: string, remote: string, text: string) {
  const other = join(root, `other-${text}`)
  git(root, 'clone', remote, other)
  git(other, 'config', 'user.email', 'test@example.com')
  git(other, 'config', 'user.name', 'Test')
  await writeFile(join(other, `${text}.txt`), text)
  git(other, 'add', '.')
  git(other, 'commit', '-m', text)
  git(other, 'push')
}

describe('RepositoryRegistry remote updates', () => {
  it('reads a version 1 catalog without rewriting it and distinguishes local from fetched state', async () => {
    const f = await fixture()
    const before = await readFile(f.file, 'utf8')
    expect((await f.registry.list())[0].environments.local.migration).toBeUndefined()
    expect(await readFile(f.file, 'utf8')).toBe(before)
    expect((await f.registry.status('one')).source).toBe('local')
    expect((await f.registry.verifyRemote('one')).state).toBe('up-to-date')
    const cardWorktree = join(f.root, 'card-worktree')
    git(f.path, 'worktree', 'add', '-b', 'card-test', cardWorktree)
    const cardHead = git(cardWorktree, 'rev-parse', 'HEAD')
    await remoteCommit(f.root, f.remote, 'remote')
    expect((await f.registry.status('one')).state).toBe('up-to-date')
    const fetched = await f.registry.verifyRemote('one')
    expect(fetched).toMatchObject({ state: 'behind', ahead: 0, behind: 1, source: 'remote' })
    expect(fetched.remoteCheckedAt).toBeTruthy()
    expect(git(f.path, 'rev-parse', 'HEAD')).not.toBe(git(f.path, 'rev-parse', '@{upstream}'))
    expect((await f.registry.pull('one')).state).toBe('up-to-date')
    expect(git(cardWorktree, 'rev-parse', 'HEAD')).toBe(cardHead)
    expect((await f.registry.status('one')).migrationReady).toBe(true)
  })

  it('blocks dirty and diverged checkouts, and reports ahead and missing upstream', async () => {
    const f = await fixture()
    await writeFile(join(f.path, 'local.txt'), 'local')
    git(f.path, 'add', '.')
    git(f.path, 'commit', '-m', 'local')
    expect((await f.registry.verifyRemote('one')).state).toBe('ahead')
    await remoteCommit(f.root, f.remote, 'remote')
    expect((await f.registry.verifyRemote('one')).state).toBe('diverged')
    expect((await f.registry.pull('one')).error).toContain('diverged')
    git(f.path, 'reset', '--hard', 'HEAD~1')
    await writeFile(join(f.path, 'dirty.txt'), 'dirty')
    expect((await f.registry.pull('one')).error).toContain('alterações locais')
    git(f.path, 'branch', '--unset-upstream')
    expect((await f.registry.status('one')).state).toBe('no-upstream')
  })

  it('reports fetch timeout per repository and never pulls after it', async () => {
    let pulls = 0
    const runner: ProcessRunner = { ...nodeProcessRunner, execFile(command, args, options, callback) {
      if (command === 'git' && args[0] === 'fetch') {
        expect(options.timeout).toBe(30_000)
        callback(new Error('timed out'), '', '')
      } else if (command === 'git' && args[0] === 'pull') { pulls++; callback(null, '', '') }
      else nodeProcessRunner.execFile(command, args, options, callback)
    } }
    const f = await fixture(runner)
    expect((await f.registry.verifyRemote('one')).state).toBe('remote-failed')
    expect((await f.registry.pull('one')).state).toBe('remote-failed')
    expect(pulls).toBe(0)
  })

  it('records a migration timeout separately from the successful pull', async () => {
    const runner: ProcessRunner = { ...nodeProcessRunner, execFile(command, args, options, callback) {
      if (command === 'fake-migrate') {
        expect(options.timeout).toBe(120_000)
        callback(new Error('timed out'), '', '')
      } else nodeProcessRunner.execFile(command, args, options, callback)
    } }
    const f = await fixture(runner)
    await f.registry.update('one', { environments: { local: { enabled: true, migration: { backend: true, command: ['fake-migrate'], workingDirectory: '.' } } } })
    await remoteCommit(f.root, f.remote, 'remote')
    expect((await f.registry.pull('one')).state).toBe('up-to-date')
    const result = await f.registry.migrate('one', 'local')
    expect(result).toMatchObject({ state: 'failure', error: 'timed out' })
    expect((await f.registry.status('one')).state).toBe('up-to-date')
  })

  it('requires explicit migration configuration and a successful pull', async () => {
    const f = await fixture()
    await expect(f.registry.migrate('one', 'local')).rejects.toThrow('não configurada')
    await f.registry.update('one', { environments: { local: { enabled: true, migration: { backend: true, command: ['git', 'status', '--short'], workingDirectory: '.' } } } })
    await expect(f.registry.migrate('one', 'local')).rejects.toThrow('Atualize')
    await remoteCommit(f.root, f.remote, 'remote')
    expect((await f.registry.pull('one')).state).toBe('up-to-date')
    expect((await f.registry.migrate('one', 'local')).state).toBe('success')
    expect(f.registry.migrationResult('one').state).toBe('success')
  })
})
