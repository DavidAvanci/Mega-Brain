import { ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, test } from 'vitest'
import { knowledgeFile, knowledgeService } from './service'
import { configureKnowledgeConnection } from './agent'
import { stageAgentCommand, runStageAgent } from '../workspace/stage-agent'
import { STAGES } from '../workspace/stage-catalog'
import { createChatService } from '../chat/service'
import type { ProcessRunner } from '../process'
import { readCard, writeCard } from '../workspace/card-record'
import { updateCard } from '../workspace/card-update'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mega-knowledge-launch-'))
  roots.push(root)
  const settings = join(root, 'settings.json')
  const folder = join(root, 'MB-001')
  mkdirSync(folder)
  configureKnowledgeConnection(settings, { url: 'http://127.0.0.1:5173' })
  const service = knowledgeService(knowledgeFile(settings))
  const note = service.create('page', { title: 'Regra', markdown: 'Não usar dados simulados' })
  const card = {
    title: 'Tarefa',
    description: '',
    status: 'a-fazer',
    flow: 'simples' as const,
    knowledgeRefs: [{ kind: 'page' as const, id: note.id }],
  }
  writeCard(folder, card)
  return { root, settings, folder, note, card }
}
function fakeRunner() {
  const calls: { command: string; args: readonly string[]; options: Parameters<ProcessRunner['spawn']>[2] }[] = []
  const children: ChildProcess[] = []
  const runner: ProcessRunner = {
    spawn(command, args, options) {
      calls.push({ command, args, options })
      const child = new ChildProcess()
      Object.defineProperty(child, 'stdout', { value: new PassThrough() })
      Object.defineProperty(child, 'stderr', { value: new PassThrough() })
      child.unref = () => {}
      children.push(child)
      return child
    },
    execFileSync: () => '',
    execFile: (_command, _args, _options, callback) => callback(null, '', ''),
  }
  return { runner, calls, children }
}
test.each(['claude', 'chatgpt'] as const)(
  'chat sends card attachments and typed request references to %s with a scoped adapter environment',
  (nameProvider) => {
    const { root, settings, note } = fixture()
    const { runner, calls, children } = fakeRunner()
    const config = {
      workspaceDir: root,
      directories: {
        home: root,
        claudeHome: join(root, '.claude'),
        claudeProjects: join(root, 'projects'),
        claudeCredentials: join(root, 'credentials'),
      },
      executables: {},
      preferences: {
        settingsFile: settings,
        editor: 'cursor' as const,
        editorCommand: '',
        llmProvider: 'claude' as const,
        onboardingCompleted: true,
      },
    }
    const service = createChatService(
      { ...config, preferences: { ...config.preferences, llmProvider: nameProvider } },
      runner,
    )
    service.send('MB-001', 'Faça a tarefa', () => {}, [{ kind: 'page', id: note.id }])
    expect(calls[0].args.join(' ')).toContain('Não usar dados simulados')
    expect(calls[0].options?.env?.MEGA_BRAIN_KNOWLEDGE_CAPABILITY).toBeTruthy()
    expect(calls[0].options?.env?.MEGA_BRAIN_KNOWLEDGE_CLI).toContain('agent.mjs')
    children[0].emit('close', 0, null)
  },
)

test.each(['claude', 'chatgpt'] as const)('planning launch includes knowledge for %s', (provider) => {
  const { settings, folder, card, note } = fixture()
  const stage = STAGES.find((stage) => stage.name === 'task-planning')!
  const [, args] = stageAgentCommand(folder, stage, card, 'default', 'low', provider, undefined, undefined, settings)
  expect(args.join(' ')).toContain(note.id)
  expect(args.join(' ')).toContain('Não usar dados simulados')
})
test('scripted stages pass the adapter and knowledge context to item subprocesses', () => {
  const { settings, folder, card } = fixture()
  const { runner, calls, children } = fakeRunner()
  const stage = STAGES.find((stage) => stage.name === 'run-task-checklist')!
  runStageAgent(
    folder,
    stage,
    card,
    'default',
    undefined,
    runner,
    undefined,
    undefined,
    undefined,
    'chatgpt',
    undefined,
    undefined,
    settings,
  )
  expect(calls[0].options?.env?.MEGA_BRAIN_KNOWLEDGE_CONTEXT).toContain('Não usar dados simulados')
  expect(calls[0].options?.env?.MEGA_BRAIN_KNOWLEDGE_CAPABILITY).toBeTruthy()
  children[0].emit('close', 0, null)
})
test('card update and reload retain typed references without starting a stage', () => {
  const { folder, card } = fixture()
  updateCard(folder, 'MB-001', { title: 'Novo título' }, () => {
    throw new Error('Unexpected launch')
  })
  expect(readCard(folder, 'MB-001').knowledgeRefs).toEqual(card.knowledgeRefs)
  updateCard(folder, 'MB-001', { knowledgeRefs: [] }, () => {})
  expect(readCard(folder, 'MB-001').knowledgeRefs).toEqual([])
})
