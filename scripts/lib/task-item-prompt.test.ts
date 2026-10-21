import { expect, test } from 'vitest'
import { checklistItem } from '../../test/checklist-fixtures'
import { taskItemPrompt } from './task-item-prompt'

test('passes context and completion criteria even without a PLAN.md', () => {
  const prompt = taskItemPrompt(
    checklistItem('T2', {
      repo: 'web',
      title: 'Exibir atributo',
      context: 'Contrato API: total é inteiro',
      completionCriteria: ['Mostra total na listagem'],
      files: ['src/orders.tsx'],
    }),
    'Regras do executor',
    [
      { repo: 'api', path: '/api' },
      { repo: 'web', path: '/web' },
    ],
  )
  expect(prompt).toContain('Item: T2 — Exibir atributo')
  expect(prompt).toContain('Contexto do item:\nContrato API: total é inteiro')
  expect(prompt).toContain('Critérios de conclusão:\n- Mostra total na listagem')
  expect(prompt).toContain('Arquivos permitidos: src/orders.tsx')
  expect(prompt).toContain('api: /api; web: /web')
  expect(prompt).toContain('Não edite TASK-CHECKLIST.json')
  expect(prompt).not.toContain('Contexto do plano')
})

test('keeps complementary PLAN context for migrated cards without sending unrelated tasks', () => {
  const plan = '## Contexto\n### T1\nContrato antigo\n### T2\nOutra tarefa\n'
  const prompt = taskItemPrompt(checklistItem('T1'), 'Regras', [], plan)
  expect(prompt).toContain('Contexto do plano:\nContrato antigo')
  expect(prompt).not.toContain('Outra tarefa')
  expect(prompt).toContain('Arquivos permitidos: (não especificado)')
})

test('includes only the profile-authorized check and evidence for a repair task', () => {
  const prompt = taskItemPrompt(checklistItem('VFY1', { origin: 'verification-repair' }), 'Regras', [], '', undefined, {
    id: 'eslint',
    argv: ['eslint', '--format', 'json'],
    diagnostics: [{ file: 'src/a.ts', rule: 'no-unused-vars', message: 'Unused variable' }],
  })
  expect(prompt).toContain('Comando de leitura autorizado')
  expect(prompt).toContain('eslint')
  expect(prompt).toContain('src/a.ts · no-unused-vars: Unused variable')
  expect(prompt).toContain('Não execute checks ou builds diferentes')
})
