import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { ProcessChild, ProcessRunner } from '../process'
import { STAGES } from './stage-catalog'
import { createStageController } from './stage-controller'

const card = { title: 'Card', description: '', status: 'desenvolvendo', flow: 'medio' as const }
const stage = STAGES.find((candidate) => candidate.name === 'run-task-checklist')!

function controllerOn(path: string) {
  let spawns = 0
  const runner = {
    spawn() {
      spawns += 1
      return Object.assign(new EventEmitter(), { pid: process.pid, unref() {} }) as unknown as ProcessChild
    },
  } as unknown as ProcessRunner
  const controller = createStageController(
    {
      executables: {},
      worktreesDir: join(path, 'worktrees'),
      preferences: {
        settingsFile: join(path, 'settings.json'),
        editor: 'vscode',
        editorCommand: '',
        llmProvider: 'claude',
        onboardingCompleted: true,
      },
    },
    runner,
  )
  return { controller, spawns: () => spawns }
}

function cardFolder(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'mega-brain-stage-controller-')), 'card')
  mkdirSync(path)
  writeFileSync(join(path, 'card.json'), JSON.stringify(card))
  return path
}

test('does not start a second run while the card already has one running', () => {
  const path = cardFolder()
  const { controller, spawns } = controllerOn(path)

  controller.start(path, stage, card)
  controller.start(path, stage, card)

  expect(spawns()).toBe(1)
})

test('does not start a run when another session left a live agent on the card', () => {
  const path = cardFolder()
  writeFileSync(
    join(path, 'agent.json'),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), stage: stage.name }),
  )
  const { controller, spawns } = controllerOn(path)

  controller.start(path, stage, card)

  expect(spawns()).toBe(0)
})

test('starts again once the previous agent is gone', () => {
  const path = cardFolder()
  writeFileSync(
    join(path, 'agent.json'),
    JSON.stringify({ pid: 2 ** 30, startedAt: new Date().toISOString(), stage: stage.name }),
  )
  const { controller, spawns } = controllerOn(path)

  controller.start(path, stage, card)

  expect(spawns()).toBe(1)
})
