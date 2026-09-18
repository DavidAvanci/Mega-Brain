import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { stageScriptCommand } from './service'

const stage = { name: 'run-task-checklist', script: 'scripts/dev-stage.ts' }

describe('stage script command', () => {
  test('reuses the self-contained desktop runtime instead of requiring tsx', () => {
    expect(stageScriptCommand('/workspace/card', stage, {
      runtimeEntry: '/runtime/main.mjs',
      currentEntry: '/runtime/main.mjs',
      execPath: '/usr/bin/node',
      megaRoot: '/source',
    })).toEqual(['/usr/bin/node', ['/runtime/main.mjs', '/workspace/card']])
  })

  test('keeps the source script path outside the bundled desktop runtime', () => {
    expect(stageScriptCommand('/workspace/card', stage, {
      runtimeEntry: '/source/server/workspace/service.ts',
      currentEntry: '/source/server/main.ts',
      execPath: '/usr/bin/node',
      megaRoot: '/source',
    })).toEqual([
      join('/source', 'node_modules', '.bin', 'tsx'),
      [join('/source', 'scripts/dev-stage.ts'), '/workspace/card'],
    ])
  })
})
