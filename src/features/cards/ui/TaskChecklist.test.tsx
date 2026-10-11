// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { parseTaskChecklist } from '../../../../shared/domain/task-checklist'
import { checklistJson } from '../../../../test/checklist-fixtures'
import { TaskChecklist } from './TaskChecklist'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('renders grouped tasks with distinct blocked/discarded states and complete item context', async () => {
  const checklist = parseTaskChecklist(
    checklistJson([
      { repo: 'api', title: 'Criar contrato', state: 'done' },
      {
        repo: 'web',
        title: 'Exibir contrato',
        state: 'blocked',
        deps: ['T1'],
        context: 'Campo obrigatório',
        completionCriteria: ['Mostra total'],
        files: ['src/view.tsx'],
        notes: ['Falta configuração'],
      },
      { repo: 'web', title: 'Abordagem antiga', state: 'discarded', discardReason: 'Substituída por T2' },
    ]),
  )
  await act(async () => root.render(<TaskChecklist checklist={checklist} />))
  expect(host.querySelectorAll('section')).toHaveLength(2)
  expect(host.textContent).toContain('1/1 concluídas')
  expect(host.textContent).toContain('0/1 concluídas')
  expect(host.textContent).toContain('Bloqueada')
  expect(host.textContent).toContain('Descartada')
  expect(host.textContent).toContain('Campo obrigatório')
  expect(host.textContent).toContain('Mostra total')
  expect(host.textContent).toContain('src/view.tsx')
  expect(host.textContent).toContain('Falta configuração')
  expect(host.textContent).toContain('Substituída por T2')
})

test('poll updates preserve an expanded item and safely render agent-supplied content', async () => {
  const checklist = parseTaskChecklist(
    checklistJson([{ title: '<img src=x onerror=alert(1)>', notes: ['<script>bad()</script>'] }]),
  )
  await act(async () => root.render(<TaskChecklist checklist={checklist} />))
  const details = host.querySelector('details')!
  details.open = true
  await act(async () =>
    root.render(
      <TaskChecklist
        checklist={{ ...checklist, items: checklist.items.map((item) => ({ ...item, state: 'done' })) }}
      />,
    ),
  )
  expect(host.querySelector('details')).toBe(details)
  expect(details.open).toBe(true)
  expect(host.querySelector('img, script')).toBeNull()
  expect(host.textContent).toContain('Concluída')
})

test('shows an empty state for an unpopulated checklist', async () => {
  await act(async () => root.render(<TaskChecklist checklist={{ schemaVersion: 1, items: [] }} />))
  expect(host.textContent).toBe('Nenhuma task planejada.')
})
