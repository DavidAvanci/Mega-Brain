import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { canonicalCodexHome, codexProfileEnvironment, createCodexProfilesStore, readCodexProfiles } from './service'
import { codexProfilesHttp } from './http'

const roots: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-codex-profiles-'))
  roots.push(home)
  const settingsFile = join(home, 'settings', 'settings.json')
  const store = createCodexProfilesStore(settingsFile, { homeDir: home, env: {} })
  return { home, settingsFile, store }
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('Codex profiles', () => {
  test('discovers signed homes with deterministic IDs while never opening or copying credentials', () => {
    const { home, settingsFile } = fixture()
    for (const name of ['.codex', '.codex-personal', '.codex-work']) {
      mkdirSync(join(home, name, 'sessions'), { recursive: true })
      writeFileSync(join(home, name, 'auth.json'), 'credential-canary')
    }
    mkdirSync(join(home, '.codex-unrelated'))
    symlinkSync(join(home, '.codex-personal'), join(home, '.codex-personal-link'))
    const env = { MEGA_BRAIN_CODEX_HOME: join(home, '.codex-work') }
    const first = readCodexProfiles(settingsFile, home, env)
    expect(first.profiles).toHaveLength(3)
    expect(first.profiles.find(({ id }) => id === first.activeId)).toMatchObject({
      name: 'Work',
      home: join(home, '.codex-work'),
    })
    expect(first.discovered).toHaveLength(3)
    expect(readCodexProfiles(settingsFile, home, env)).toEqual(first)
    expect(JSON.stringify(first)).not.toContain('credential-canary')
    expect(readdirSync(home)).not.toContain('settings')
  })

  test('migrates the existing CODEX_HOME default and expands ~ paths without touching the profile home', () => {
    const { home, settingsFile } = fixture()
    const saved = readCodexProfiles(settingsFile, home, { CODEX_HOME: '~/profiles/work' })
    expect(saved.profiles[0].home).toBe(join(home, 'profiles', 'work'))
    expect(saved.activeId).toBe(saved.profiles[0].id)
    expect(readCodexProfiles(settingsFile, home, { CODEX_HOME: 'relative' }).profiles[0].home).toBe(
      join(home, '.codex'),
    )
    expect(canonicalCodexHome('~', home)).toBe(home)
  })

  test('persists atomically beside settings with restrictive permissions and takes changes live', () => {
    const { home, settingsFile, store } = fixture()
    const first = store.read()
    const profiles = [
      { ...first.profiles[0], name: 'Pessoal' },
      { id: 'work', name: 'Trabalho', home: '~/profiles/work', color: '#ABCDEF' },
    ]
    const next = store.write({ profiles, activeId: 'work' })
    expect(next.profiles[1]).toMatchObject({ home: join(home, 'profiles', 'work'), color: '#abcdef' })
    expect(codexProfileEnvironment(settingsFile, undefined, home, {})).toMatchObject({
      CODEX_HOME: join(home, 'profiles', 'work'),
      MEGA_BRAIN_CODEX_PROFILE_ID: 'work',
    })
    const file = join(home, 'settings', 'codex-profiles.json')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(join(home, 'settings'))).toEqual(['codex-profiles.json'])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ profiles: next.profiles, activeId: 'work' })
    store.write({ ...next, activeId: profiles[0].id })
    expect(store.read().activeId).toBe(profiles[0].id)
    expect(codexProfileEnvironment(settingsFile, undefined, home, {}).MEGA_BRAIN_CODEX_PROFILE_NAME).toBe('Pessoal')
    expect(codexProfileEnvironment(settingsFile, 'work', home, {}).MEGA_BRAIN_CODEX_PROFILE_NAME).toBe('Trabalho')
    expect(() => codexProfileEnvironment(settingsFile, 'removed', home, {})).toThrow('não está mais disponível')
  })

  test('rejects duplicate canonical homes, malformed metadata and an inactive selection', () => {
    const { home, store } = fixture()
    const initial = store.read()
    const profile = initial.profiles[0]
    mkdirSync(join(home, 'real'))
    symlinkSync(join(home, 'real'), join(home, 'linked'))
    const invalid = [
      { profiles: [], activeId: '' },
      { ...initial, activeId: 'absent' },
      { ...initial, profiles: [{ ...profile, home: 'relative' }] },
      { ...initial, profiles: [{ ...profile, home: '/bad\0home' }] },
      { ...initial, profiles: [{ ...profile, name: 'x'.repeat(81) }] },
      { ...initial, profiles: [{ ...profile, name: ' bad\nname' }] },
      { ...initial, profiles: [{ ...profile, color: '#fff' }] },
      { ...initial, profiles: [{ ...profile, id: '../bad' }] },
      { ...initial, profiles: [profile, profile] },
      {
        ...initial,
        profiles: [
          { ...profile, home: join(home, 'real') },
          { ...profile, id: 'linked', home: join(home, 'linked') },
        ],
      },
      {
        ...initial,
        profiles: Array.from({ length: 21 }, (_, index) => ({
          ...profile,
          id: `profile-${index}`,
          home: join(home, `home-${index}`),
        })),
      },
    ]
    for (const value of invalid) expect(() => store.write(value)).toThrow()
    expect(store.read()).toEqual(initial)
  })

  test('HTTP supports reading and replacing metadata with a useful validation error', async () => {
    const { store } = fixture()
    const handler = codexProfilesHttp(store)
    const request = { method: 'GET', path: '/api/codex/profiles', query: new URLSearchParams(), headers: {} }
    await expect(handler(request)).resolves.toMatchObject({ status: 200, body: { profiles: expect.any(Array) } })
    await expect(handler({ ...request, method: 'PUT', body: store.read() })).resolves.toMatchObject({ status: 200 })
    await expect(handler({ ...request, method: 'PUT', body: { profiles: [], activeId: '' } })).resolves.toMatchObject({
      status: 400,
    })
    await expect(handler({ ...request, method: 'DELETE' })).resolves.toMatchObject({ status: 405 })
  })
})
