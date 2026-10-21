import { describe, expect, it, vi } from 'vitest'

const baseline = vi.hoisted(() => vi.fn())
const runCommand = vi.hoisted(() => vi.fn())
vi.mock('./verification-baseline.ts', () => ({
  runIsolatedVerificationBaseline: baseline,
  compareDiagnosticBaseline: vi.fn(() => ({ status: 'comparable', newDiagnostics: [], existingCount: 0 })),
}))
vi.mock('./project-command.ts', () => ({ runProjectCommand: runCommand }))

import { runVerificationChecks } from './verification-runner.ts'

describe('runVerificationChecks', () => {
  it('does not prepare a baseline for a profile without executable commands', async () => {
    baseline.mockClear()
    const profile = {
      schemaVersion: 1 as const,
      repo: 'api', fingerprint: 'fp',
      runtime: { server: { version: 'v24', execPath: '/node' }, project: { version: '24', execPath: '/node' }, requirement: { source: 'none' as const, policy: 'server-default' as const } },
      commands: [], skipped: [{ id: 'lint', reason: 'Sem ferramenta aplicável.' }],
      formatting: { mode: 'disabled' as const }, createdAt: '2026-01-01T00:00:00.000Z',
    }
    const checks = await runVerificationChecks({
      projects: [{ repo: 'api', path: '/repo', baseRef: 'base', files: ['src/a.ts'], renamed: [] }],
      profiles: new Map([['api', profile]]), round: 1, baselineRoot: '/tmp/baselines',
    })
    expect(baseline).not.toHaveBeenCalled()
    expect(checks).toContainEqual(expect.objectContaining({ name: 'lint', status: 'skipped' }))
  })

  it('prepares baselines concurrently before running project commands', async () => {
    let active = 0
    let maxActive = 0
    baseline.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active--
      return { status: 'ready', profileFingerprint: 'fp', diagnostics: { eslint: [] } }
    })
    runCommand.mockResolvedValue({ status: 'passed', code: 0, stdout: '[]', stderr: '', durationMs: 1 })
    const profile = {
      schemaVersion: 1 as const,
      repo: 'api', fingerprint: 'fp',
      runtime: { server: { version: 'v24', execPath: '/node' }, project: { version: '24', execPath: '/node' }, requirement: { source: 'none' as const, policy: 'server-default' as const } },
      commands: [{ id: 'eslint', argv: ['eslint', '--format', 'json'], cwd: '/repo', timeoutMs: 1000, writeMode: 'read-only' as const, scope: 'card-files' as const }],
      skipped: [], formatting: { mode: 'disabled' as const }, createdAt: '2026-01-01T00:00:00.000Z',
    }
    const projects = ['api', 'web'].map((repo) => ({ repo, path: `/${repo}`, baseRef: 'base', files: ['src/a.ts'], renamed: [] }))
    const profiles = new Map(projects.map((project) => [project.repo, { ...profile, repo: project.repo }]))

    const checks = await runVerificationChecks({ projects, profiles, round: 1, baselineRoot: '/tmp/baselines' })

    expect(maxActive).toBe(2)
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(checks.every((check) => check.status === 'passed')).toBe(true)
  })

  it('does not prepare a baseline when all changed files are excluded from runnable checks', async () => {
    baseline.mockClear()
    runCommand.mockClear()
    const profile = {
      schemaVersion: 1 as const,
      repo: 'api', fingerprint: 'fp',
      runtime: { server: { version: 'v24', execPath: '/node' }, project: { version: '24', execPath: '/node' }, requirement: { source: 'none' as const, policy: 'server-default' as const } },
      commands: [{ id: 'eslint', argv: ['eslint', '--format', 'json'], cwd: '/repo', timeoutMs: 1000, writeMode: 'read-only' as const, scope: 'card-files' as const }],
      skipped: [], formatting: { mode: 'disabled' as const }, createdAt: '2026-01-01T00:00:00.000Z',
    }
    const checks = await runVerificationChecks({
      projects: [{ repo: 'api', path: '/repo', baseRef: 'base', files: ['src/logo.svg', 'src/routeTree.gen.ts'], renamed: [] }],
      profiles: new Map([['api', profile]]), round: 1, baselineRoot: '/tmp/baselines',
    })
    expect(baseline).not.toHaveBeenCalled()
    expect(runCommand).not.toHaveBeenCalled()
    expect(checks).toContainEqual(expect.objectContaining({ name: 'eslint', status: 'skipped', summary: expect.stringContaining('logo.svg') }))
  })
})
