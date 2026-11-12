import { describe, expect, it } from 'vitest'
import { classifyCheckOutcome, parseVerificationReport, verificationChecksSucceeded, verificationChecksSummary, parseEslintDiagnostics, parseAdapterDiagnostics } from './verification-report.ts'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile = {
  schemaVersion: 1 as const,
  repo: 'web',
  fingerprint: 'abc',
  runtime: {
    server: { version: 'v24.0.0', execPath: '/node' },
    project: { version: '24.0.0', execPath: '/node' },
    requirement: { source: 'none' as const, policy: 'server-default' as const },
  },
  commands: [
    {
      id: 'lint',
      repo: 'web',
      name: 'lint',
      argv: ['eslint'],
      cwd: '/repo',
      timeoutMs: 1000,
      writeMode: 'read-only' as const,
      scope: 'card-files' as const,
    },
  ],
  skipped: [],
  formatting: { mode: 'disabled' as const },
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('parseVerificationReport', () => {
  it('accepts only the expected profile and known repository', () => {
    const report = parseVerificationReport(
      {
        schemaVersion: 1,
        profiles: [{ repo: 'web', fingerprint: 'abc' }],
        round: 2,
        checks: [
          {
            id: 'lint',
            repo: 'web',
            name: 'lint',
            status: 'passed',
            summary: 'ok',
            profileFingerprint: 'abc',
            commandId: 'lint',
          },
        ],
      },
      { profiles: new Map([['web', profile]]), round: 2 },
    )
    expect(report.checks[0].status).toBe('passed')
    expect(() =>
      parseVerificationReport(
        { schemaVersion: 1, profiles: [{ repo: 'web', fingerprint: 'old' }], round: 2, checks: [] },
        { profiles: new Map([['web', profile]]), round: 2 },
      ),
    ).toThrow(/perfil/)
  })

  it('rejects malformed round summaries instead of trusting persisted metadata', () => {
    expect(() => parseVerificationReport({
      schemaVersion: 1,
      profiles: [{ repo: 'web', fingerprint: 'abc' }],
      round: 1,
      checks: [],
      roundSummary: { durationMs: -1, agentDurationMs: 0, repairsCreated: 0, repairsReused: 0, statusCounts: {} },
    }, { profiles: new Map([['web', profile]]), round: 1 })).toThrow(/Resumo da rodada/)
  })
})

describe('classifyCheckOutcome', () => {
  it('does not promote a failed command to code failure without comparable baseline evidence', () => {
    const check = classifyCheckOutcome({
      repo: 'web',
      profile,
      commandId: 'lint',
      files: ['src/a.ts'],
      result: { status: 'failed', code: 1, stdout: '', stderr: 'failed', durationMs: 20 },
      baseline: { status: 'inconclusive', reason: 'invalid base config' },
    })
    expect(check).toMatchObject({ status: 'inconclusive', cause: 'unknown' })
  })

  it('classifies resource exhaustion from process evidence', () => {
    const check = classifyCheckOutcome({
      repo: 'web',
      profile,
      commandId: 'lint',
      files: ['src/a.ts'],
      result: { status: 'failed', code: 1, stdout: '', stderr: 'JavaScript heap out of memory', durationMs: 20 },
    })
    expect(check).toMatchObject({ status: 'environment', cause: 'resource' })
  })
})

describe('verification outcome and symlink diagnostics', () => {
  const check = (status: 'passed' | 'skipped' | 'failed' | 'environment' | 'inconclusive') => ({
    id: status, repo: 'web', name: status, status, summary: status, profileFingerprint: 'abc',
  } as const)

  it('treats skipped checks as neutral, including an all-skipped round', () => {
    expect(verificationChecksSucceeded([check('passed'), check('skipped')])).toBe(true)
    expect(verificationChecksSucceeded([check('skipped')])).toBe(true)
    expect(verificationChecksSummary([check('skipped')])).toContain('nada foi validado')
    expect(verificationChecksSummary([check('passed'), check('skipped'), check('failed')])).toContain(
      '1 aprovadas, 1 falhas, 1 ignoradas',
    )
    for (const status of ['failed', 'environment', 'inconclusive'] as const)
      expect(verificationChecksSucceeded([check('passed'), check(status)])).toBe(false)
  })

  it('normalizes ESLint and Biome diagnostic paths through a symlinked cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'verification-symlink-'))
    const real = join(root, 'real')
    const link = join(root, 'link')
    mkdirSync(real)
    writeFileSync(join(real, 'a.ts'), '')
    symlinkSync(real, link, 'junction')
    try {
      const eslint = JSON.stringify([{ filePath: join(real, 'a.ts'), messages: [{ ruleId: 'x', message: 'bad' }] }])
      const biome = JSON.stringify({ diagnostics: [{ location: { path: { file: join(real, 'a.ts') } }, category: 'x', message: 'bad' }] })
      expect(parseEslintDiagnostics(eslint, link, 'web')?.[0].file).toBe('a.ts')
      expect(parseAdapterDiagnostics('biome', biome, link, 'web', ['a.ts'])?.[0].file).toBe('a.ts')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
