import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_PROMPTS } from '../../shared/domain/settings'
import { verificationPrompt } from './verification-prompt'

afterEach(() => vi.unstubAllEnvs())

test('uses the saved verifier instructions while retaining the report contract and runtime scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-verifier-prompt-'))
  try {
    const settings = join(root, 'settings.json')
    writeFileSync(
      settings,
      JSON.stringify({ prompts: { taskVerification: 'Verifique a implementação personalizada.' } }),
    )
    vi.stubEnv('MEGA_BRAIN_SETTINGS_FILE', settings)
    const projects = [{ repo: 'api', path: '/work/api', files: ['src/service.ts'] }]
    const prompt = verificationPrompt(projects, '/work/report.json', 3)
    expect(prompt).toContain('Verifique a implementação personalizada.')
    expect(prompt).not.toContain(DEFAULT_PROMPTS.taskVerification)
    expect(prompt).toContain('VFY3')
    expect(prompt).toContain(JSON.stringify(projects))
    expect(prompt).toContain('Relatório JSON: /work/report.json')
    expect(prompt).toContain('Toda verificação failed deve ter pelo menos uma entrada correspondente em failures')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('older settings use the default verifier prompt', () => {
  vi.stubEnv('MEGA_BRAIN_SETTINGS_FILE', '')
  expect(verificationPrompt([], '/report.json', 1)).toContain(DEFAULT_PROMPTS.taskVerification)
})
