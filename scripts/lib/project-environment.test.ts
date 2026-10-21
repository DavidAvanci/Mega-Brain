import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diagnoseProjectEnvironment } from './project-environment.ts'

const fixtures: string[] = []
function fixture(packageJson: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'mega-environment-'))
  fixtures.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...packageJson, engines: { node: `>=${process.version.slice(1).split('.')[0]}` } }))
  writeFileSync(join(dir, 'package-lock.json'), '{}')
  return dir
}

afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('diagnoseProjectEnvironment', () => {
  it('reports missing dependencies and accepts an isolated canonical lockfile match', () => {
    const dir = fixture({ dependencies: { example: '^1.0.0' } })
    const result = diagnoseProjectEnvironment(dir, 'web')
    expect(result.diagnostics.map((entry) => entry.code)).toContain('dependencies-missing')
  })

  it('accepts Yarn PnP without inventing missing node_modules packages', () => {
    const dir = fixture({ packageManager: 'yarn@4.0.0', dependencies: { example: '^1.0.0' } })
    rmSync(join(dir, 'package-lock.json'))
    writeFileSync(join(dir, 'yarn.lock'), '# yarn lockfile')
    writeFileSync(join(dir, '.pnp.cjs'), '/* generated */')
    const result = diagnoseProjectEnvironment(dir, 'web')
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain('dependencies-missing')
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain('dependency-missing')
  })
})
