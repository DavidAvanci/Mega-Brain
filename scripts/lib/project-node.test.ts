import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectNode } from './project-node.ts'

const directories: string[] = []
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mega-node-'))
  directories.push(dir)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ engines: { node: `>=${process.version.slice(1).split('.')[0]}` } }),
  )
  return dir
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolveProjectNode', () => {
  it('resolves exact installed runtime and validates process version/path', () => {
    const dir = fixture()
    writeFileSync(join(dir, '.nvmrc'), `${process.version}\n`)
    const result = resolveProjectNode(dir)
    expect(result.status).toBe('resolved')
    expect(result.runtime?.project?.version).toBe(process.version.slice(1))
    expect(result.runtime?.project?.execPath).toBe(process.execPath)
  })

  it('blocks a missing exact version under strict policy', () => {
    const dir = fixture()
    writeFileSync(join(dir, '.node-version'), '99.99.99\n')
    expect(resolveProjectNode(dir).status).toBe('blocked')
  })

  it('uses an explicitly permitted same-major fallback with a warning', () => {
    const dir = fixture()
    const major = process.version.slice(1).split('.')[0]
    writeFileSync(join(dir, '.node-version'), `${major}.999.999\n`)
    const result = resolveProjectNode(dir, { policy: 'same-major-fallback' })
    expect(result.status).toBe('resolved')
    expect(result.runtime?.warning).toContain('Fallback explícito')
  })

  it('resolves LTS aliases from locally available nvm metadata without network access', () => {
    const dir = fixture()
    const nvm = join(dir, '.nvm')
    mkdirSync(join(nvm, 'alias', 'lts'), { recursive: true })
    writeFileSync(join(nvm, 'alias', 'lts', 'current'), process.version.slice(1))
    writeFileSync(join(dir, '.nvmrc'), 'lts/*')
    const result = resolveProjectNode(dir, { env: { ...process.env, NVM_DIR: nvm } })
    expect(result.status).toBe('resolved')
    expect(result.runtime?.project?.version).toBe(process.version.slice(1))
  })
})
