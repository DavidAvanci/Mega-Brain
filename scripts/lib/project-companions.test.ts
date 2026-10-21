import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diagnoseCompanionArtifacts } from './project-companions.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mega-companions-'))
  roots.push(root)
  const app = join(root, 'api')
  const companion = join(root, 'api-core')
  mkdirSync(app)
  mkdirSync(companion)
  return { app, companion }
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('diagnoseCompanionArtifacts', () => {
  it('finds a missing static Jest alias in a related companion repository', () => {
    const { app, companion } = fixture()
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ jest: { moduleNameMapper: { '^api-core$': '<rootDir>/../api-core/dist/index.js' } } }),
    )
    const issues = diagnoseCompanionArtifacts(app, [{ alias: 'api-core', path: companion }])
    expect(issues).toEqual([
      expect.objectContaining({ status: 'missing', companionPath: companion, artifact: 'dist/index.js' }),
    ])
  })

  it('does not evaluate dynamic Jest config or treat regex aliases as literal paths', () => {
    const { app, companion } = fixture()
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ jest: { moduleNameMapper: { '^@api/(.*)$': '<rootDir>/../api-core/dist/$1' } } }),
    )
    const issues = diagnoseCompanionArtifacts(app, [{ alias: 'api-core', path: companion }])
    expect(issues[0]).toMatchObject({ status: 'inconclusive' })
  })
})
