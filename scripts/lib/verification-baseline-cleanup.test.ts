import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runCommand = vi.hoisted(() => vi.fn())
vi.mock('./project-command.ts', () => ({ runProjectCommand: runCommand }))
vi.mock('./project-node.ts', () => ({
  resolveProjectNode: () => ({
    status: 'resolved',
    runtime: {
      server: { version: 'v24.0.0', execPath: process.execPath },
      project: { version: '24.0.0', execPath: process.execPath },
      requirement: { source: 'none', policy: 'server-default' },
    },
  }),
}))
import { runIsolatedVerificationBaseline } from './verification-baseline.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('runIsolatedVerificationBaseline cleanup', () => {
  it('removes its dependency junction after a check fails and preserves the card node_modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verification-cleanup-'))
    roots.push(root)
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Verification test'], { cwd: root })
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'eslint'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint src' }, devDependencies: { eslint: '^9.0.0' } }))
    writeFileSync(join(root, 'package-lock.json'), 'same-lock')
    writeFileSync(join(root, 'src', 'a.ts'), 'export const value = 1\n')
    writeFileSync(join(root, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '9.1.0' }))
    execFileSync('git', ['add', 'package.json', 'package-lock.json', 'src/a.ts'], { cwd: root })
    execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: root })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const worktreePath = join(root, 'baselines', 'api')
    runCommand.mockRejectedValueOnce(new Error('simulated lint failure'))

    const result = await runIsolatedVerificationBaseline({
      repoPath: root,
      baseRef: head,
      worktreePath,
      repo: 'api',
      files: ['src/a.ts'],
    })

    expect(result).toMatchObject({ status: 'inconclusive', reason: 'simulated lint failure' })
    expect(existsSync(worktreePath)).toBe(false)
    expect(readFileSync(join(root, 'node_modules', 'eslint', 'package.json'), 'utf8')).toContain('9.1.0')
    expect(runCommand).toHaveBeenCalledTimes(1)
  })
})
