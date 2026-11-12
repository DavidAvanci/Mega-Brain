import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectVerificationAdapters } from './verification-adapters.ts'

const fixtures: string[] = []
function fixture(scripts: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'mega-adapters-'))
  fixtures.push(dir)
  mkdirSync(join(dir, 'node_modules', 'eslint'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^9.0.0', prettier: '^3.0.0' }, scripts }))
  writeFileSync(join(dir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '9.1.0' }))
  return dir
}

afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('detectVerificationAdapters', () => {
  it('only enables locally declared adapters that the project scripts invoke', () => {
    const dir = fixture({ lint: 'eslint src', format: 'prettier --check src' })
    expect(detectVerificationAdapters(dir)).toEqual([
      { id: 'eslint', executable: 'eslint', version: '9.1.0', supportsStdin: true },
      { id: 'prettier', executable: 'prettier', version: '^3.0.0', supportsStdin: true },
    ])
  })

  it('does not infer tools merely because they are installed', () => {
    expect(detectVerificationAdapters(fixture({ build: 'tsc -b' }))).toEqual([])
  })
})
