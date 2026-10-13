import { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import type { ProcessOwner, ProcessRunner } from '../process'
import type { PlanningSelector } from '../planning-selection/service'
import { PLANNING_SELECTION_POLICY, type PlanningSelection } from '../../shared/domain/planning-selection'
import { readStageAgentRecord, writeStageAgentRecord } from './agent-checkpoint'
import { createStageController } from './stage-controller'
import { STAGES } from './stage-catalog'
import { readAgent } from './stage-agent-status'
import { writeStageSettings } from './stage-settings'

const card = { title: 'Card', description: 'Planejar alteração', status: 'planejando', flow: 'medio' as const }
const stage = STAGES.find((candidate) => candidate.name === 'task-planning')!
const selection: PlanningSelection = {
  source: 'jev',
  provider: 'chatgpt',
  settings: { model: 'gpt-6-luna', effort: 'high', fastMode: false },
  processedAt: new Date().toISOString(),
  inputHash: 'hash',
  policyVersion: PLANNING_SELECTION_POLICY,
}
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function setup(select: PlanningSelector = vi.fn(async () => selection)) {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-planning-controller-'))
  roots.push(root)
  const path = join(root, 'card')
  mkdirSync(path)
  writeFileSync(join(path, 'card.json'), JSON.stringify(card))
  writeStageSettings(root, { 'task-planning': { model: 'jev', effort: 'low' } }, 'chatgpt')
  const config = loadMegaBrainConfig({ env: {}, homeDir: root })
  config.preferences.llmProvider = 'chatgpt'
  config.jev.enabled = true
  const children: ChildProcess[] = []
  const spawn = vi.fn(() => {
    const child = new ChildProcess()
    Object.defineProperty(child, 'pid', { value: process.pid })
    children.push(child)
    return child
  })
  const runner = { spawn } as unknown as ProcessRunner
  const owner = {
    own: (child: ChildProcess) => child,
    stop: async (child: ChildProcess) => {
      child.emit('close', 0)
    },
  } as unknown as ProcessOwner
  const controller = createStageController(config, runner, owner, undefined, select)
  return { root, path, config, controller, select, spawn, children }
}

test('Jev planning launches exactly once with the selected model and effort and keeps other stages intact', async () => {
  const { path, controller, select, spawn } = setup()
  controller.start(path, stage, card)
  expect(readAgent(path)).toMatchObject({
    status: 'rodando',
    phase: 'Jev escolhendo modelo e esforço',
    resumable: false,
  })
  controller.start(path, stage, card)
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  expect(select).toHaveBeenCalledTimes(1)
  const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1]
  expect(args).toContain('gpt-6-luna')
  expect(args).toContain('model_reasoning_effort="high"')
  expect(args).not.toContain('jev')
  expect(readStageAgentRecord(path)).toMatchObject({
    model: 'gpt-6-luna',
    effort: 'high',
    planningSelection: selection,
  })
  expect(JSON.parse(readFileSync(join(path, 'planning-selection.json'), 'utf8'))).toEqual(selection)
  expect(readAgent(path)).toMatchObject({ model: 'gpt-6-luna', effort: 'high' })
})

test('interruption aborts a pending selection and cannot launch a late result', async () => {
  let finish!: (result: PlanningSelection) => void
  let signal!: AbortSignal
  const select: PlanningSelector = vi.fn(async (_card, _settings, inputSignal) => {
    signal = inputSignal
    return new Promise<PlanningSelection>((resolve) => {
      finish = resolve
    })
  })
  const { path, controller, spawn } = setup(select)
  controller.start(path, stage, card)
  await controller.stop(path, stage.name)
  expect(signal.aborted).toBe(true)
  finish(selection)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(spawn).not.toHaveBeenCalled()
  expect(existsSync(join(path, 'agent.json'))).toBe(false)
})

test('deleting a card during selection cannot recreate it or launch an agent', async () => {
  let finish!: (result: PlanningSelection) => void
  const select: PlanningSelector = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const { path, controller, spawn } = setup(select)
  controller.start(path, stage, card)
  rmSync(path, { recursive: true })
  finish(selection)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(spawn).not.toHaveBeenCalled()
  expect(existsSync(path)).toBe(false)
})

test('a changed title invalidates the pending decision and triggers selection against the current card', async () => {
  let finish!: (result: PlanningSelection) => void
  const select = vi
    .fn<PlanningSelector>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(selection)
  const { path, controller, spawn } = setup(select)
  controller.start(path, stage, card)
  writeFileSync(join(path, 'card.json'), JSON.stringify({ ...card, title: 'Novo escopo' }))
  finish(selection)
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  expect(select).toHaveBeenCalledTimes(2)
  expect(select.mock.calls[1][0].title).toBe('Novo escopo')
  const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1]
  expect(args.at(-1)).toContain('Novo escopo')
})

test('resuming preserves the chosen model and effort without consulting Jev again', async () => {
  const { root, path, controller, select, spawn } = setup()
  controller.start(path, stage, card)
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  writeStageAgentRecord(path, { ...readStageAgentRecord(path), sessionId: 'session-1' })
  await controller.pause(path, stage.name)
  writeStageSettings(root, { 'task-planning': { model: 'gpt-6.1-sol', effort: 'low' } }, 'chatgpt')
  controller.resume(path, stage.name)
  expect(select).toHaveBeenCalledTimes(1)
  expect(spawn).toHaveBeenCalledTimes(2)
  const args = (spawn.mock.calls[1] as unknown as [string, string[]])[1]
  expect(args).toContain('resume')
  expect(args).toContain('gpt-6-luna')
  expect(args).toContain('model_reasoning_effort="high"')
  expect(readStageAgentRecord(path)).toMatchObject({
    model: 'gpt-6-luna',
    effort: 'high',
    planningSelection: selection,
  })
})

test('disabled Jev falls back at launch and never passes the sentinel to the CLI', async () => {
  const { path, config, spawn } = setup()
  config.jev.enabled = false
  const controller = createStageController(config, { spawn } as unknown as ProcessRunner)
  controller.start(path, stage, card)
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1]
  expect(args).not.toContain('jev')
  expect(args).toContain('gpt-6.1-sol')
  expect(args).toContain('model_reasoning_effort="low"')
  expect(readStageAgentRecord(path)?.planningSelection).toMatchObject({ source: 'fallback', reason: 'disabled' })
})
