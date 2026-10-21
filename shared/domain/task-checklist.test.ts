import { expect, test } from 'vitest'
import { checklistJson } from '../../test/checklist-fixtures'
import { activeChecklistItems, countTasks, parseTaskChecklist } from './task-checklist'

test('normalizes optional arrays and transmits item context and criteria', () => {
  const checklist = parseTaskChecklist({
    schemaVersion: 1,
    issue: 'CARD-1',
    items: [
      {
        id: 'T1',
        title: 'Criar contrato',
        repo: 'api',
        context: 'Contrato exato',
        completionCriteria: ['Expõe o atributo'],
        timeoutMinutes: 12,
        maxAttempts: 2,
      },
    ],
  })
  expect(checklist.items[0]).toMatchObject({
    files: [],
    requires: [],
    creates: [],
    deps: [],
    notes: [],
    state: 'pending',
    context: 'Contrato exato',
    completionCriteria: ['Expõe o atributo'],
    timeoutMinutes: 12,
    maxAttempts: 2,
  })
})

test('preserves validated verification repair metadata and keeps legacy items valid', () => {
  const checklist = parseTaskChecklist({
    schemaVersion: 1,
    items: [
      {
        id: 'VFY1',
        title: 'Corrigir lint',
        repo: 'api',
        state: 'pending',
        repair: {
          checkId: 'lint',
          fingerprint: 'failure-1',
          profileFingerprint: 'profile-1',
          source: 'verification',
          wave: 1,
          diagnostics: [{ file: 'src/a.ts', rule: 'no-unused-vars', message: 'Unused value' }],
        },
        origin: 'verification-repair',
      },
    ],
  })
  expect(parseTaskChecklist(JSON.stringify(checklist)).items[0]).toMatchObject({
    origin: 'verification-repair',
    repair: {
      checkId: 'lint',
      fingerprint: 'failure-1',
      profileFingerprint: 'profile-1',
      source: 'verification',
      wave: 1,
      diagnostics: [{ file: 'src/a.ts', rule: 'no-unused-vars', message: 'Unused value' }],
    },
  })
  expect(
    parseTaskChecklist({ schemaVersion: 1, items: [{ id: 'T1', title: 'Antiga', repo: 'api' }] }).items[0].repair,
  ).toBeUndefined()
})

test.each([
  ['{', 'JSON inválido'],
  [JSON.stringify({ schemaVersion: 2, items: [] }), 'schemaVersion'],
  [JSON.stringify({ schemaVersion: 1, items: {} }), 'items'],
  [checklistJson([{ id: '' }]), '.id'],
  [checklistJson([{ repo: '' }]), '.repo'],
  [checklistJson([{ title: '' }]), '.title'],
  [checklistJson([{ files: 'src/a.ts' as unknown as string[] }]), '.files'],
  [checklistJson([{ state: 'skipped' as never }]), '.state'],
  [checklistJson([{ timeoutMinutes: 0 }]), 'timeoutMinutes'],
  [checklistJson([{ maxAttempts: 1.5 }]), 'maxAttempts'],
  [checklistJson([{ deps: ['T9'] }]), 'não existe'],
  [checklistJson([{ deps: ['T1'] }]), 'si mesmo'],
  [checklistJson([{ id: 'T1' }, { id: 'T1' }]), 'ID repetido'],
  [checklistJson([{ deps: ['T2'] }, { deps: ['T1'] }]), 'Ciclo'],
  [checklistJson([{ deps: ['T2'] }, { state: 'discarded' }]), 'descartado'],
])('rejects invalid or unsafe checklist: %s', (json, message) => {
  expect(() => parseTaskChecklist(json)).toThrow(message)
})

test('rejects misspelled fields instead of silently removing execution constraints', () => {
  expect(() =>
    parseTaskChecklist({ schemaVersion: 1, items: [{ id: 'T1', title: 'Fazer', repo: 'api', dependecies: ['T2'] }] }),
  ).toThrow('campo desconhecido')
})

test('counts blocked separately from discarded and uses the same executable set', () => {
  const checklist = parseTaskChecklist(
    checklistJson([
      { state: 'done' },
      { state: 'pending' },
      { state: 'blocked' },
      { state: 'failed' },
      { state: 'discarded' },
    ]),
  )
  expect(countTasks(checklist)).toEqual({ total: 4, done: 1, blocked: 1, failed: 1, discarded: 1 })
  expect(activeChecklistItems(checklist)).toHaveLength(4)
})
