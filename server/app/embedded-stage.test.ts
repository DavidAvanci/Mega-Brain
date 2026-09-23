import { expect, test } from 'vitest'
import { EMBEDDED_STAGE } from '../../scripts/lib/env.ts'
import { runEmbeddedStage, type EmbeddedStageName } from './embedded-stage'

test('dispatches only the supported embedded stage names', async () => {
  const loaded: EmbeddedStageName[] = []
  await runEmbeddedStage('run-test-checklist', async (stage) => {
    loaded.push(stage)
  })
  expect(loaded).toEqual(['run-test-checklist'])
  await expect(runEmbeddedStage('toString')).rejects.toThrow('Etapa interna desconhecida')
})

test('marks the process as embedded before loading the stage module', async () => {
  delete process.env[EMBEDDED_STAGE]
  let seen: string | undefined
  await runEmbeddedStage('stage-task', async () => {
    seen = process.env[EMBEDDED_STAGE]
  })
  delete process.env[EMBEDDED_STAGE]
  expect(seen).toBe('1')
})
