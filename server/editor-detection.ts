import { existsSync, readdirSync } from 'node:fs'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import type { DetectedEditor, EditorPreference, EditorDiscovery } from '../shared/domain/settings'
import type { ConfigEnvironment, MegaBrainConfig } from './config'

type BuiltInEditor = Exclude<EditorPreference, 'custom'>

interface EditorDefinition {
  id: BuiltInEditor
  label: string
  commands: string[]
  windowsPaths: string[]
  executableNames?: string[]
}

function windowsPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.replaceAll('\\', '/')
  const drive = /^([a-z]):\/(.*)$/i.exec(normalized)
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2]}` : normalized
}

function findOnPath(commands: string[], path: string, exists: (path: string) => boolean): string | undefined {
  for (const command of commands) {
    if (isAbsolute(command) && exists(command)) return command
    for (const directory of path.split(delimiter)) {
      const candidate = directory ? join(directory, command) : ''
      if (candidate && exists(candidate)) return candidate
    }
  }
}

function findNestedExecutable(root: string, names: ReadonlySet<string>, depth = 5): string | undefined {
  if (depth < 0 || !existsSync(root)) return undefined
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name)
      if (entry.isFile() && names.has(entry.name.toLowerCase())) return path
      if (entry.isDirectory()) {
        const found = findNestedExecutable(path, names, depth - 1)
        if (found) return found
      }
    }
  } catch {
    return undefined
  }
}

export interface DetectEditorsOptions {
  env?: ConfigEnvironment
  exists?: (path: string) => boolean
}

export function detectEditors(config: MegaBrainConfig, options: DetectEditorsOptions = {}): EditorDiscovery {
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  const profile = windowsPath(env.USERPROFILE)
  const inferredProfile = join('/mnt/c/Users', basename(config.directories.home))
  const profiles = [...new Set([profile, inferredProfile].filter((value): value is string => Boolean(value)))]
  const localPrograms = profiles.map((home) => join(home, 'AppData', 'Local', 'Programs'))
  const definitions: EditorDefinition[] = [
    {
      id: 'cursor',
      label: 'Cursor',
      commands: [config.executables.cursor ?? '', 'cursor', 'cursor.exe'].filter(Boolean),
      windowsPaths: localPrograms.map((root) => join(root, 'cursor', 'Cursor.exe')),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      commands: [config.executables.code ?? '', 'code', 'code.exe'].filter(Boolean),
      windowsPaths: [
        ...localPrograms.map((root) => join(root, 'Microsoft VS Code', 'Code.exe')),
        '/mnt/c/Program Files/Microsoft VS Code/Code.exe',
      ],
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      commands: ['windsurf', 'windsurf.exe'],
      windowsPaths: localPrograms.map((root) => join(root, 'Windsurf', 'Windsurf.exe')),
    },
    {
      id: 'zed',
      label: 'Zed',
      commands: ['zed', 'zed.exe'],
      windowsPaths: localPrograms.map((root) => join(root, 'Zed', 'Zed.exe')),
    },
    {
      id: 'sublime',
      label: 'Sublime Text',
      commands: ['subl', 'sublime_text', 'sublime_text.exe'],
      windowsPaths: ['/mnt/c/Program Files/Sublime Text/sublime_text.exe'],
    },
    {
      id: 'intellij',
      label: 'IntelliJ IDEA',
      commands: ['idea', 'idea64.exe'],
      windowsPaths: [],
      executableNames: ['idea64.exe', 'idea.sh'],
    },
    {
      id: 'webstorm',
      label: 'WebStorm',
      commands: ['webstorm', 'webstorm64.exe'],
      windowsPaths: [],
      executableNames: ['webstorm64.exe', 'webstorm.sh'],
    },
    {
      id: 'pycharm',
      label: 'PyCharm',
      commands: ['pycharm', 'pycharm64.exe'],
      windowsPaths: [],
      executableNames: ['pycharm64.exe', 'pycharm.sh'],
    },
  ]
  const jetBrainsRoots = [
    '/mnt/c/Program Files/JetBrains',
    ...profiles.map((home) => join(home, 'AppData', 'Local', 'JetBrains', 'Toolbox', 'apps')),
  ]
  const path = env.PATH ?? process.env.PATH ?? ''
  const editors: DetectedEditor[] = []

  for (const definition of definitions) {
    let command =
      findOnPath(definition.commands, path, exists) ?? definition.windowsPaths.find((candidate) => exists(candidate))
    if (!command && definition.executableNames) {
      const names = new Set(definition.executableNames.map((name) => name.toLowerCase()))
      for (const root of jetBrainsRoots) {
        command = findNestedExecutable(root, names)
        if (command) break
      }
    }
    if (!command) continue
    const windows = command.toLowerCase().endsWith('.exe') || command.startsWith('/mnt/')
    editors.push({ id: definition.id, label: definition.label, command, source: windows ? 'windows' : 'linux' })
  }

  const scope = env.WSL_DISTRO_NAME
    ? 'Windows e WSL'
    : config.mode === 'desktop'
      ? 'este computador'
      : 'máquina do backend'
  return { editors, scope }
}
