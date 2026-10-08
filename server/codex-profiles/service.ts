import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { CodexProfile, CodexProfiles, CodexProfilesResponse } from '../../shared/domain/codex-profiles'

const MAX_PROFILES = 20
const PROFILE_COLORS = ['#7dd3fc', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#60a5fa']

export type CodexProfilesOptions = {
  homeDir?: string
  env?: Readonly<NodeJS.ProcessEnv>
  additionalHomes?: readonly string[]
}

export type CodexProfilesStore = {
  read(): CodexProfilesResponse
  write(input: unknown): CodexProfilesResponse
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** Resolving a home checks paths only. Profile authentication files are never opened. */
export function canonicalCodexHome(value: string, homeDir = homedir()): string {
  const path = value === '~' ? homeDir : value.startsWith('~/') ? join(homeDir, value.slice(2)) : value
  if (!path || path.includes('\0') || !isAbsolute(path))
    throw new Error('O diretório do perfil deve ser um caminho absoluto ou começar com ~/.')
  const expanded = resolve(path)
  try {
    return realpathSync(expanded)
  } catch {
    // Preserve yet-to-be-created homes while resolving existing symlink ancestors.
    let ancestor = dirname(expanded)
    const missing = [basename(expanded)]
    while (ancestor !== dirname(ancestor)) {
      try {
        return resolve(realpathSync(ancestor), ...missing.reverse())
      } catch {
        missing.push(basename(ancestor))
        ancestor = dirname(ancestor)
      }
    }
    return expanded
  }
}

function homeName(home: string): string {
  const name = basename(home).replace(/^\.codex[-_]?/, '')
  if (!name || name === 'codex') return 'Padrão'
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/^\S/, (letter) => letter.toLocaleUpperCase())
    .slice(0, 80)
}

function discoveredHomes(homeDir: string, additionalHomes: readonly string[]): { name: string; home: string }[] {
  const candidates = [...additionalHomes, join(homeDir, '.codex')]
  try {
    candidates.push(
      ...readdirSync(homeDir, { withFileTypes: true })
        .filter((entry) => /^\.codex[-_]/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()))
        .map((entry) => join(homeDir, entry.name)),
    )
  } catch {
    /* A home directory may be unavailable in a packaged runtime. */
  }
  const homes = new Set<string>()
  return candidates
    .flatMap((candidate) => {
      try {
        const home = canonicalCodexHome(candidate, homeDir)
        if (homes.has(home) || !statSync(home).isDirectory()) return []
        if (!['sessions', 'session_index.jsonl', 'config.toml'].some((name) => existsSync(join(home, name)))) return []
        homes.add(home)
        return [{ name: homeName(home), home }]
      } catch {
        return []
      }
    })
    .sort((left, right) => left.home.localeCompare(right.home))
}

function profileId(home: string): string {
  return `codex-${createHash('sha256').update(home).digest('hex').slice(0, 16)}`
}

function validate(input: unknown, homeDir: string): CodexProfiles {
  const value = object(input)
  if (!value || !Array.isArray(value.profiles) || !value.profiles.length || value.profiles.length > MAX_PROFILES)
    throw new Error('Defina entre 1 e 20 perfis do Codex.')
  const ids = new Set<string>()
  const homes = new Set<string>()
  const profiles = value.profiles.map((item): CodexProfile => {
    const entry = object(item)
    if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(entry.id))
      throw new Error('O identificador do perfil é inválido.')
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (
      !name ||
      name.length > 80 ||
      [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw new Error('O nome do perfil deve conter entre 1 e 80 caracteres.')
    if (typeof entry.home !== 'string') throw new Error('Informe o diretório do perfil.')
    const home = canonicalCodexHome(entry.home.trim(), homeDir)
    if (ids.has(entry.id)) throw new Error('Os identificadores dos perfis devem ser diferentes.')
    if (homes.has(home)) throw new Error('Cada perfil deve usar um diretório Codex diferente.')
    if (typeof entry.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(entry.color))
      throw new Error('Escolha uma cor válida para o perfil.')
    ids.add(entry.id)
    homes.add(home)
    return { id: entry.id, name, home, color: entry.color.toLowerCase() }
  })
  if (typeof value.activeId !== 'string' || !ids.has(value.activeId))
    throw new Error('Escolha um perfil ativo da lista.')
  return { profiles, activeId: value.activeId }
}

export function createCodexProfilesStore(settingsFile: string, options: CodexProfilesOptions = {}): CodexProfilesStore {
  const file = join(dirname(settingsFile), 'codex-profiles.json')
  const homeDir = options.homeDir ?? homedir()
  const env = options.env ?? process.env
  const discover = () => discoveredHomes(homeDir, options.additionalHomes ?? [])
  const defaults = (): CodexProfiles => {
    let activeHome: string
    try {
      activeHome = canonicalCodexHome(env.MEGA_BRAIN_CODEX_HOME || env.CODEX_HOME || join(homeDir, '.codex'), homeDir)
    } catch {
      activeHome = canonicalCodexHome(join(homeDir, '.codex'), homeDir)
    }
    const homes = [activeHome, ...discover().map(({ home }) => home)]
    const profiles = [...new Set(homes)].slice(0, MAX_PROFILES).map((home, index) => ({
      id: profileId(home),
      name: homeName(home),
      home,
      color: PROFILE_COLORS[index % PROFILE_COLORS.length],
    }))
    return { profiles, activeId: profiles[0].id }
  }
  const read = (): CodexProfilesResponse => {
    let saved: CodexProfiles
    try {
      saved = validate(JSON.parse(readFileSync(file, 'utf8')), homeDir)
    } catch {
      saved = defaults()
    }
    return { ...saved, discovered: discover() }
  }
  return {
    read,
    write(input) {
      const next = validate(input, homeDir)
      mkdirSync(dirname(file), { recursive: true })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
        renameSync(temporary, file)
      } finally {
        rmSync(temporary, { force: true })
      }
      return { ...next, discovered: discover() }
    },
  }
}

export function readCodexProfiles(
  settingsFile: string,
  homeDir = homedir(),
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): CodexProfilesResponse {
  return createCodexProfilesStore(settingsFile, { homeDir, env }).read()
}

/** Only profile routing metadata is passed to child processes; no credentials leave the home. */
export function codexProfileEnvironment(
  settingsFile: string,
  profileId?: string,
  homeDir = homedir(),
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  const saved = readCodexProfiles(settingsFile, homeDir, env)
  const selectedId = profileId ?? saved.activeId
  const profile = saved.profiles.find(({ id }) => id === selectedId)
  if (!profile) throw new Error('O perfil Codex selecionado não está mais disponível.')
  return {
    CODEX_HOME: profile.home,
    MEGA_BRAIN_CODEX_HOME: profile.home,
    MEGA_BRAIN_CODEX_PROFILE_ID: profile.id,
    MEGA_BRAIN_CODEX_PROFILE_NAME: profile.name,
    MEGA_BRAIN_CODEX_PROFILE_COLOR: profile.color,
  }
}
