import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cardChangeScope } from './card-change-scope.ts'

let root = ''
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

describe('cardChangeScope', () => {
  it('distinguishes added, modified, renamed and deleted paths from the base ref', () => {
    root = mkdtempSync(join(tmpdir(), 'card-scope-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    git('init', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    writeFileSync(join(root, 'modified.ts'), 'before')
    writeFileSync(join(root, 'rename.ts'), 'rename')
    writeFileSync(join(root, 'deleted.ts'), 'delete')
    git('add', '.')
    git('commit', '-m', 'base')
    git('branch', 'origin/main')
    writeFileSync(join(root, 'modified.ts'), 'after')
    writeFileSync(join(root, 'added.ts'), 'new')
    git('mv', 'rename.ts', 'renamed.ts')
    git('rm', 'deleted.ts')
    git('add', '.')
    git('commit', '-m', 'card changes')
    const scope = cardChangeScope(root, 'origin/main')
    expect(scope.added).toContain('added.ts')
    expect(scope.modified).toContain('modified.ts')
    expect(scope.renamed).toContainEqual({ from: 'rename.ts', to: 'renamed.ts' })
    expect(scope.deleted).toContain('deleted.ts')
  })
})
