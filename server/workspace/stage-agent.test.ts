import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { ChildProcess, type SpawnOptions } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { AGENT_FILE, runStageAgent, stageAgentCommand } from './stage-agent'
import { STAGES } from './stage-catalog'
import { createCodexProfilesStore } from '../codex-profiles/service'
import type { ProcessRunner } from '../process'
import { readAgent } from './stage-agent-status'

const card = { title: 'Refatorar serviço', description: '', status: 'planejando', flow: 'dificil' as const }

test('builds a Codex command with the configured executable and model settings', () => {
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const [bin, args] = stageAgentCommand(
    '/tmp/card',
    planning,
    card,
    'gpt-5',
    'high',
    'chatgpt',
    undefined,
    '/opt/codex',
  )

  expect(bin).toBe('/opt/codex')
  expect(args).toContain('--model')
  expect(args).toContain('gpt-5')
  expect(args).toContain('model_reasoning_effort="high"')
  expect(args.at(-1)).toContain('Tarefa: Refatorar serviço')
})

test('names Claude stage sessions after the card and stage', () => {
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const [, args] = stageAgentCommand('/tmp/CARD-123', planning, card, 'fable', 'low')
  expect(args.slice(args.indexOf('--name'), args.indexOf('--name') + 2)).toEqual(['--name', 'CARD-123 · task-planning'])
})

test('planning prompt resolves repository mentions from the active catalog', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mega-brain-stage-mention-')))
  const checkout = join(root, 'api')
  mkdirSync(join(checkout, '.git'), { recursive: true })
  writeFileSync(
    join(root, 'repositories.json'),
    JSON.stringify({
      version: 1,
      repositories: [{ id: 'repo_1', alias: 'api', displayName: 'API', path: checkout, active: true }],
    }),
  )
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const [, args] = stageAgentCommand(
    '/tmp/card',
    planning,
    { ...card, description: 'Trabalhe em @api' },
    'default',
    'high',
    'chatgpt',
    undefined,
    undefined,
    join(root, 'settings.json'),
  )
  expect(args.at(-1)).toContain('"id":"repo_1"')
  expect(args.at(-1)).toContain(JSON.stringify({ id: 'repo_1', alias: 'api', path: checkout }))
})

test('workflow launches use profile routing and retain provider/profile identity after changing defaults', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mega-brain-stage-profile-routing-')))
  const path = join(root, 'card')
  mkdirSync(path)
  const settingsFile = join(root, 'settings.json')
  const profiles = [
    { id: 'personal', name: 'Pessoal', home: join(root, '.codex-personal'), color: '#7dd3fc' },
    { id: 'work', name: 'Trabalho', home: join(root, '.codex-work'), color: '#a78bfa' },
  ]
  const store = createCodexProfilesStore(settingsFile, { homeDir: root, env: {} })
  store.write({ profiles, activeId: 'personal' })
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const calls: { command: string; args: readonly string[]; options?: SpawnOptions }[] = []
  const children: ChildProcess[] = []
  const runner: ProcessRunner = {
    spawn(command, args, options) {
      calls.push({ command, args, options })
      // ChildProcess construction creates an event emitter, but does not spawn a program.
      const child = new ChildProcess()
      Object.defineProperty(child, 'pid', { value: 123 + children.length })
      children.push(child)
      return child
    },
    execFileSync() {
      return ''
    },
    execFile(_command, _args, _options, callback) {
      callback(null, '', '')
    },
  }
  const launch = () =>
    runStageAgent(
      path,
      planning,
      card,
      'default',
      undefined,
      runner,
      undefined,
      undefined,
      undefined,
      'chatgpt',
      'codex-fixture',
      undefined,
      settingsFile,
    )
  launch()
  expect(calls[0]).toMatchObject({
    command: 'codex-fixture',
    options: { cwd: path, env: { CODEX_HOME: profiles[0].home, MEGA_BRAIN_CODEX_PROFILE_ID: 'personal' } },
  })
  expect(JSON.parse(readFileSync(join(path, AGENT_FILE), 'utf8'))).toMatchObject({
    provider: 'codex',
    codexProfileId: 'personal',
    codexProfileName: 'Pessoal',
    codexProfileColor: '#7dd3fc',
  })
  store.write({ profiles, activeId: 'work' })
  writeFileSync(settingsFile, JSON.stringify({ llmProvider: 'claude' }))
  expect(readAgent(path, () => true)).toMatchObject({
    status: 'rodando',
    provider: 'codex',
    codexProfileId: 'personal',
    codexProfileName: 'Pessoal',
  })
  expect(calls[0].options?.env?.CODEX_HOME).toBe(profiles[0].home)
  children[0].emit('close', 0)
  launch()
  expect(calls[1].options?.env).toMatchObject({ CODEX_HOME: profiles[1].home, MEGA_BRAIN_CODEX_PROFILE_ID: 'work' })
  expect(calls[0].options?.env?.CODEX_HOME).toBe(profiles[0].home)
  expect(readAgent(path, () => true)).toMatchObject({
    provider: 'codex',
    codexProfileId: 'work',
    codexProfileName: 'Trabalho',
  })
  children[1].emit('close', 0)
})
