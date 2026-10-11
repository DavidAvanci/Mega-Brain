import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseTaskChecklist, TASK_CHECKLIST_FILE } from '../domain/task-checklist'
import { checklistJson } from '../../test/checklist-fixtures'
import { readTaskChecklist, writeTaskChecklist } from './task-checklist'

test('migrates old cards once, preserving notes, metadata, discarded tasks and the original', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checklist-migration-'))
  const legacy = join(directory, 'TASK-CHECKLIST.md')
  const markdown =
    '# TASK CHECKLIST\nissue: CARD-1\n## api\n- [x] T1 Criar base {files: src/base.ts; creates: src/base.ts; timeoutMin: 12; attempts: 2}\n  > Integrado sem conflitos\n  - Contrato importante\n- [-] T2 Consumir {requires: src/base.ts; deps: T1}\n- [ ] ~~T3 Descartado~~ — substituído\n## web\n- [ ] T4 Entregar {deps: T1}\n'
  writeFileSync(legacy, markdown)
  const document = readTaskChecklist(directory)!
  expect(document.issue).toBe('CARD-1')
  expect(document.items[0]).toMatchObject({
    state: 'done',
    files: ['src/base.ts'],
    notes: ['Integrado sem conflitos'],
    context: '- Contrato importante',
    timeoutMinutes: 12,
    maxAttempts: 2,
  })
  expect(document.items[1]).toMatchObject({ state: 'blocked', deps: ['T1'], requires: ['src/base.ts'] })
  expect(document.items[2].state).toBe('discarded')
  expect(document.items[3]).toMatchObject({ repo: 'web', deps: ['T1'] })
  expect(readFileSync(`${legacy}.bak`, 'utf8')).toBe(markdown)
  expect(existsSync(legacy)).toBe(false)
  writeFileSync(legacy, 'conteúdo obsoleto')
  expect(readTaskChecklist(directory)).toEqual(document)
})

test('assigns stable IDs to old items without colliding with explicit or discarded IDs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checklist-migration-'))
  writeFileSync(join(directory, 'TASK-CHECKLIST.md'), '## api\n- [ ] Sem ID\n- [ ] T1 Explícito\n- [ ] ~~T2 Antigo~~\n')
  expect(readTaskChecklist(directory)!.items.map((item) => item.id)).toEqual(['T3', 'T1', 'T2'])
})

test('invalid JSON cannot fall back to stale Markdown or be overwritten by an invalid mutation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checklist-invalid-'))
  const file = join(directory, TASK_CHECKLIST_FILE)
  writeFileSync(file, '{')
  writeFileSync(join(directory, 'TASK-CHECKLIST.md'), '## api\n- [x] T1 Obsoleto\n')
  expect(() => readTaskChecklist(directory)).toThrow('JSON inválido')
  expect(() =>
    writeTaskChecklist(file, {
      schemaVersion: 1,
      items: parseTaskChecklist(checklistJson([{ deps: [] }])).items.map((item) => ({ ...item, deps: ['T9'] })),
    }),
  ).toThrow('não existe')
  expect(readFileSync(file, 'utf8')).toBe('{')
  expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false)
})

test('invalid legacy dependencies preserve the original and do not create a partial JSON', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checklist-invalid-'))
  const legacy = join(directory, 'TASK-CHECKLIST.md')
  writeFileSync(legacy, '## api\n- [ ] T1 Fazer {deps: T9}\n')
  expect(() => readTaskChecklist(directory)).toThrow('não existe')
  expect(existsSync(legacy)).toBe(true)
  expect(existsSync(join(directory, TASK_CHECKLIST_FILE))).toBe(false)
})

test('migrates both strike styles and legacy positional dependencies without losing active IDs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checklist-migration-'))
  writeFileSync(
    join(directory, 'TASK-CHECKLIST.md'),
    '## api\n- [ ] Primeiro\n- [ ] T1 ~~Substituído~~ — motivo\n- [ ] ~~T2 Antigo~~\n- [ ] Consumidor {deps: #1}\n## ~~web~~\n- [ ] T9 Descartado junto com o repo\n',
  )
  const document = readTaskChecklist(directory)!
  expect(document.items.map(({ id, state, deps }) => ({ id, state, deps }))).toEqual([
    { id: 'T3', state: 'pending', deps: [] },
    { id: 'T1', state: 'discarded', deps: [] },
    { id: 'T2', state: 'discarded', deps: [] },
    { id: 'T4', state: 'pending', deps: ['T3'] },
    { id: 'T9', state: 'discarded', deps: [] },
  ])
})
