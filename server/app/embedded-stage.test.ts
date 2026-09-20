import { expect, test } from 'vitest'
import { runEmbeddedStage, type EmbeddedStageName } from './embedded-stage'

test('dispatches only the supported embedded stage names', async () => {
  const loaded: EmbeddedStageName[] = []
  await runEmbeddedStage('run-test-checklist', async (stage) => {
    loaded.push(stage)
  })
  expect(loaded).toEqual(['run-test-checklist'])
  await expect(runEmbeddedStage('toString')).rejects.toThrow('Etapa interna desconhecida')
})
