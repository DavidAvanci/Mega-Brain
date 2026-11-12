import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { taskId } from './task-id'

const root = mkdtempSync(join(tmpdir(), 'mega-brain-task-id-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function workspace(folder: string, plan?: string): string {
  const path = join(root, folder)
  mkdirSync(path, { recursive: true })
  if (plan) writeFileSync(join(path, 'PLAN.md'), plan)
  return path
}

test('cards MB usam o slug em minúsculas, igual à pasta de worktrees criada pelo scheduler', () => {
  expect(taskId(workspace('MB-111'))).toBe('mb-111')
})

test('cards com chave Jira mantêm a chave em maiúsculas', () => {
  expect(taskId(workspace('estr-456'))).toBe('ESTR-456')
})

test('pasta sem chave usa a issue do PLAN.md quando ela é uma chave Jira', () => {
  expect(taskId(workspace('migrar-notas', '# PLAN\nissue: tat1c0-950\n'))).toBe('TAT1C0-950')
})
