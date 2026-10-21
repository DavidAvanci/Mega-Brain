import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatProjectFiles } from './project-format.ts'

const fixtures: string[] = []
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'mega-format-'))
  fixtures.push(cwd)
  writeFileSync(join(cwd, 'a.ts'), 'const value=1')
  return cwd
}

afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('formatProjectFiles', () => {
  it('does not write when whole-file formatting was not authorized', async () => {
    const cwd = fixture()
    const result = await formatProjectFiles({ cwd, files: ['a.ts'], formatter: 'prettier', node: { execPath: process.execPath, version: process.version } })
    expect(result.status).toBe('skipped')
  })

  it('returns passed without spawning a command when no scoped file exists', async () => {
    const cwd = fixture()
    const result = await formatProjectFiles({ cwd, files: ['missing.ts', '../outside.ts'], formatter: 'biome', node: { execPath: process.execPath, version: process.version }, allowWholeFile: true })
    expect(result).toMatchObject({ status: 'passed', stdout: '' })
  })
})
