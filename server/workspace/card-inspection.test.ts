import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { checklistJson } from '../../test/checklist-fixtures'
import { TASK_CHECKLIST_FILE } from '../../shared/domain/task-checklist'
import type { ProcessRunner } from '../process'
import { inspectCard } from './card-inspection'
import { listBoardCards } from './board-list'
import type { AgentSession } from '../../shared/domain/agents'

const runner: ProcessRunner = {
  spawn() {
    throw new Error('Não deve iniciar agentes')
  },
  execFileSync() {
    return ''
  },
  execFile(_command, _args, _options, callback) {
    callback(null, '', '')
  },
}

test.each(['claude', 'codex'] as const)('the board exposes only %s narration for detected sessions', (provider) => {
  const root = mkdtempSync(join(tmpdir(), 'board-narration-'))
  const card = join(root, 'card')
  mkdirSync(card)
  writeFileSync(join(card, 'card.json'), JSON.stringify({ title: 'Review', status: 'a-fazer' }))
  const session: AgentSession = {
    id: 'external-review',
    provider,
    status: 'rodando',
    cardId: 'card',
    cwd: card,
    title: 'Smart Diff',
    startedAt: '',
    updatedAt: '',
    activity: 'Bash: cd /tmp; grep segredo',
  }
  const cards = (sessions: AgentSession[]) =>
    listBoardCards(root, join(root, 'worktrees'), undefined, runner, () => {}, sessions)
  expect(cards([session])[0].agents[0].activity).toBeUndefined()
  const narration = 'Vou explicar a mudança de contrato e os tradeoffs.'
  const projected = cards([{ ...session, narration }])[0]
  expect(projected.agents).toMatchObject([{ execution: 'agent', provider, activity: narration }])
  expect(JSON.stringify(projected)).not.toMatch(/segredo|Bash/)
})

test('checklist section returns validated objects, preserving raw artifact access', () => {
  const path = mkdtempSync(join(tmpdir(), 'card-inspection-'))
  const card = { path, name: 'CARD-1' }
  expect(inspectCard(card, path, undefined, runner, 'checklist')).toEqual({ checklist: null })
  writeFileSync(
    join(path, TASK_CHECKLIST_FILE),
    checklistJson([{ state: 'blocked', notes: ['Falta base'] }, { state: 'discarded' }]),
  )
  const result = inspectCard(card, path, undefined, runner, 'checklist')
  expect(result).toMatchObject({
    checklist: { schemaVersion: 1, items: [{ state: 'blocked', notes: ['Falta base'] }, { state: 'discarded' }] },
  })
  const raw = inspectCard(card, path, undefined, runner, 'file', TASK_CHECKLIST_FILE) as { content: string }
  expect(JSON.parse(raw.content)).toEqual((result as { checklist: unknown }).checklist)
  expect(() => inspectCard(card, path, undefined, runner, 'file', '../card.json')).toThrow('inválido')
})

test('invalid JSON is exposed by detail without silently serving an older checklist', () => {
  const path = mkdtempSync(join(tmpdir(), 'card-inspection-'))
  writeFileSync(join(path, TASK_CHECKLIST_FILE), '{')
  expect(() => inspectCard({ path, name: 'CARD-1' }, path, undefined, runner, 'checklist')).toThrow('JSON inválido')
})

test('one invalid card checklist cannot break the board and valid counts share scheduler semantics', async () => {
  const { mkdirSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'board-checklists-'))
  for (const name of ['invalid', 'valid']) {
    mkdirSync(join(root, name))
    writeFileSync(join(root, name, 'card.json'), JSON.stringify({ title: name, status: 'a-fazer' }))
  }
  writeFileSync(join(root, 'invalid', TASK_CHECKLIST_FILE), '{')
  writeFileSync(
    join(root, 'valid', TASK_CHECKLIST_FILE),
    checklistJson([{ state: 'done' }, { state: 'blocked' }, { state: 'discarded' }]),
  )
  const cards = listBoardCards(root, join(root, 'worktrees'), undefined, runner, () => {
    throw new Error('Não deve iniciar agentes')
  })
  expect(cards.find((card) => card.name === 'invalid')).toMatchObject({
    checklistError: `${TASK_CHECKLIST_FILE}: JSON inválido`,
  })
  expect(cards.find((card) => card.name === 'valid')?.taskCounts[TASK_CHECKLIST_FILE]).toEqual({
    total: 2,
    done: 1,
    blocked: 1,
    failed: 0,
    discarded: 1,
  })
})
