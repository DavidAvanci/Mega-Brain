import { afterEach, expect, test } from 'vitest'
import { claudeBin } from './executor'

const originalClaudeBin = process.env.MEGA_BRAIN_CLAUDE_BIN

afterEach(() => {
  if (originalClaudeBin === undefined) delete process.env.MEGA_BRAIN_CLAUDE_BIN
  else process.env.MEGA_BRAIN_CLAUDE_BIN = originalClaudeBin
})

test('claudeBin honors the executable propagated by the backend', () => {
  process.env.MEGA_BRAIN_CLAUDE_BIN = '  /fixture/bin/claude  '
  expect(claudeBin()).toBe('/fixture/bin/claude')
})
