import { pathToFileURL } from 'node:url'
import { beforeEach, expect, test } from 'vitest'
import { EMBEDDED_STAGE, runsAsCommand } from './env'

const entry = pathToFileURL('/tmp/stage.ts').href

beforeEach(() => {
  process.argv[1] = '/tmp/stage.ts'
  delete process.env[EMBEDDED_STAGE]
})

test('runsAsCommand recognizes the module that was invoked from the command line', () => {
  expect(runsAsCommand(entry)).toBe(true)
  expect(runsAsCommand(pathToFileURL('/tmp/outro.ts').href)).toBe(false)
})

test('runsAsCommand stays silent when the embedded dispatcher already owns the stage', () => {
  process.env[EMBEDDED_STAGE] = '1'
  expect(runsAsCommand(entry)).toBe(false)
})
