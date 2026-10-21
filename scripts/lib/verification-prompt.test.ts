import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_PROMPTS } from '../../shared/domain/settings'
import type { VerificationProfile } from '../../shared/domain/verification.ts'
import { verificationPrompt } from './verification-prompt'

afterEach(() => vi.unstubAllEnvs())

const profile: VerificationProfile = {
  schemaVersion: 1,
  repo: 'api',
  fingerprint: 'profile-fingerprint',
  runtime: {
    server: { version: 'v24.0.0', execPath: '/node' },
    project: { version: '24.0.0', execPath: '/node' },
    requirement: { source: 'none', policy: 'server-default' },
  },
  commands: [{ id: 'eslint', argv: ['eslint', '--format', 'json'], cwd: '/work/api', timeoutMs: 1000, writeMode: 'read-only', scope: 'card-files' }],
  skipped: [],
  formatting: { mode: 'disabled' },
  createdAt: '2026-01-01T00:00:00Z',
}

test('passes prior wave evidence, runtime, profile and card diff with mandatory read-only rules', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-verifier-prompt-'))
  try {
    const settings = join(root, 'settings.json')
    writeFileSync(settings, JSON.stringify({ prompts: { taskVerification: 'Verifique a implementação personalizada.' } }))
    vi.stubEnv('MEGA_BRAIN_SETTINGS_FILE', settings)
    const prompt = verificationPrompt({
      round: 3,
      projects: [{ repo: 'api', path: '/work/api', baseRef: 'abc123', files: ['src/service.ts'], renamed: [] }],
      profiles: new Map([['api', profile]]),
      checks: [{ id: 'eslint', repo: 'api', name: 'eslint', status: 'failed', cause: 'code', summary: 'diagnóstico confirmado', commandId: 'eslint', profileFingerprint: profile.fingerprint, files: ['src/service.ts'], diagnostics: [{ file: 'src/service.ts', rule: 'no-unused-vars', message: 'Unused variable' }] }],
      previousChecks: [{ id: 'eslint', repo: 'api', name: 'eslint', status: 'environment', cause: 'environment', summary: 'NPM_TOKEN=secret', profileFingerprint: profile.fingerprint, commandId: 'eslint' }],
      waveNotes: [{ id: 'VFY2', state: 'blocked', note: 'check indisponível' }],
    })
    expect(prompt).toContain('Verifique a implementação personalizada.')
    expect(prompt).not.toContain(DEFAULT_PROMPTS.taskVerification)
    expect(prompt).toContain('Verificador · Rodada 3')
    expect(prompt).toContain('profile-fingerprint')
    expect(prompt).toContain('src/service.ts')
    expect(prompt).toContain('VFY2')
    expect(prompt).toContain('state":"blocked')
    expect(prompt).not.toContain('NPM_TOKEN=secret')
    expect(prompt).toContain('Não execute comandos')
    expect(prompt).toContain('status, a causa e os reparos são determinados pelo runner')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('older settings use the default verifier prompt', () => {
  vi.stubEnv('MEGA_BRAIN_SETTINGS_FILE', '')
  const prompt = verificationPrompt({ round: 1, projects: [], profiles: new Map(), checks: [], previousChecks: [], waveNotes: [] })
  expect(prompt).toContain(DEFAULT_PROMPTS.taskVerification)
})
