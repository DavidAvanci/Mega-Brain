import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverVerificationProfile, loadValidVerificationProfile, persistVerificationProfile, verificationFilesForCommand } from './verification-profile.ts'

let roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verification-profile-'))
  roots.push(root)
  mkdirSync(join(root, 'node_modules', 'eslint'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { eslint: '^9.0.0' } }))
  writeFileSync(join(root, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '9.1.0' }))
  writeFileSync(join(root, '.node-version'), process.version)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('verification profile', () => {
  it('creates scoped argv and stable skipped reasons for whole-project scripts', () => {
    const root = fixture()
    const profile = discoverVerificationProfile(root, 'api')
    expect(profile.commands).toContainEqual(expect.objectContaining({ id: 'eslint', argv: ['eslint', '--format', 'json'], scope: 'card-files' }))
    expect(profile.skipped.find((entry) => entry.id === 'test')?.reason).toContain('baseline isolada')
  })

  it('persists atomically and invalidates the profile when lint configuration changes', () => {
    const root = fixture()
    const path = join(root, 'verification-profile.json')
    const first = discoverVerificationProfile(root, 'api')
    persistVerificationProfile(path, first)
    expect(JSON.parse(readFileSync(path, 'utf8')).fingerprint).toBe(first.fingerprint)
    writeFileSync(join(root, 'eslint.config.mjs'), 'export default []')
    const second = loadValidVerificationProfile(path, root, 'api')
    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(JSON.parse(readFileSync(path, 'utf8')).fingerprint).toBe(second.fingerprint)
  })

  it('records explicit ESLint script targets and filters generated and non-code files', () => {
    const root = fixture()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint src --max-warnings 0' }, devDependencies: { eslint: '^9.0.0' } }))
    const profile = discoverVerificationProfile(root, 'api')
    const eslint = profile.commands.find((command) => command.id === 'eslint')!
    expect(eslint.targets).toEqual(['src'])
    expect(verificationFilesForCommand(eslint, ['src/app.ts', 'test/app.test.ts', 'src/logo.svg', 'src/routeTree.gen.ts'])).toEqual({
      files: ['src/app.ts'],
      excluded: ['test/app.test.ts', 'src/logo.svg', 'src/routeTree.gen.ts'],
    })
  })
})
