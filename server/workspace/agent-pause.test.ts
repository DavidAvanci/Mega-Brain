import { ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createProcessOwner, type ProcessRunner } from '../process'
import { readStageAgentRecord } from './agent-checkpoint'
import { createStageController } from './stage-controller'
import { STAGES } from './stage-catalog'
import { readAgent } from './stage-agent-status'
import { updateCard } from './card-update'
import { createWorkspaceService } from './service'
import { advanceStage } from './stage-transition'

function fixture(provider: 'claude' | 'chatgpt', stageName = 'task-planning') {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-pause-'))
  const path = join(root, 'CARD-1')
  mkdirSync(path)
  const stage = STAGES.find((candidate) => candidate.name === stageName)!
  const card = { title: 'Continuar implementação', description: '', status: stage.status, flow: 'dificil' as const }
  writeFileSync(join(path, 'card.json'), JSON.stringify(card))
  writeFileSync(join(path, 'TASK-CHECKLIST.md'), '- [x] T1 Pronto\n- [ ] T2 Pendente\n')
  const calls: { args: readonly string[]; options?: SpawnOptions; child: ChildProcess }[] = []
  const runner: ProcessRunner = {
    spawn(_command, args, options) {
      const child = new ChildProcess()
      Object.defineProperty(child, 'pid', { value: process.pid })
      calls.push({ args, options, child })
      return child
    },
    execFileSync() {
      return ''
    },
    execFile(_command, _args, _options, callback) {
      callback(null, '', '')
    },
  }
  const signals: NodeJS.Signals[] = []
  const owner = createProcessOwner({
    timeoutMs: 10,
    signalTree(_pid, signal) {
      signals.push(signal)
      if (signal === 'SIGTERM') queueMicrotask(() => calls.at(-1)?.child.emit('close', null, signal))
    },
  })
  const config = {
    executables: { claude: 'fake-provider', codex: 'fake-provider' },
    worktreesDir: join(root, 'worktrees'),
    preferences: {
      settingsFile: join(root, 'settings.json'),
      editor: 'vscode' as const,
      editorCommand: '',
      llmProvider: provider,
      onboardingCompleted: true,
    },
  }
  const create = () => createStageController(config, runner, owner)
  return { root, path, stage, card, config, calls, signals, create, runner, owner }
}

test.each(['claude', 'chatgpt'] as const)(
  'pauses %s, survives a controller restart and resumes its exact session',
  async (provider) => {
    const f = fixture(provider)
    const controller = f.create()
    controller.start(f.path, f.stage, f.card)
    writeFileSync(
      join(f.path, `${f.stage.name}.jsonl`),
      `${JSON.stringify(
        provider === 'claude'
          ? { type: 'system', session_id: 'saved-session' }
          : { type: 'thread.started', thread_id: 'saved-session' },
      )}\n`,
    )
    writeFileSync(join(f.path, 'PLAN.md'), 'Plano parcial')
    const original = readStageAgentRecord(f.path)!
    await controller.pause(f.path, f.stage.name)
    expect(f.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(readAgent(f.path)).toMatchObject({ status: 'pausado', sessionId: 'saved-session', resumable: true })
    expect(readFileSync(join(f.path, 'PLAN.md'), 'utf8')).toBe('Plano parcial')
    expect(readFileSync(join(f.path, 'TASK-CHECKLIST.md'), 'utf8')).toContain('[x] T1')
    expect(advanceStage(f.path, f.card, readAgent(f.path))).toBe(f.card)
    expect(() => updateCard(f.path, 'CARD-1', { status: 'desenvolvendo' }, controller.start)).toThrow('pausada')
    expect(() => controller.clear(f.path, f.stage.name)).toThrow('Interrompa')
    const reopened = f.create()
    reopened.start(f.path, f.stage, f.card)
    expect(f.calls).toHaveLength(1)
    f.config.preferences.llmProvider = provider === 'claude' ? 'chatgpt' : 'claude'
    reopened.resume(f.path, f.stage.name)
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1].args).toContain('saved-session')
    expect(f.calls[1].args).toContain(provider === 'claude' ? '--resume' : 'resume')
    expect(f.calls[1].args.join(' ')).toContain('Não repita itens concluídos')
    expect(readStageAgentRecord(f.path)?.startedAt).toBe(original.startedAt)
    expect(readStageAgentRecord(f.path)?.resume).toEqual(original.resume)
    expect(readAgent(f.path)).toMatchObject({
      status: 'rodando',
      provider: provider === 'chatgpt' ? 'codex' : 'claude',
    })
    expect(() => reopened.resume(f.path, f.stage.name)).toThrow()
    f.calls[1].child.emit('close', 0)
  },
)

test('checklist pause preserves files and the original run settings without taking a new snapshot', async () => {
  const f = fixture('claude', 'run-task-checklist')
  const controller = f.create()
  controller.start(f.path, f.stage, f.card)
  const original = readStageAgentRecord(f.path)!
  const snapshot = readFileSync(join(f.path, `.stage-snapshot-${f.stage.name}.json`), 'utf8')
  writeFileSync(
    join(f.path, 'TASK-CHECKLIST.md'),
    '- [x] T1 Pronto\n- [x] T2 Concluído antes da pausa\n- [ ] T3 Pendente\n',
  )
  await controller.pause(f.path, f.stage.name)
  f.create().resume(f.path, f.stage.name)
  expect(f.calls[1].options?.env).toMatchObject({
    CHECKLIST_MODEL: original.resume?.environment.CHECKLIST_MODEL,
    MEGA_BRAIN_STAGE_RUN_ID: original.resume?.environment.MEGA_BRAIN_STAGE_RUN_ID,
    MEGA_BRAIN_RESUMING_STAGE: '1',
  })
  expect(readFileSync(join(f.path, 'TASK-CHECKLIST.md'), 'utf8')).toContain('[x] T2')
  expect(readFileSync(join(f.path, `.stage-snapshot-${f.stage.name}.json`), 'utf8')).toBe(snapshot)
  f.calls[1].child.emit('close', 0)
})

test('recovers an interrupted checkpoint as paused and resumes before the provider created a session', () => {
  const f = fixture('claude')
  f.create().start(f.path, f.stage, f.card)
  const meta = readStageAgentRecord(f.path)!
  writeFileSync(join(f.path, 'agent.json'), JSON.stringify({ ...meta, pid: null }))
  expect(readAgent(f.path)?.status).toBe('pausado')
  f.create().resume(f.path, f.stage.name)
  expect(f.calls[1].args).not.toContain('--resume')
  expect(f.calls[1].args.join(' ')).toContain('Continue de onde parou')
  f.calls.forEach(({ child }) => child.emit('close', 0))
})

test('cannot signal a persisted PID owned by another backend; paused reset remains available', async () => {
  const f = fixture('claude')
  f.create().start(f.path, f.stage, f.card)
  await expect(f.create().pause(f.path, f.stage.name)).rejects.toThrow('gerenciados')
  expect(f.signals).toEqual([])
  await f
    .create()
    .stop(f.path, f.stage.name)
    .catch(() => {})
  const meta = readStageAgentRecord(f.path)!
  writeFileSync(join(f.path, 'agent.json'), JSON.stringify({ ...meta, pausedAt: new Date().toISOString(), pid: null }))
  await f.create().stop(f.path, f.stage.name)
  expect(existsSync(join(f.path, 'agent.json'))).toBe(false)
  f.calls[0].child.emit('close', 0)
})

test('workspace pause/resume endpoints preserve a card across service recreation', async () => {
  const f = fixture('claude')
  writeFileSync(join(f.path, 'card.json'), JSON.stringify({ ...f.card, status: 'backlog' }))
  const compose = () => createWorkspaceService({ workspaceDir: f.root, ...f.config }, f.runner, f.owner)
  const service = compose()
  await service.handle('/update', 'POST', new URLSearchParams(), { name: 'CARD-1', status: f.stage.status })
  await service.handle('/stage/pause', 'POST', new URLSearchParams(), { name: 'CARD-1', stage: f.stage.name })
  const reopened = compose()
  const board = await reopened.handle('/', 'GET', new URLSearchParams(), undefined)
  expect(board).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'CARD-1', agents: [expect.objectContaining({ status: 'pausado' })] }),
    ]),
  )
  await expect(
    reopened.handle('/stage/resume', 'POST', new URLSearchParams(), { name: 'CARD-1', stage: 'run-task-checklist' }),
  ).rejects.toThrow('pausada')
  expect(readAgent(f.path)?.status).toBe('pausado')
  await reopened.handle('/stage/resume', 'POST', new URLSearchParams(), { name: 'CARD-1', stage: f.stage.name })
  expect(f.calls).toHaveLength(2)
  expect(readAgent(f.path)?.status).toBe('rodando')
  f.calls[1].child.emit('close', 0)
})

test('does not duplicate a persisted execution that is still exiting', () => {
  const f = fixture('claude')
  f.create().start(f.path, f.stage, f.card)
  const record = readStageAgentRecord(f.path)!
  writeFileSync(join(f.path, 'agent.json'), JSON.stringify({ ...record, pausedAt: new Date().toISOString() }))
  expect(() => f.create().resume(f.path, f.stage.name)).toThrow('ainda está encerrando')
  expect(f.calls).toHaveLength(1)
  expect(f.signals).toEqual([])
  f.calls[0].child.emit('close', 0)
})
