import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const command = vi.hoisted(() => vi.fn())
vi.mock('./project-command.ts', () => ({ runProjectCommand: command }))
import { prepareBaselineDependencies, removeBaselineModulesLink } from './verification-baseline.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(lock: string) {
  const root = mkdtempSync(join(tmpdir(), 'verification-baseline-'))
  roots.push(root)
  const projectPath = join(root, 'card')
  const baselinePath = join(root, 'base')
  mkdirSync(join(projectPath, 'node_modules'), { recursive: true })
  mkdirSync(baselinePath)
  for (const path of [projectPath, baselinePath]) {
    writeFileSync(join(path, 'package.json'), JSON.stringify({ packageManager: 'npm@10' }))
    writeFileSync(join(path, 'package-lock.json'), lock)
  }
  return { projectPath, baselinePath }
}

describe('baseline dependencies', () => {
  it('reuses node_modules when lockfiles match and removes only the junction', async () => {
    const paths = fixture('same')
    command.mockClear()
    expect(await prepareBaselineDependencies({ ...paths, runtime: { execPath: process.execPath } })).toEqual({ status: 'ready' })
    expect(command).not.toHaveBeenCalled()
    expect(lstatSync(join(paths.baselinePath, 'node_modules')).isSymbolicLink()).toBe(true)
    removeBaselineModulesLink(paths.baselinePath)
    expect(existsSync(join(paths.baselinePath, 'node_modules'))).toBe(false)
    expect(existsSync(join(paths.projectPath, 'node_modules'))).toBe(true)
  })

  it('runs an isolated install when lockfiles differ and reports install failures', async () => {
    const paths = fixture('base-lock')
    writeFileSync(join(paths.projectPath, 'package-lock.json'), 'card-lock')
    command.mockResolvedValueOnce({ status: 'passed' }).mockResolvedValueOnce({ status: 'failed' })
    const runtime = { execPath: process.execPath }
    expect(await prepareBaselineDependencies({ ...paths, runtime })).toEqual({ status: 'ready' })
    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0][0]).toMatchObject({ id: 'baseline-install', cwd: paths.baselinePath })
    expect(await prepareBaselineDependencies({ ...paths, runtime })).toMatchObject({ status: 'inconclusive', reason: expect.stringContaining('falhou') })
  })
})
