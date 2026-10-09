import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readGeneralSettings, writeGeneralSettings } from './app-settings'
import { loadMegaBrainConfig } from './config'
import { terminalCommand } from './workspace/terminal-command'

test('terminal and shell preferences survive reload, omitted fields and explicit reset', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-terminal-settings-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: {} })
  const settings = {
    ...readGeneralSettings(config),
    workspaceDir: join(home, 'cards'),
    worktreesDir: join(home, 'trees'),
    terminalCommand: 'iTerm2',
    shellCommand: ' /bin/zsh ',
  }
  const saved = writeGeneralSettings(config, settings)
  expect(saved).toMatchObject({ terminalCommand: 'iTerm2', shellCommand: '/bin/zsh' })
  expect(readGeneralSettings(loadMegaBrainConfig({ homeDir: home, env: {} }))).toEqual(saved)
  const omitted = { ...saved }
  delete omitted.shellCommand
  delete omitted.terminalCommand
  expect(writeGeneralSettings(config, omitted)).toEqual(saved)
  expect(writeGeneralSettings(config, { ...saved, terminalCommand: '', shellCommand: '' })).toMatchObject({
    terminalCommand: '',
    shellCommand: '',
  })
})

test('invalid shell settings cannot overwrite saved preferences', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-shell-validation-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: {} })
  const settings = {
    ...readGeneralSettings(config),
    workspaceDir: join(home, 'cards'),
    worktreesDir: join(home, 'trees'),
  }
  for (const shellCommand of [123, 'bash\ncommand', 'bash\0command']) {
    expect(() => writeGeneralSettings(config, { ...settings, shellCommand })).toThrow('executável do shell')
  }
  expect(config.preferences.shellCommand).toBe('')
})

test('login shell launches keep prompts and command arguments as literal data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mega-brain-shell-argv-'))
  const marker = join(directory, 'unexpected')
  const values = ["spaces and apostrophes: '", `$(touch ${marker})`, '; echo injected', 'a\nb']
  const args = [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...values]
  const [executable, ...argv] = terminalCommand(args, '/bin/sh')
  expect(executable).toBe('/bin/sh')
  expect(argv.slice(0, 3)).toEqual(['-lc', 'exec "$@"', 'mega-brain'])
  expect(argv.slice(3)).toEqual(args)
  expect(argv[1]).not.toContain(marker)
  expect(terminalCommand(args, '')).toEqual(args)
  expect(() => terminalCommand(args, '/missing/mega-brain-shell')).toThrow('Shell não está disponível')
})
