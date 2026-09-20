import { expect, test } from 'vitest'
import { claudeBin, codexBin } from './agent-executable'

test('configured agent executables take precedence over discovery', () => {
  expect(claudeBin('/opt/claude')).toBe('/opt/claude')
  expect(codexBin('/opt/codex')).toBe('/opt/codex')
})
