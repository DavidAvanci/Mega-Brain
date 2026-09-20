import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readCard } from './card-record'
import { updateCard } from './card-update'

test('persists normalized fields and starts the newly selected automatic stage', () => {
  const path = mkdtempSync(join(tmpdir(), 'card-update-'))
  writeFileSync(join(path, 'card.json'), JSON.stringify({ title: 'Antes', description: '', status: 'a-fazer' }))
  const started: string[] = []

  updateCard(path, 'card', { title: 'Depois', status: 'planejando', flow: 'simples' }, (_path, stage) =>
    started.push(stage.name),
  )

  expect(readCard(path, 'card')).toMatchObject({ title: 'Depois', status: 'planejando', flow: 'simples' })
  expect(started).toEqual(['task-planning'])
})
